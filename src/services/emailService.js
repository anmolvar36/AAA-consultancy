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

/**
 * Sends a customized Spain Visa checklist to the client upon successful payment.
 * @param {string} to - Client email
 * @param {string} clientName - Client's name
 * @param {string} serviceType - Service type/visa selected
 */
exports.sendVisaChecklist = async (to, clientName, serviceType) => {
  const normalizedService = (serviceType || '').toLowerCase();
  let checklistTitle = "Spain Visa Document Checklist";
  let checklistHtml = `
    <li>Valid Passport (original and copy of all pages)</li>
    <li>Proof of clean criminal record (duly apostilled)</li>
    <li>Visa application form duly filled and signed</li>
    <li>Recent passport-size photographs</li>
    <li>Proof of healthcare coverage in Spain</li>
  `;

  if (normalizedService.includes('nomad') || normalizedService.includes('dnv')) {
    checklistTitle = "Spain Digital Nomad Visa (DNV) Checklist";
    checklistHtml = `
      <li><b>Passport:</b> Valid passport with at least 1 year validity and copies of all pages.</li>
      <li><b>Employment Certificate:</b> Document proving relationship with foreign employers for at least 3 months.</li>
      <li><b>Company Legitimacy:</b> Certificate of Incorporation/Business Registry of your employer.</li>
      <li><b>Proof of Income:</b> Bank statements or invoices showing at least €2,646 per month (200% of SMI).</li>
      <li><b>Criminal Record Certificate:</b> Apostilled clean background check from country of residence for last 5 years.</li>
      <li><b>Degree/Experience:</b> University degree/diploma or proof of 3+ years professional experience.</li>
      <li><b>Private Health Insurance:</b> Spanish health insurance policy (no copay, no waiting period).</li>
    `;
  } else if (normalizedService.includes('lucrative') || normalizedService.includes('nlv')) {
    checklistTitle = "Spain Non-Lucrative Visa (NLV) Checklist";
    checklistHtml = `
      <li><b>Passport:</b> Valid passport with at least 1 year validity and copies of all pages.</li>
      <li><b>Sufficient Financial Means:</b> Proof of passive income or savings showing at least €28,800 annually (400% of IPREM).</li>
      <li><b>Criminal Record Certificate:</b> Apostilled clean background check from last 5 years.</li>
      <li><b>Private Health Insurance:</b> Comprehensive Spanish health insurance (no copay).</li>
      <li><b>Medical Certificate:</b> Form stating you do not suffer from diseases that pose public health risks.</li>
    `;
  } else if (normalizedService.includes('tourist') || normalizedService.includes('schengen')) {
    checklistTitle = "Spain Schengen Tourist Visa Checklist";
    checklistHtml = `
      <li><b>Schengen Visa Form:</b> Fully completed and signed application form.</li>
      <li><b>Travel Insurance:</b> Coverage of at least €30,000 for medical expenses inside Schengen zone.</li>
      <li><b>Flight & Hotel Booking:</b> Confirmed return ticket reservation and accommodation details.</li>
      <li><b>Proof of Funds:</b> Bank statements showing at least €108 per day of stay in Spain.</li>
      <li><b>Employment Status:</b> Reference letter from current employer or business license copy.</li>
    `;
  } else if (normalizedService.includes('study') || normalizedService.includes('student')) {
    checklistTitle = "Spain Student Visa Checklist";
    checklistHtml = `
      <li><b>Letter of Acceptance:</b> Official admission letter from accredited Spanish educational institution.</li>
      <li><b>Proof of Funds:</b> Financial resources showing at least €600 per month (100% of IPREM).</li>
      <li><b>Medical Certificate:</b> Proof of good health (for stays longer than 180 days).</li>
      <li><b>Criminal Record Certificate:</b> Clean record certificate from last 5 years (for stays longer than 180 days).</li>
      <li><b>Private Spanish Health Insurance:</b> Coverage for student stay.</li>
    `;
  } else if (normalizedService.includes('self') || normalizedService.includes('business') || normalizedService.includes('employed')) {
    checklistTitle = "Spain Self-Employed / Business Residency Checklist";
    checklistHtml = `
      <li><b>Business Plan:</b> Detailed business plan approved by official Spanish trade organizations.</li>
      <li><b>Professional Qualification:</b> Proof of qualifications/license required to run your business.</li>
      <li><b>Proof of Investment:</b> Sufficient capital setup and funding commitments in Spain.</li>
      <li><b>Criminal Record Certificate:</b> Apostilled clean background certificate from last 5 years.</li>
      <li><b>Private Health Insurance:</b> Spanish private health coverage.</li>
    `;
  }

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #ddd; padding: 20px; border-radius: 8px;">
      <h2 style="color: #1a56db; text-align: center;">AAA Business Consultancy</h2>
      <p>Dear <b>${clientName}</b>,</p>
      <p>Thank you for choosing AAA Business Consultancy. We have successfully received your payment. Your Spanish visa relocation folder has been created.</p>
      <div style="background-color: #f3f4f6; padding: 15px; border-radius: 6px; margin: 15px 0;">
        <h3 style="margin-top: 0; color: #1f2937;">📋 ${checklistTitle}</h3>
        <p>Please gather the following documents and upload them through your client dashboard:</p>
        <ul style="line-height: 1.6; padding-left: 20px;">
          ${checklistHtml}
        </ul>
      </div>
      <p>You can access your secure documents portal to begin uploading these files: <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/#/portal/documents" style="color: #1a56db; text-weight: bold;">Upload Portal Link</a></p>
      <br>
      <p>Best regards,</p>
      <p><b>AAA Business Consultancy Team</b></p>
    </div>
  `;

  return exports.sendEmail({
    to,
    subject: `[Checklist] Required Documents for your Spain ${serviceType || 'Visa'} Application 🇪🇸`,
    html
  });
};

