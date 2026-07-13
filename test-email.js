require('dotenv').config();
const { sendEmail } = require('./src/services/emailService');

async function test() {
  console.log('Sending test email via SMTP...');
  try {
    const result = await sendEmail({
      to: 'client@aaabusinessconsultancy.com', // sending to self to test
      subject: 'SMTP Test Email - AAA Visa CRM',
      html: '<h3>SMTP Test Success!</h3><p>If you see this email, the Zoho SMTP configuration is working correctly.</p>'
    });
    console.log('Test result:', result);
  } catch (error) {
    console.error('SMTP test failed:', error);
  }
}

test();
