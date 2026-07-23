const twilio = require('twilio');
const prisma = require('../config/db');

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

if (isConfigured) {
  console.log(`WhatsApp Service: Twilio WhatsApp API configured with Sender: ${TWILIO_WHATSAPP_FROM}`);
} else {
  console.warn('WhatsApp Service: Twilio credentials not configured (or using placeholders). Running in local DRY-RUN/Sandbox mode.');
}

/**
 * Sends a WhatsApp message using Twilio or logs it in Dry-Run mode.
 * Matches CRM template placeholders (e.g. {{1}}, {{2}}) with parameters in components.
 * 
 * @param {Object} options - Sending options
 * @param {string} options.to - Recipient phone number (e.g., "+971509554142" or "919876543210")
 * @param {string} options.templateName - Registered template ID/name (e.g., "automated_first_response")
 * @param {string} [options.languageCode='en'] - Template language code (legacy parameter for compatibility)
 * @param {Array} [options.components=[]] - Template components containing parameters (header, body, buttons)
 * @returns {Promise<{success: boolean, messageId?: string, dryRun?: boolean}>}
 */
exports.sendWhatsAppMessage = async ({ to, templateName, languageCode = 'en', components = [] }) => {
  // Clean phone number format for Twilio: must start with '+' and be prefixed with 'whatsapp:'
  let cleanTo = to.trim();
  if (cleanTo.startsWith('whatsapp:')) {
    cleanTo = cleanTo.substring(9);
  }
  cleanTo = cleanTo.replace(/[^\d+]/g, ''); // Keep only digits and '+'
  if (!cleanTo.startsWith('+')) {
    cleanTo = '+' + cleanTo;
  }

  // Sandbox Mode Whitelist Filter (Defaults to Active with +917047687998)
  const isTestMode = process.env.TEST_MODE !== 'false'; // Defaults to true
  if (isTestMode) {
    const whitelistStr = process.env.TEST_PHONES || '+917047687998,+971524350123,+971524360123,+971566952566';
    const testPhones = whitelistStr.split(',').map(p => p.trim());
    if (!testPhones.includes(cleanTo)) {
      console.log(`[TEST MODE] Blocked automated template "${templateName}" to ${cleanTo} (not whitelisted)`);
      return { success: true, messageId: 'blocked-sandbox', dryRun: true }; // Drop
    }
  }

  const twilioTo = `whatsapp:${cleanTo}`;

  if (isConfigured) {
    try {
      const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

      // 1. Attempt to fetch template from CRM database
      let templateText = null;
      try {
        const template = await prisma.template.findUnique({
          where: { id: templateName }
        });
        if (template && template.body) {
          templateText = template.body;
        }
      } catch (dbError) {
        console.warn(`Could not fetch template "${templateName}" from database, using hardcoded fallback:`, dbError.message);
      }

      // 2. Default fallback values for CRM system templates
      if (!templateText) {
        const fallbacks = {
          automated_first_response: 'Thank you for contacting AAA Business Consultancy regarding Spain Visa & Residency Services. To Book Your Free Eligibility Assessment & Verification Please Contact Us on Whatsapp: https://wa.me/971509554142?text=I%20want%20to%20book%20an%20assessment%20from%20TikTok',
          consultation_scheduled_confirmation: 'Hello {{1}}, your Spain Visa Consultation is scheduled on {{2}} at {{3}} (UTC). Join Zoom Meeting: {{4}}',
          consultation_no_show_cancelled: 'Hello {{1}}, your Free Eligibility Assessment has been cancelled because you did not join within 10 minutes of the scheduled time. Due to high demand, missed appointments cannot be rescheduled.',
          payment_pending_reminder: 'Hi {{1}}, this is a reminder that payment is pending for Invoice #{{2}}.',
          payment_drip_discount: 'Hello {{1}}, use discount code CEO24H to complete your payment for Invoice #{{2}} with a special discount! Valid for 24 hours only.'
        };
        templateText = fallbacks[templateName] || `Template: ${templateName}`;
      }

      // 3. Extract parameter values from 'components' structure
      // Meta API passed variables inside components, e.g.:
      // [{ type: 'body', parameters: [{ type: 'text', text: 'Value1' }, ...] }]
      const bodyComponents = components.find(c => c.type === 'body')?.parameters || [];
      
      // 4. Interpolate variables (replace {{1}} with param 1, {{2}} with param 2, etc.)
      let resolvedBody = templateText;
      bodyComponents.forEach((param, index) => {
        const placeholder = `{{${index + 1}}}`;
        const replacement = param.text || '';
        resolvedBody = resolvedBody.replace(new RegExp(placeholder, 'g'), replacement);
      });

      // 5. Send message via Twilio API
      const message = await client.messages.create({
        body: resolvedBody,
        from: TWILIO_WHATSAPP_FROM,
        to: twilioTo
      });

      console.log(`Twilio WhatsApp message sent successfully using template "${templateName}" to ${twilioTo}. SID: ${message.sid}`);
      return { success: true, messageId: message.sid, dryRun: false };
    } catch (error) {
      console.error(`Failed to send Twilio WhatsApp message to ${twilioTo}:`, error.message);
      throw new Error(`Twilio API Error: ${error.message}`);
    }
  } else {
    // Sandbox / Dry-Run Mode
    console.log('------------------------------------------------------------');
    console.log(`[TWILIO WHATSAPP DRY-RUN]`);
    console.log(`To:       ${twilioTo}`);
    console.log(`Template: ${templateName}`);
    console.log(`Components: ${JSON.stringify(components, null, 2)}`);
    console.log('------------------------------------------------------------');
    return { success: true, messageId: `twilio-dryrun-${Date.now()}`, dryRun: true };
  }
};

