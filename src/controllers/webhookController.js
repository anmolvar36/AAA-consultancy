const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const prisma = require('../config/db');
const s3Service = require('../services/s3Service');
const zoomService = require('../services/zoomService');
const { communicationsQueue } = require('../queues/queueSetup');
const { processPaymentEvent } = require('../services/paymentService');

exports.verifyMetaSignature = (req, res, next) => {
  const signature = req.headers['x-hub-signature-256'];
  const appSecret = process.env.META_APP_SECRET;
  
  if (!appSecret) {
    console.warn('META_APP_SECRET not configured. Skipping signature validation.');
    return next();
  }

  if (!signature) {
    return res.status(401).send('No signature provided');
  }

  const payload = JSON.stringify(req.body);
  const expectedSignature = `sha256=${crypto
    .createHmac('sha256', appSecret)
    .update(payload)
    .digest('hex')}`;

  if (crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    return next();
  }
  
  return res.status(401).send('Invalid signature');
};

exports.handleMetaWebhook = async (req, res) => {
  const payload = req.body;
  console.log('Received Meta Webhook:', JSON.stringify(payload, null, 2));

  // Meta requires a 200 OK immediately
  res.status(200).send('EVENT_RECEIVED');

  try {
    const entry = payload.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    // 1. Check if WhatsApp Webhook Message
    if (value?.messages && value.messages.length > 0) {
      for (const msg of value.messages) {
        if (msg.from) {
          const phone = msg.from;
          const contact = value.contacts?.find(c => c.wa_id === phone);
          const name = contact?.profile?.name || 'Applicant';
          const message = msg.text?.body || '';

          console.log(`Enqueuing WhatsApp message from ${phone} (${name}): ${message}`);
          await communicationsQueue.add('process-meta-message', {
            phone,
            name,
            message,
            platform: 'whatsapp'
          }, {
            jobId: msg.id || Date.now().toString()
          });
        }
      }
    } 
    // 2. Messenger / Instagram DM Webhooks
    else if (entry?.messaging && entry.messaging.length > 0) {
      for (const msg of entry.messaging) {
        const senderId = msg.sender?.id;
        const messageText = msg.message?.text || '';
        const platform = payload.object === 'instagram' ? 'instagram' : 'facebook';
        
        console.log(`Enqueuing Direct Message from ${senderId} on ${platform}`);
        await communicationsQueue.add('process-meta-message', {
          phone: senderId,
          name: `Meta User (${platform === 'instagram' ? 'Instagram' : 'Messenger'})`,
          message: messageText,
          platform
        }, {
          jobId: msg.message?.mid || Date.now().toString()
        });
      }
    }
    // 3. Comments (Facebook Feed / Instagram Comments) Webhooks
    else if (entry?.changes && entry.changes.length > 0) {
      for (const chg of entry.changes) {
        const val = chg.value;
        const field = chg.field;
        
        if (field === 'feed' || field === 'comments' || field === 'comment') {
          const commentText = val.message || val.text || '';
          const commentId = val.comment_id || val.id;
          const senderName = val.from?.name || 'Social User';
          const platform = payload.object === 'instagram' ? 'instagram' : 'facebook';
          
          console.log(`Enqueuing Comment update from ${senderName} on ${platform} (${field}): ${commentText}`);
          await communicationsQueue.add('process-meta-comment', {
            commentId,
            senderName,
            message: commentText,
            platform
          }, {
            jobId: commentId || Date.now().toString()
          });
        }
      }
    }
  } catch (error) {
    console.error('Error parsing Meta webhook payload:', error);
  }
};

exports.handleStripeWebhook = async (req, res) => {
  // Stripe requires raw body for signature validation
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    if (endpointSecret) {
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } else {
      event = req.body;
    }
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Return a 200 response to acknowledge receipt of the event
  res.send();

  // Enqueue payment event (We can handle this later in Payment State Machine)
  await processPaymentEvent(event).catch(console.error);
};

exports.handleTikTokWebhook = async (req, res) => {
  const payload = req.body;
  res.status(200).send('EVENT_RECEIVED');
  
  await communicationsQueue.add('process-tiktok-lead', payload, {
    jobId: payload.lead_id || Date.now().toString(),
  });
};

exports.handleTelegramWebhook = async (req, res) => {
  try {
    const payload = req.body;
    console.log('Received Telegram Webhook Payload:', JSON.stringify(payload, null, 2));

    // Acknowledge event immediately to Telegram
    res.status(200).json({ success: true });

    const message = payload.message;
    if (message && message.text) {
      const chatId = String(message.chat.id);
      const text = message.text;
      const firstName = message.from?.first_name || '';
      const lastName = message.from?.last_name || '';
      const name = `${firstName} ${lastName}`.trim() || 'Telegram User';

      console.log(`Enqueuing Telegram message from chat ${chatId}: ${text}`);
      await communicationsQueue.add('process-telegram-message', {
        chatId,
        name,
        message: text
      }, {
        jobId: `tg-${message.message_id || Date.now()}`
      });
    }
  } catch (err) {
    console.error('Error handling Telegram webhook:', err);
  }
};

