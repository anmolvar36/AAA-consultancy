const twilio = require('twilio');
const prisma = require('../config/db');
const { connection: redis } = require('../queues/connection');
const axios = require('axios');

const SESSION_TIMEOUT = 3600; // 1 hour session validity

/**
 * Handles incoming client WhatsApp messages, parses their intent, and sends chatbot replies.
 * 
 * @param {string} phone - Inbound sender phone number
 * @param {string} name - Inbound sender name
 * @param {string} text - Message text content
 */
exports.handleChatbotMessage = async (phone, name, text) => {
  // Normalize phone format
  let cleanPhone = phone.trim();
  if (cleanPhone.startsWith('whatsapp:')) {
    cleanPhone = cleanPhone.substring(9);
  }
  cleanPhone = cleanPhone.replace(/[^\d+]/g, ''); // Keep only digits and '+'
  if (!cleanPhone.startsWith('+')) {
    cleanPhone = '+' + cleanPhone;
  }

  // 1. Check if Live Agent Mode is active for this user
  const agentModeKey = `chatbot:agent_mode:${cleanPhone}`;
  const isAgentMode = await redis.get(agentModeKey);
  
  const cleanMessage = text.trim().toLowerCase();

  const isResumeCommand = (cleanMessage === 'menu' || cleanMessage === 'help' || cleanMessage === 'start');
  if (isResumeCommand) {
    if (isAgentMode === 'true') {
      await redis.del(agentModeKey);
      console.log(`Chatbot: Agent mode disabled for ${cleanPhone} by menu reset command.`);
    }
  }

  // If agent mode is active, completely skip responding (allows human conversation)
  if (isAgentMode === 'true') {
    console.log(`Chatbot: Agent mode is active for ${cleanPhone}. Skipping chatbot auto-response.`);
    return;
  }

  // Retrieve user session stage
  const sessionKey = `chatbot:session:${cleanPhone}`;
  const userSessionRaw = await redis.get(sessionKey);
  let userSession = userSessionRaw ? JSON.parse(userSessionRaw) : { stage: 'INIT' };

  // Detect and track traffic source from incoming message text
  let detectedSource = userSession.source || 'WhatsApp';
  if (cleanMessage.includes('tiktok')) {
    detectedSource = 'TikTok Ads';
  } else if (cleanMessage.includes('instagram')) {
    detectedSource = 'Instagram Ads';
  } else if (cleanMessage.includes('facebook')) {
    detectedSource = 'Facebook Ads';
  }
  userSession.source = detectedSource;

  // 2. Handoff to Live Agent command
  if (cleanMessage === 'agent' || cleanMessage === 'talk to agent') {
    await redis.set(agentModeKey, 'true', 'EX', 86400); // Pause bot for 24 hours
    await redis.del(sessionKey); // Clear temporary menu session
    
    await sendCustomWhatsApp(cleanPhone, "👤 *Live Agent Mode Activated!*\n\nOur consultants have been notified and will message you shortly. The automated assistant is now paused.\n\n_To resume the chatbot at any time, just reply *'menu'*._");
    console.log(`[AGENT HANDOFF] Live agent requested by ${cleanPhone} (${name}). Chatbot paused.`);
    
    await logCommunication(cleanPhone, `User requested Live Agent support. Chatbot paused for 24 hours.`, "SYSTEM");
    return;
  }

  // 3. Simplified Flow: If stage is 'INIT' or they trigger a resume/start command
  if (userSession.stage === 'INIT' || isResumeCommand) {
    let lead = null;
    try {
      const numberPart = cleanPhone.replace('+', '');
      lead = await prisma.lead.findFirst({
        where: { phone: { contains: numberPart } }
      });

      if (!lead) {
        const nameParts = name ? name.split(' ') : ['WhatsApp', 'Lead'];
        lead = await prisma.lead.create({
          data: {
            firstName: nameParts[0] || 'WhatsApp',
            lastName: nameParts.slice(1).join(' ') || 'Lead',
            phone: cleanPhone,
            email: `${numberPart}@whatsapp.com`, // Placeholder email
            status: 'New Lead',
            source: detectedSource
          }
        });
        console.log(`[CHATBOT] Instantly created lead ${lead.id} for phone ${cleanPhone}`);
      } else {
        // Update source if it's currently default WhatsApp
        if (lead.source === 'WhatsApp' && detectedSource !== 'WhatsApp') {
          lead = await prisma.lead.update({
            where: { id: lead.id },
            data: { source: detectedSource }
          });
        }
        console.log(`[CHATBOT] Found existing lead ${lead.id} for phone ${cleanPhone}`);
      }
    } catch (dbError) {
      console.warn("[CHATBOT] Error handling lead DB check/create:", dbError.message);
    }

    // Send Greeting & Lead Booking Form Link
    const greetingMsg = `Greetings from *AAA Business Consultancy LLC*. Thank you for contacting us regarding Spain Visa & Residency Services.✈️✈️`;
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const bookingLink = `${frontendUrl}/#/public/lead-form?source=${encodeURIComponent(detectedSource)}&id=${lead ? lead.id : ''}`;
    const instructionMsg = `To book your Free 20-Minute Eligibility Assessment & Verification, please click the link below to select your preferred date and time:\n\n${bookingLink}`;

    await sendCustomWhatsApp(cleanPhone, greetingMsg);
    await new Promise(resolve => setTimeout(resolve, 500)); // natural order delay
    await sendCustomWhatsApp(cleanPhone, instructionMsg);

    // Set stage to 'BOOKING_LINK_SENT' so we don't spam the link on subsequent messages
    userSession.stage = 'BOOKING_LINK_SENT';
    await redis.set(sessionKey, JSON.stringify(userSession), 'EX', SESSION_TIMEOUT);
    return;
  }

  // 4. Subsequent messages: Hand off to AI or Agent
  if (userSession.stage === 'BOOKING_LINK_SENT') {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

    if (OPENAI_API_KEY && OPENAI_API_KEY !== 'your_openai_api_key_here') {
      try {
        const aiAnswer = await getOpenAIAnswer(text);
        await sendCustomWhatsApp(cleanPhone, aiAnswer);
        return;
      } catch (e) {
        console.error("OpenAI chatbot failure:", e.message);
      }
    } else if (GEMINI_API_KEY && GEMINI_API_KEY !== 'your_gemini_api_key_here') {
      try {
        const aiAnswer = await getGeminiAnswer(text);
        await sendCustomWhatsApp(cleanPhone, aiAnswer);
        return;
      } catch (e) {
        console.error("Gemini chatbot failure:", e.message);
      }
    }

    console.log(`[CHATBOT] Chatbot link already sent to ${cleanPhone}. Ready for human agent reply.`);
  }
};

