const axios = require('axios');

const META_PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;

const isConfigured = !!(META_PHONE_NUMBER_ID && META_ACCESS_TOKEN);

if (isConfigured) {
  console.log(`WhatsApp Service: Meta Cloud API configured for Phone ID: ${META_PHONE_NUMBER_ID}`);
} else {
  console.warn('WhatsApp Service: Meta credentials not configured. Running in local DRY-RUN/Sandbox mode.');
}

/**
 * Sends a WhatsApp message using Meta Cloud API or logs it in Dry-Run mode.
 * @param {Object} options - Sending options
 * @param {string} options.to - Recipient phone number (with country code, e.g., "971509554142")
 * @param {string} options.templateName - Registered Meta WhatsApp template name
 * @param {string} [options.languageCode='en'] - Template language code
 * @param {Array} [options.components=[]] - Template component parameters (header, body, buttons)
 * @returns {Promise<{success: boolean, messageId?: string, dryRun?: boolean}>}
 */
exports.sendWhatsAppMessage = async ({ to, templateName, languageCode = 'en', components = [] }) => {
  // Strip non-numeric characters from phone number for Meta API
  const formattedTo = to.replace(/\D/g, '');

  if (isConfigured) {
    try {
      const url = `https://graph.facebook.com/v19.0/${META_PHONE_NUMBER_ID}/messages`;
      const response = await axios.post(
        url,
        {
          messaging_product: 'whatsapp',
          to: formattedTo,
          type: 'template',
          template: {
            name: templateName,
            language: {
              code: languageCode
            },
            components: components
          }
        },
        {
          headers: {
            Authorization: `Bearer ${META_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      const messageId = response.data.messages?.[0]?.id;
      console.log(`WhatsApp template "${templateName}" sent to ${formattedTo}. Message ID: ${messageId}`);
      return { success: true, messageId, dryRun: false };
    } catch (error) {
      const errorData = error.response?.data || error.message;
      console.error(`Failed to send WhatsApp message to ${formattedTo}:`, JSON.stringify(errorData));
      throw new Error(`WhatsApp API Error: ${error.message}`);
    }
  } else {
    // Sandbox / Dry-Run Log
    console.log('------------------------------------------------------------');
    console.log(`[WHATSAPP DRY-RUN]`);
    console.log(`To:       ${formattedTo}`);
    console.log(`Template: ${templateName} (${languageCode})`);
    console.log(`Components: ${JSON.stringify(components, null, 2)}`);
    console.log('------------------------------------------------------------');
    return { success: true, messageId: `wab-dryrun-${Date.now()}`, dryRun: true };
  }
};