/**
 * Sends automated Payment Successful WhatsApp message with receipt details, delivery notice, and portal credentials.
 */
exports.sendPaymentSuccessWhatsApp = async ({ client, paymentId, amount, serviceType, generatedPassword }) => {
  try {
    if (!client || !client.phone) {
      console.warn('[Payment Success WhatsApp] client or client.phone is missing');
      return;
    }

    const clientName = `${client.firstName || ''} ${client.lastName || ''}`.trim() || 'Valued Client';
    const email = client.email || 'N/A';
    const password = generatedPassword || (client.isTemporaryPassword ? 'Check your registered email' : 'Your registered password');
    const service = serviceType || client.serviceType || 'Spanish Sworn Translation';
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const portalUrl = `${frontendUrl}/#/portal/login`;
    const receiptId = paymentId ? `#${paymentId.substring(0, 8)}` : `#PAY-${Date.now()}`;
    const formattedAmount = Number(amount || 0).toFixed(2);

    const messageBody = `🎉 *Payment Successful & Confirmed!*

Dear ${clientName},

Thank you for your payment to AAA Business Consultancy. Your order has been successfully received.

📄 *Payment Receipt Details:*
• Receipt ID: ${receiptId}
• Service: ${service}
• Amount Paid: €${formattedAmount}

⏰ *Delivery Time Notice:*
Maximum delivery time within 7 working days from the date of payment is successfully received.

🔑 *Your Client Portal Login Credentials:*
• Login Portal: ${portalUrl}
• Login ID (Email): ${email}
• Password: ${password}

Please log into your client portal to upload your documents and track your order status in real time.`;

    let cleanPh = String(client.phone || '').trim();
    if (cleanPh.startsWith('whatsapp:')) cleanPh = cleanPh.substring(9);
    cleanPh = cleanPh.replace(/[^\d+]/g, '');
    if (!cleanPh.startsWith('+')) cleanPh = '+' + cleanPh;

    if (!cleanPh || cleanPh === '+') {
      console.warn('[Payment Success WhatsApp] Phone number is empty or invalid:', client.phone);
      return;
    }

    const twilioTo = `whatsapp:${cleanPh}`;
    let deliveryStatus = 'SENT';
    let failureReason = null;

    if (isConfigured) {
      try {
        const clientTwilio = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
        await clientTwilio.messages.create({
          body: messageBody,
          from: TWILIO_WHATSAPP_FROM,
          to: twilioTo
        });
        console.log(`[Payment Success WhatsApp] Successfully sent automated receipt & credentials to ${twilioTo}`);
      } catch (err) {
        console.error(`[Payment Success WhatsApp] Twilio send failed to ${twilioTo}:`, err.message);
        deliveryStatus = 'FAILED';
        failureReason = err.message;
      }
    } else {
      console.log('------------------------------------------------------------');
      console.log(`[PAYMENT SUCCESS WHATSAPP DRY-RUN]`);
      console.log(`To: ${twilioTo}`);
      console.log(`Body:\n${messageBody}`);
      console.log('------------------------------------------------------------');
    }

    // Log in CommunicationLog so it appears in Live Chat / Social Inbox
    try {
      await prisma.communicationLog.create({
        data: {
          clientId: client.id,
          phone: cleanPh,
          name: 'System Automated',
          channel: 'WHATSAPP',
          direction: 'OUTBOUND',
          content: messageBody,
          deliveryStatus: deliveryStatus,
          failureReason: failureReason
        }
      });
    } catch (logErr) {
      console.warn('[Payment Success WhatsApp] Could not log message to CommunicationLog:', logErr.message);
    }
  } catch (globalErr) {
    console.error('[Payment Success WhatsApp Error]:', globalErr.message);
  }
};

