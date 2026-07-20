const { Worker } = require('bullmq');
const { connection } = require('./connection');
const { failedJobsQueue } = require('./queueSetup');
const { sendEmail } = require('../services/emailService');
const { sendWhatsAppMessage } = require('../services/whatsappService');

// Helper to handle DLQ (Dead Letter Queue) mechanism
const handleJobFailure = async (job, err) => {
  if (job.attemptsMade >= job.opts.attempts) {
    console.error(`Job ${job.id} of type ${job.name} in queue ${job.queueName} failed permanently. Moving to DLQ.`);
    await failedJobsQueue.add(`dlq-${job.queueName}-${job.name}`, {
      originalJob: job.asJSON(),
      error: err.message,
      stack: err.stack
    }, {
      jobId: `failed-${job.id}` // Prevent duplicate DLQ entries
    });
  }
};

const setupWorkers = () => {
  if (process.env.DISABLE_REDIS === 'true') {
    console.log('BullMQ Workers are disabled (DISABLE_REDIS=true). Skipping worker initialization.');
    return;
  }

  // Communications Worker
  const communicationsWorker = new Worker('communications', async (job) => {
    console.log(`Processing communication job ${job.id} of type: ${job.name}`);
    const { phone, email, name, message } = job.data;
    
    // Auto-reply logic for Meta/WhatsApp Click ads or website forms
    if (job.name === 'process-meta-message' || job.name === 'process-twilio-message' || job.name === 'process-tiktok-lead' || job.name === 'process-telegram-message') {
      try {
        if (job.name === 'process-telegram-message') {
          const { chatId, name, message: msgText } = job.data;
          console.log(`[Telegram Worker] Processing message from Telegram user: ${name}`);
          
          const telegramService = require('../services/telegramService');
          const lowerText = (msgText || '').toLowerCase();
          let responseText = `Hi ${name || 'there'}! Thanks for messaging our Telegram Bot. 🇪🇸\n\nFor Spain Visa & Relocation services details, type /spain.\nFor booking a Free Eligibility Assessment, type /book.`;
          
          if (lowerText.includes('/spain') || lowerText.includes('visa')) {
            responseText = `<b>Spain Relocation Pathways</b> ✈️\n\nWe specialize in:\n• Digital Nomad Visa (DNV)\n• Non-Lucrative Visa (NLV)\n• Golden Visa (Property Investment)\n• Student & Schengen Visas\n\nReply /book to secure an intake slot with our advisors.`;
          } else if (lowerText.includes('/book') || lowerText.includes('book') || lowerText.includes('assess')) {
            responseText = `<b>Book Assessment</b> 📅\n\nPlease secure your consultation call using this link: https://aaabusinessconsultancy.com/book-assessment`;
          }
          
          await telegramService.sendTelegramMessage(chatId, responseText);
        } else if (job.name === 'process-meta-message' || job.name === 'process-twilio-message') {
          // Process inbound user message via the Chatbot
          const chatbotService = require('../services/chatbotService');
          await chatbotService.handleChatbotMessage(phone, name || 'Applicant', message || '');
        } else {
          // For process-tiktok-lead (external lead form submission)
          if (phone) {
            // Send automatic first response on WhatsApp
            await sendWhatsAppMessage({
              to: phone,
              templateName: 'automated_first_response',
              languageCode: 'en',
              components: [
                {
                  type: 'body',
                  parameters: [
                    { type: 'text', text: name || 'Applicant' }
                  ]
                }
              ]
            });
          }
          
          if (email) {
            // Send automated confirmation email
            await sendEmail({
              to: email,
              subject: 'Spain Visa & Residency Services - Next Steps',
              html: `<h3>Thank you for contacting AAA Business Consultancy, ${name || 'Applicant'}!</h3>
                     <p>We received your inquiry regarding Spain Visa & Residency Services.</p>
                     <p>To book your Free Eligibility Assessment, please click the link below:</p>
                     <p><a href="https://aaabusinessconsultancy.com/book-assessment">Book Free Assessment</a></p>`
            });
          }
        }
      } catch (err) {
        console.error('Failed to process incoming communications webhook job:', err);
        throw err;
      }
    } else if (job.name === 'process-meta-comment') {
      try {
        const { commentId, senderName, message, platform } = job.data;
        console.log(`[Worker] Processing comment from ${senderName} on ${platform}: ${message}`);
        
        // Simulates checking if comment is asking for info
        const lowerMsg = (message || '').toLowerCase();
        const asksForInfo = ['visa', 'spain', 'info', 'price', 'how', 'eligible', 'help', 'cost'].some(kw => lowerMsg.includes(kw));
        
        if (asksForInfo) {
          console.log(`[Worker] Comment matching criteria for auto-reply on ${platform}. Sending simulated public reply.`);
          // In production, we call Facebook Graph API to reply:
          // await axios.post(`https://graph.facebook.com/v17.0/${commentId}/comments`, { message: ... })
          
          // Log reply simulation
          console.log(`[Auto-Reply Simulated] "Hi @${senderName}, thank you for reaching out! We've sent you a DM to get started, or you can book an assessment directly here: https://aaabusinessconsultancy.com/book-assessment"`);
        }
      } catch (err) {
        console.error('Failed to process meta comment auto-reply job:', err);
        throw err;
      }
    }
  }, { connection });

  communicationsWorker.on('failed', handleJobFailure);

  // Reminders Worker
  const remindersWorker = new Worker('reminders', async (job) => {
    console.log(`Processing reminder job ${job.id} - ${job.name}`);
    const { toEmail, toPhone, subject, emailHtml, whatsappTemplate, whatsappComponents } = job.data;

    try {
      if (toEmail && emailHtml) {
        await sendEmail({
          to: toEmail,
          subject: subject || 'Spain Visa Consultation Reminder',
          html: emailHtml
        });
      }

      if (toPhone && whatsappTemplate) {
        await sendWhatsAppMessage({
          to: toPhone,
          templateName: whatsappTemplate,
          components: whatsappComponents || []
        });
      }
    } catch (err) {
      console.error(`Failed to process reminder job ${job.id}:`, err);
      throw err;
    }
  }, { connection });

  remindersWorker.on('failed', handleJobFailure);

  // No-Show Enforcer Worker
  const noShowEnforcerWorker = new Worker('no-show-enforcer', async (job) => {
    console.log(`Processing no-show-enforcer job ${job.id}`);
    const { email, phone, name, appointmentTime } = job.data;
    
    try {
      if (phone) {
        // Send No-Show Cancellation template to WhatsApp
        await sendWhatsAppMessage({
          to: phone,
          templateName: 'consultation_no_show_cancelled',
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: name || 'Applicant' }
              ]
            }
          ]
        });
      }

      if (email) {
        // Send No-Show Cancel email
        await sendEmail({
          to: email,
          subject: 'No-Show Notice: Eligibility Assessment Cancelled',
          html: `<p>Hello ${name || 'Applicant'},</p>
                 <p>Your Free Eligibility Assessment has been cancelled because you did not join within 10 minutes of the scheduled time.</p>
                 <p>Due to high demand, missed appointments cannot be rescheduled.</p>`
        });
      }
    } catch (err) {
      console.error(`Failed to enforce No-Show for job ${job.id}:`, err);
      throw err;
    }
  }, { connection });

  noShowEnforcerWorker.on('failed', handleJobFailure);

  // Payment Drip Worker
  const paymentDripWorker = new Worker('payment-drip', async (job) => {
    console.log(`Processing payment-drip job ${job.id} - ${job.name}`);
    const { email, phone, name, invoiceId, amount, discountOffer } = job.data;

    try {
      let subject = 'Invoice Payment Pending';
      let html = `<p>Hi ${name || 'Client'},</p><p>This is a reminder that payment of €${amount} is pending for Invoice #${invoiceId}.</p>`;
      
      if (discountOffer) {
        subject = 'Special 24-Hour Discount Offer from CEO';
        html = `<h3>Special 24h Offer</h3>
                <p>Hello ${name},</p>
                <p>Use discount code <strong>CEO24H</strong> to complete your payment for Invoice #${invoiceId} with a special discount!</p>
                <p>Valid for 24 hours only.</p>`;
      }

      if (email) {
        await sendEmail({ to: email, subject, html });
      }

      if (phone) {
        await sendWhatsAppMessage({
          to: phone,
          templateName: discountOffer ? 'payment_drip_discount' : 'payment_pending_reminder',
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: name || 'Client' },
                { type: 'text', text: invoiceId }
              ]
            }
          ]
        });
      }
    } catch (err) {
      console.error(`Failed to process payment drip reminder for job ${job.id}:`, err);
      throw err;
    }
  }, { connection });

  paymentDripWorker.on('failed', handleJobFailure);

  console.log('BullMQ Workers initialized');
};

module.exports = { setupWorkers };