exports.verifyMetaWebhook = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const verifyToken = process.env.META_VERIFY_TOKEN || 'aaa_consultancy_secret_token';

  if (mode && token) {
    if (mode === 'subscribe' && token === verifyToken) {
      console.log('Meta Webhook Verified Successfully!');
      return res.status(200).send(challenge);
    } else {
      console.warn('Meta Webhook Verification Failed: Token Mismatch');
      return res.status(403).send('Forbidden');
    }
  }
  return res.status(400).send('Bad Request');
};

/**
 * Background worker logic to extract Zoom cloud recording share link
 * and link it to the matching Consultation in the database.
 */
async function processZoomRecording(payload) {
  const meetingId = payload.object.id;
  
  // Extract Zoom Cloud Share URL or fallback to the play URL of the first file
  const shareUrl = payload.object.share_url || payload.object.recording_files?.[0]?.play_url;
  
  if (!shareUrl) {
    console.warn(`No share_url or play_url found for Zoom meeting ${meetingId}`);
    return;
  }
  
  console.log(`Received Zoom recording share URL for meeting ${meetingId}: ${shareUrl}`);
  
  try {
    // Update matching Consultation record in database
    const consultation = await prisma.consultation.findFirst({
      where: {
        meetingLink: {
          contains: meetingId.toString()
        }
      }
    });
    
    if (consultation) {
      console.log(`Found Consultation ID ${consultation.id} for Zoom Meeting ${meetingId}. Saving recordingUrl.`);
      await prisma.consultation.update({
        where: { id: consultation.id },
        data: {
          recordingUrl: shareUrl,
          status: 'Completed'
        }
      });
    } else {
      console.warn(`No Consultation record found matching Zoom Meeting ID ${meetingId}`);
    }
  } catch (err) {
    console.error(`Error saving Zoom recording link for meeting ${meetingId}:`, err.message);
  }
}

/**
 * Express Controller Action for Zoom Webhooks.
 * Handles URL validation challenge and async recording processing.
 */
exports.handleZoomWebhook = async (req, res) => {
  try {
    const payload = req.body;
    console.log('Received Zoom Webhook event:', payload.event);

    // 1. Zoom Webhook URL Validation Challenge
    if (payload.event === 'endpoint.url_validation') {
      const plainToken = payload.payload.plainToken;
      const zoomWebhookToken = process.env.ZOOM_WEBHOOK_SECRET_TOKEN || 'your_zoom_webhook_secret_token_here';
      
      const encryptedToken = crypto
        .createHmac('sha256', zoomWebhookToken)
        .update(plainToken)
        .digest('hex');
        
      console.log('Responding to Zoom URL Validation Challenge');
      return res.status(200).json({
        plainToken,
        encryptedToken
      });
    }

    // 2. Zoom Cloud Recording Completion Event
    if (payload.event === 'recording.completed') {
      // Respond 200 OK immediately to satisfy Zoom's 3-second timeout constraint
      res.status(200).send('OK');
      
      // Process file download and upload in background
      processZoomRecording(payload).catch(err => {
        console.error('Background Zoom recording processing failed:', err.message);
      });
      return;
    }

    // Unhandled event
    return res.status(200).send('EVENT_IGNORED');
  } catch (error) {
    console.error('Error in Zoom webhook handler:', error.message);
    return res.status(500).send('Internal Server Error');
  }
};

/**
 * Twilio Webhook Handler (Inbound WhatsApp messages)
 * Twilio sends URL-encoded POST payloads when a user replies to your WhatsApp number.
 */
exports.handleTwilioWebhook = async (req, res) => {
  try {
    const payload = req.body;
    console.log('Received Twilio Webhook Payload:', payload);

    // Twilio webhooks must return TwiML (XML) response, even an empty one is fine
    res.type('text/xml');
    res.send('<Response></Response>');

    // Extract message fields
    const rawFrom = payload.From || ''; // Format: "whatsapp:+1234567890" or "+1234567890"
    const phone = rawFrom.replace('whatsapp:', '');
    const message = payload.Body || '';
    const name = payload.ProfileName || ''; // Twilio ProfileName if available

    if (phone) {
      if (process.env.DISABLE_REDIS === 'true') {
        console.log(`[LOCAL DEV] Redis disabled. Processing chatbot message synchronously.`);
        const chatbotService = require('../services/chatbotService');
        chatbotService.handleChatbotMessage(phone, name || 'Applicant', message || '').catch(err => {
          console.error('[LOCAL DEV] Chatbot processing error:', err.message);
        });
      } else {
        // Add incoming message to communications queue
        await communicationsQueue.add('process-twilio-message', {
          phone,
          name,
          message,
          rawPayload: payload
        }, {
          jobId: payload.MessageSid || `twilio-msg-${Date.now()}`
        });
        console.log(`Enqueued incoming Twilio WhatsApp message job from ${phone}`);
      }
    }
  } catch (error) {
    console.error('Error handling Twilio webhook:', error.message);
    // Don't crash, respond with empty TwiML
    if (!res.headersSent) {
      res.type('text/xml');
      res.send('<Response></Response>');
    }
  }
};

