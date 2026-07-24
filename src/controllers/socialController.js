const twilio = require('twilio');
const prisma = require('../config/db');

// Retrieve Twilio Configuration
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM;

const isTwilioConfigured = !!(
  TWILIO_ACCOUNT_SID &&
  TWILIO_ACCOUNT_SID.startsWith('AC') &&
  TWILIO_AUTH_TOKEN &&
  TWILIO_WHATSAPP_FROM
);

/**
 * Clean phone number function
 */
function cleanPhoneNumber(phone) {
  let clean = phone.trim();
  if (clean.startsWith('whatsapp:')) {
    clean = clean.substring(9);
  }
  clean = clean.replace(/[^\d+]/g, '');
  if (!clean.startsWith('+')) {
    clean = '+' + clean;
  }
  return clean;
}

/**
 * Get all conversations grouped by phone number
 */
exports.getConversations = async (req, res) => {
  try {
    // 1. Fetch all communication logs ordered by newest first
    const logs = await prisma.communicationLog.findMany({
      orderBy: { createdAt: 'desc' }
    });

    // 2. Group by unique phone numbers to get the latest message
    const conversationsMap = {};
    const uniquePhones = [];

    for (const log of logs) {
      if (!log.phone) continue;
      const cleanPh = cleanPhoneNumber(log.phone);
      if (!conversationsMap[cleanPh]) {
        conversationsMap[cleanPh] = log;
        uniquePhones.push(cleanPh);
      }
    }

    // 3. Enrich each conversation with Lead/Client details, messages history, and unread count
    const conversations = [];

    for (const cleanPh of uniquePhones) {
      const latestLog = conversationsMap[cleanPh];
      const numberPart = cleanPh.replace('+', '');

      // Check if Client exists
      const client = await prisma.client.findFirst({
        where: { phone: { contains: numberPart } }
      });

      // Check if Lead exists
      const lead = await prisma.lead.findFirst({
        where: { phone: { contains: numberPart } }
      });

      // Determine Name and Status
      let name = cleanPh;
      let status = 'New Lead';
      let email = null;

      const isApplicantPlaceholder = (val) => {
        if (!val) return true;
        const normalized = val.trim().toLowerCase();
        return normalized === '' || normalized === 'applicant' || normalized.includes('applicant');
      };

      if (client && !isApplicantPlaceholder(`${client.firstName} ${client.lastName}`)) {
        name = `${client.firstName} ${client.lastName}`.trim();
        status = client.status || 'Under Process';
        email = client.email;
      } else if (lead && !isApplicantPlaceholder(`${lead.firstName} ${lead.lastName}`)) {
        name = `${lead.firstName} ${lead.lastName}`.trim();
        status = lead.status || 'New Lead';
        email = lead.email;
      } else if (latestLog.name && !isApplicantPlaceholder(latestLog.name)) {
        name = latestLog.name.trim();
      }

      if (isApplicantPlaceholder(name)) {
        name = cleanPh;
      }

      // Fetch message history for this phone
      const messagesLogs = await prisma.communicationLog.findMany({
        where: { phone: cleanPh },
        orderBy: { createdAt: 'asc' },
        include: {
          respondedByUser: {
            select: { id: true, fullName: true, role: true, avatar: true }
          }
        }
      });

      const messages = messagesLogs.map(m => ({
        id: m.id,
        sender: m.direction === 'INBOUND' ? 'customer' : (m.direction === 'SYSTEM' ? 'system' : 'agent'),
        text: m.content,
        timestamp: new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        respondedBy: m.respondedByUser ? {
          id: m.respondedByUser.id,
          name: m.respondedByUser.fullName,
          role: m.respondedByUser.role,
          avatar: m.respondedByUser.avatar
        } : (m.direction === 'OUTBOUND' ? { name: m.name || 'Agent' } : null)
      }));

      // Calculate unread count (INBOUND messages that are unread)
      const unreadCount = await prisma.communicationLog.count({
        where: {
          phone: cleanPh,
          direction: 'INBOUND',
          readStatus: false
        }
      });

      conversations.push({
        id: `conv_phone_${cleanPh.replace(/[^\d]/g, '')}`,
        phone: cleanPh,
        name: name,
        avatar: '',
        platform: 'whatsapp',
        unreadCount: unreadCount,
        status: status,
        email: email,
        leadId: lead ? lead.id : (client ? client.leadId : null),
        clientId: client ? client.id : null,
        messages: messages,
        latestMessage: latestLog.content,
        timestamp: latestLog.createdAt
      });
    }

    return res.status(200).json(conversations);
  } catch (error) {
    console.error('Error fetching conversations:', error.message);
    return res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

/**
 * Get messages history for a specific phone number
 */
exports.getMessagesByPhone = async (req, res) => {
  try {
    const { phone } = req.params;
    const cleanPh = cleanPhoneNumber(phone);

    // 1. Fetch all logs for this phone number
    const logs = await prisma.communicationLog.findMany({
      where: { phone: cleanPh },
      orderBy: { createdAt: 'asc' },
      include: {
        respondedByUser: {
          select: { id: true, fullName: true, role: true, avatar: true }
        }
      }
    });

    // 2. Mark incoming messages as read
    await prisma.communicationLog.updateMany({
      where: {
        phone: cleanPh,
        direction: 'INBOUND',
        readStatus: false
      },
      data: { readStatus: true }
    });

    // 3. Map to frontend message format
    const messages = logs.map(log => ({
      id: log.id,
      sender: log.direction === 'INBOUND' ? 'customer' : (log.direction === 'SYSTEM' ? 'system' : 'agent'),
      text: log.content,
      timestamp: log.createdAt,
      respondedBy: log.respondedByUser ? {
        id: log.respondedByUser.id,
        name: log.respondedByUser.fullName,
        role: log.respondedByUser.role,
        avatar: log.respondedByUser.avatar
      } : (log.direction === 'OUTBOUND' ? { name: log.name || 'Agent' } : null)
    }));

    return res.status(200).json(messages);
  } catch (error) {
    console.error('Error fetching messages by phone:', error.message);
    return res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

/**
 * Send a free-text message via Twilio and log to DB
 */
exports.sendSocialMessage = async (req, res) => {
  try {
    const { phone, text, mediaUrl, mediaType } = req.body;
    if (!phone || (!text && !mediaUrl)) {
      return res.status(400).json({ message: 'Phone and text or media file are required' });
    }

    const cleanPh = cleanPhoneNumber(phone);
    const twilioTo = `whatsapp:${cleanPh}`;

    // Combine text and mediaUrl if provided
    let contentToStore = text || '';
    if (mediaUrl) {
      if (mediaType === 'application/pdf' || mediaUrl.endsWith('.pdf')) {
        contentToStore = contentToStore ? `${contentToStore}\n[PDF: ${mediaUrl}]` : `[PDF: ${mediaUrl}]`;
      } else if (mediaType?.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif)$/i.test(mediaUrl) || mediaUrl.startsWith('data:image/')) {
        contentToStore = contentToStore ? `${contentToStore}\n[Image: ${mediaUrl}]` : `[Image: ${mediaUrl}]`;
      } else {
        contentToStore = contentToStore ? `${contentToStore}\n[Attachment: ${mediaUrl}]` : `[Attachment: ${mediaUrl}]`;
      }
    }

    console.log(`Sending manual WhatsApp message to ${twilioTo}: ${contentToStore}`);

    let deliveryStatus = 'SENT';
    let failureReason = null;

    // 1. Send via Twilio if configured
    if (isTwilioConfigured) {
      try {
        const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
        const payload = {
          body: text || '',
          from: TWILIO_WHATSAPP_FROM,
          to: twilioTo
        };
        if (mediaUrl && (mediaUrl.startsWith('http://') || mediaUrl.startsWith('https://'))) {
          payload.mediaUrl = [mediaUrl];
        }
        await client.messages.create(payload);
      } catch (err) {
        console.error('Twilio manual send failed:', err.message);
        deliveryStatus = 'FAILED';
        failureReason = err.message;
      }
    } else {
      console.log(`[MANUAL TWILIO DRY-RUN] To: ${twilioTo}, Content: ${contentToStore}`);
    }

    const numberPart = cleanPh.replace('+', '');

    // 2. Check if Client exists for linking
    const clientRecord = await prisma.client.findFirst({
      where: { phone: { contains: numberPart } }
    });

    const staffUserId = req.user?.id || null;
    const staffName = req.user?.fullName || 'Agent';
    const staffRole = req.user?.role || 'consultant';

    // 3. Log OUTBOUND message to Database
    const log = await prisma.communicationLog.create({
      data: {
        clientId: clientRecord ? clientRecord.id : null,
        phone: cleanPh,
        name: staffName,
        respondedByUserId: staffUserId,
        channel: 'WHATSAPP',
        direction: 'OUTBOUND',
        content: contentToStore,
        deliveryStatus: deliveryStatus,
        failureReason: failureReason
      },
      include: {
        respondedByUser: {
          select: { id: true, fullName: true, role: true, avatar: true }
        }
      }
    });

    const respondedByObj = log.respondedByUser ? {
      id: log.respondedByUser.id,
      name: log.respondedByUser.fullName,
      role: log.respondedByUser.role,
      avatar: log.respondedByUser.avatar
    } : { name: staffName, role: staffRole };

    // 4. Broadcast via WebSockets
    const io = req.app.get('io');
    if (io) {
      io.emit('new_whatsapp_message', {
        phone: cleanPh,
        name: staffName,
        text: contentToStore,
        mediaUrl: mediaUrl || null,
        mediaType: mediaType || null,
        timestamp: log.createdAt,
        sender: 'agent',
        respondedBy: respondedByObj
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Message sent successfully',
      log: {
        id: log.id,
        sender: 'agent',
        text: log.content,
        mediaUrl: mediaUrl || null,
        mediaType: mediaType || null,
        timestamp: log.createdAt,
        respondedBy: respondedByObj
      }
    });
  } catch (error) {
    console.error('Error sending social message:', error.message);
    return res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};
