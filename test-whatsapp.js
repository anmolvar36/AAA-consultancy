require('dotenv').config();
const { sendWhatsAppMessage } = require('./src/services/whatsappService');

async function test() {
  const args = process.argv.slice(2);
  const phoneNumber = args[0];

  if (!phoneNumber) {
    console.error('Please provide a phone number with country code. Example: node test-whatsapp.js 919876543210');
    process.exit(1);
  }

  console.log(`Sending test WhatsApp message to ${phoneNumber}...`);
  try {
    const result = await sendWhatsAppMessage({
      to: phoneNumber,
      templateName: 'automated_first_response',
      languageCode: 'en',
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: 'Test User' }
          ]
        }
      ]
    });
    console.log('WhatsApp test result:', result);
  } catch (error) {
    console.error('WhatsApp test failed:', error.message);
  }
}

test();
