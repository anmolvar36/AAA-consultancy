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

    // Check if WhatsApp Webhook Message
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
            message
          }, {
            jobId: msg.id || Date.now().toString()
          });
        }
      }
    } else {
      // Fallback or Messenger / Mock format (like in TESTING.md)
      const messaging = entry?.messaging?.[0];
      if (messaging) {
        const phone = messaging.sender?.id;
        const message = messaging.message?.text || '';
        const name = 'Applicant';

        console.log(`Enqueuing fallback Messenger message from ${phone}`);
        await communicationsQueue.add('process-meta-message', {
          phone,
          name,
          message
        }, {
          jobId: messaging.message?.mid || Date.now().toString()
        });
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
 * Background worker logic to download a Zoom cloud recording, upload it to AWS S3,
 * and link it to the matching Consultation in the database.
 */
async function processZoomRecording(payload) {
  const meetingId = payload.object.id;
  const recordingFiles = payload.object.recording_files;
  
  if (!recordingFiles || recordingFiles.length === 0) {
    console.log(`No recording files found for Zoom meeting ${meetingId}`);
    return;
  }
  
  // Look for MP4 video file or fall back to the first available file
  const videoFile = recordingFiles.find(f => f.file_type === 'MP4') || recordingFiles[0];
  const downloadUrl = videoFile.download_url;
  
  console.log(`Starting download for Zoom meeting ${meetingId} recording from ${downloadUrl}`);
  
  const tempDir = path.join(__dirname, '../../uploads');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  const tempFileName = `zoom-recording-${meetingId}-${Date.now()}.mp4`;
  const tempFilePath = path.join(tempDir, tempFileName);
  
  let zoomToken = null;
  try {
    if (zoomService.isConfigured) {
      zoomToken = await zoomService.getZoomAccessToken();
    }
  } catch (e) {
    console.warn('Could not retrieve Zoom access token for download authorization, trying public download:', e.message);
  }
  
  try {
    const response = await axios({
      method: 'GET',
      url: downloadUrl,
      responseType: 'stream',
      headers: zoomToken ? { 'Authorization': `Bearer ${zoomToken}` } : {}
    });
    
    const writer = fs.createWriteStream(tempFilePath);
    response.data.pipe(writer);
    
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
    
    console.log(`Successfully downloaded Zoom recording for meeting ${meetingId} to ${tempFilePath}`);
    
    // Upload to AWS S3
    const s3Key = `recordings/${meetingId}-${Date.now()}.mp4`;
    const bucketName = process.env.AWS_BUCKET_NAME || 'aaa-consultancy-recordings';
    const region = process.env.AWS_REGION || 'eu-west-1';
    
    console.log(`Uploading local file to S3: ${bucketName}/${s3Key}`);
    await s3Service.uploadLocalFileToS3(tempFilePath, s3Key, 'video/mp4');
    
    const s3Url = `https://${bucketName}.s3.${region}.amazonaws.com/${s3Key}`;
    console.log(`S3 Upload Successful. URL: ${s3Url}`);
    
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
          recordingUrl: s3Url,
          status: 'Completed'
        }
      });
    } else {
      console.warn(`No Consultation record found matching Zoom Meeting ID ${meetingId}`);
    }
  } catch (err) {
    console.error(`Error processing Zoom recording download/upload for meeting ${meetingId}:`, err.message);
  } finally {
    // Delete local temp file
    if (fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
        console.log(`Deleted temp local recording file: ${tempFilePath}`);
      } catch (err) {
        console.error(`Failed to delete temp file ${tempFilePath}:`, err.message);
      }
    }
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
