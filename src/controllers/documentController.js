const prisma = require('../config/db');
const { createDocumentNotification } = require('./notificationController');

const getDocuments = async (req, res) => {
  try {
    const whereClause = req.user.role === 'client' ? { clientId: req.user.id } : {};

    const documents = await prisma.document.findMany({
      where: whereClause,
      include: {
        client: { select: { firstName: true, lastName: true } }
      },
      orderBy: { uploadedDate: 'desc' }
    });
    
    const mapped = documents.map(d => ({
      ...d,
      clientName: d.client ? `${d.client.firstName} ${d.client.lastName}` : 'Unknown'
    }));
    
    res.json(mapped);
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching documents' });
  }
};

const uploadDocument = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }
    
    const { clientId, category, belongsTo } = req.body;
    
    // 1. Save document to DB
    const document = await prisma.document.create({
      data: {
        clientId,
        name: req.file.originalname,
        category: category || 'General',
        url: `/uploads/${req.file.filename}`,
        size: `${(req.file.size / 1024 / 1024).toFixed(2)} MB`,
        status: 'Pending Verification',
        belongsTo: belongsTo || 'Main Applicant'
      }
    });

    // 2. Find the client to get their name and assigned operator
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { firstName: true, lastName: true, assignedToId: true }
    });

    if (client) {
      const clientName = `${client.firstName} ${client.lastName}`;

      // 3. Notify the assigned operator (if any)
      if (client.assignedToId) {
        await createDocumentNotification({
          userId: client.assignedToId,
          clientName,
          clientId,
          documentId: document.id,
          documentName: req.file.originalname,
          category: category || 'General'
        });
      } else {
        console.log(`[Notification] Client ${clientName} has no assigned operator — notification skipped.`);
      }
    }

    res.status(201).json(document);
  } catch (error) {
    console.error('Error uploading document:', error);
    res.status(500).json({ message: 'Server error uploading document' });
  }
};

const reviewDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, feedbackComment } = req.body;
    
    const document = await prisma.document.update({
      where: { id },
      data: { status, comment: feedbackComment }
    });
    
    res.json(document);
  } catch (error) {
    res.status(500).json({ message: 'Server error reviewing document' });
  }
};

const uploadTranslatedDocument = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const { id } = req.params;

    // 1. Update the document with translated url and status
    const document = await prisma.document.update({
      where: { id },
      data: {
        translatedUrl: `/uploads/${req.file.filename}`,
        status: 'Translated'
      },
      include: {
        client: true
      }
    });

    // 2. Trigger email to client notifying them that translation is ready
    if (document.client && document.client.email) {
      const { sendEmail } = require('../services/emailService');
      try {
        await sendEmail({
          to: document.client.email,
          subject: 'Your Certified Sworn Translation is Ready! 🇪🇸',
          html: `
            <h3>Dear ${document.client.firstName},</h3>
            <p>We are pleased to inform you that the sworn translation of your document (<b>${document.name}</b>) is complete and ready.</p>
            <p>You can now download the certified PDF directly from your Client Portal dashboard.</p>
            <p><a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/#/portal/login">Log in to Client Portal</a></p>
            <br/>
            <p>Best regards,<br/>AAA Business Consultancy Team</p>
          `
        });
      } catch (emailErr) {
        console.error('Failed to send email notification:', emailErr);
      }
    }

    res.json({ success: true, document });
  } catch (error) {
    console.error('Error uploading translated document:', error);
    res.status(500).json({ message: 'Server error uploading translated document' });
  }
};

module.exports = { getDocuments, uploadDocument, reviewDocument, uploadTranslatedDocument };