/**
 * Sends free-text responses via Twilio WhatsApp API or logs in Dry-Run mode.
 */
async function sendCustomWhatsApp(phone, messageBody) {
  const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
  const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
  const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM;

  const isConfigured = !!(
    TWILIO_ACCOUNT_SID && 
    TWILIO_ACCOUNT_SID.startsWith('AC') && 
    TWILIO_AUTH_TOKEN && 
    TWILIO_AUTH_TOKEN !== 'your_twilio_auth_token_here' && 
    TWILIO_WHATSAPP_FROM
  );

  const twilioTo = `whatsapp:${phone}`;

  if (isConfigured) {
    try {
      const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
      await client.messages.create({
        body: messageBody,
        from: TWILIO_WHATSAPP_FROM,
        to: twilioTo
      });
    } catch (err) {
      console.error(`Twilio Chatbot Outbound Send failed to ${twilioTo}:`, err.message);
    }
  } else {
    console.log('------------------------------------------------------------');
    console.log(`[CHATBOT DRY-RUN SEND]`);
    console.log(`To:       ${twilioTo}`);
    console.log(`Body:     ${messageBody}`);
    console.log('------------------------------------------------------------');
  }

  // Log to database communications log
  await logCommunication(phone, messageBody, "OUTBOUND");
}

/**
 * Creates a record in CommunicationLog linked to the matching client.
 */
async function logCommunication(phone, messageText, direction) {
  try {
    const numberPart = phone.replace('+', '');
    const client = await prisma.client.findFirst({
      where: { phone: { contains: numberPart } }
    });
    if (client) {
      await prisma.communicationLog.create({
        data: {
          clientId: client.id,
          channel: 'WHATSAPP',
          direction: direction,
          content: messageText,
          deliveryStatus: 'SENT'
        }
      });
    }
  } catch (e) {
    console.warn("Could not log chatbot message to Database:", e.message);
  }
}

/**
 * Queries OpenAI completions API for general visa enquiries.
 */
async function getOpenAIAnswer(userQuery) {
  const apiKey = process.env.OPENAI_API_KEY;
  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful customer support chatbot for AAA Business Consultancy. We help clients obtain visas, residencies (like Digital Nomad Visa, Non-Lucrative Visa, Golden Visa), and Sworn Translations in Spain. Answer briefly, professionally, and keep it under 3 sentences. Mention that the user can reply "agent" to talk to a human consultant.'
        },
        { role: 'user', content: userQuery }
      ],
      max_tokens: 150
    },
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    }
  );
  return response.data.choices[0].message.content.trim();
}

/**
 * Queries Google Gemini API for general visa enquiries.
 */
async function getGeminiAnswer(userQuery) {
  const apiKey = process.env.GEMINI_API_KEY;
  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    {
      contents: [
        {
          parts: [
            {
              text: `You are a helpful customer support chatbot for AAA Business Consultancy. We help clients obtain visas, residencies (like Digital Nomad Visa, Non-Lucrative Visa, Golden Visa), and Sworn Translations in Spain. Answer briefly, professionally, and keep it under 3 sentences. Mention that the user can reply "agent" to talk to a human consultant. User Question: ${userQuery}`
            }
          ]
        }
      ],
      generationConfig: {
        maxOutputTokens: 150
      }
    },
    {
      headers: {
        'Content-Type': 'application/json'
      }
    }
  );
  return response.data.candidates[0].content.parts[0].text.trim();
}
