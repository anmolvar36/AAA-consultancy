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

module.exports = { getDocuments, uploadDocument, reviewDocument };
