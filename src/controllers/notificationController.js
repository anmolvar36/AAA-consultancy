const prisma = require('../config/db');

// GET /api/v1/notifications/my — fetch all notifications for logged-in user
const getMyNotifications = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    res.json(notifications);
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ message: 'Server error fetching notifications' });
  }
};

// GET /api/v1/notifications/unread-count
const getUnreadCount = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ count: 0 });

    const count = await prisma.notification.count({
      where: { userId, isRead: false }
    });

    res.json({ count });
  } catch (error) {
    res.status(500).json({ count: 0 });
  }
};

// PATCH /api/v1/notifications/:id/read
const markRead = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    await prisma.notification.updateMany({
      where: { id, userId },
      data: { isRead: true }
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: 'Server error marking notification read' });
  }
};

// PATCH /api/v1/notifications/read-all
const markAllRead = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true }
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: 'Server error marking all read' });
  }
};

// Internal helper — called from documentController on upload
const createDocumentNotification = async ({ userId, clientName, clientId, documentId, documentName, category }) => {
  try {
    if (!userId) return;

    await prisma.notification.create({
      data: {
        userId,
        type: 'new_document',
        title: `📄 New Document from ${clientName}`,
        body: `${clientName} uploaded "${documentName}" (${category}). Please review and verify.`,
        clientId,
        documentId,
        isRead: false
      }
    });

    // WhatsApp/Email stub — will activate when API keys are added to .env
    if (process.env.META_WHATSAPP_TOKEN && process.env.META_WHATSAPP_TOKEN !== 'your_meta_whatsapp_token_here') {
      console.log(`[WhatsApp STUB] Would send to operator ${userId}: ${clientName} uploaded ${documentName}`);
      // TODO: integrate Meta WhatsApp Cloud API here
    } else {
      console.log(`[Notification Created] Operator ${userId} ← ${clientName} uploaded "${documentName}" (${category})`);
    }

    if (process.env.SENDGRID_API_KEY && process.env.SENDGRID_API_KEY !== 'your_sendgrid_key_here') {
      console.log(`[Email STUB] Would email operator ${userId}: ${clientName} uploaded ${documentName}`);
      // TODO: integrate SendGrid/SES here
    }
  } catch (error) {
    console.error('Error creating notification:', error);
    // Non-fatal — don't throw, just log
  }
};

module.exports = { getMyNotifications, getUnreadCount, markRead, markAllRead, createDocumentNotification };
