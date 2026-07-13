const nodemailer = require('nodemailer');

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = process.env.SMTP_PORT || 587;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_SECURE = process.env.SMTP_SECURE === 'true' || SMTP_PORT == 465;
const SMTP_FROM = process.env.SMTP_FROM || `"AAA Business Consultancy" <info@aaabusinessconsultancy.com>`;

let transporter = null;

if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
  console.log(`Email Service: Initializing SMTP transporter to ${SMTP_HOST}:${SMTP_PORT}`);
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT, 10),
    secure: SMTP_SECURE,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    }
  });
} else {
  console.warn('Email Service: SMTP credentials not configured. Running in local DRY-RUN/Sandbox mode.');
}

/**
 * Sends an email using SMTP or prints to logs if SMTP is not configured (dry-run).
 * @param {Object} options - Email sending options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.html - HTML body
 * @param {string} [options.text] - Plain text body fallback
 * @returns {Promise<{success: boolean, messageId?: string, dryRun?: boolean}>}
 */
exports.sendEmail = async ({ to, subject, html, text }) => {
  if (transporter) {
    try {
      const info = await transporter.sendMail({
        from: SMTP_FROM,
        to,
        subject,
        text: text || html.replace(/<[^>]*>/g, ''), // Basic HTML strip for fallback text
        html
      });
      console.log(`Email sent successfully to ${to}. Message ID: ${info.messageId}`);
      return { success: true, messageId: info.messageId, dryRun: false };
    } catch (error) {
      console.error(`Failed to send email to ${to}:`, error);
      throw error;
    }
  } else {
    // Sandbox / Dry-Run Log
    console.log('------------------------------------------------------------');
    console.log(`[EMAIL SMTP DRY-RUN]`);
    console.log(`From:    ${SMTP_FROM}`);
    console.log(`To:      ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(`Body (Preview): ${html.substring(0, 150)}...`);
    console.log('------------------------------------------------------------');
    return { success: true, messageId: `dryrun-${Date.now()}`, dryRun: true };
  }
};
