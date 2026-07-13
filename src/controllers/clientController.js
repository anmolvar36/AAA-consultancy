const prisma = require('../config/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const getClients = async (req, res) => {
  try {
    const clients = await prisma.client.findMany({
      include: {
        assignedTo: { select: { fullName: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    
    const mapped = clients.map(c => ({
      ...c,
      name: `${c.firstName} ${c.lastName}`,
      serviceId: c.serviceType,
      assignedConsultantName: c.assignedTo?.fullName,
      assignedConsultantId: c.assignedToId
    }));
    
    res.json(mapped);
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching clients' });
  }
};

const createClient = async (req, res) => {
  try {
    const { 
      firstName, lastName, email, phone, nationality, 
      serviceType, serviceId, assignedToId, assignedConsultantId, 
      leadId, packageId, applicantsCount, status, profileSummary 
    } = req.body;
    
    // Frontend sometimes sends assignedConsultantId instead of assignedToId
    const finalAssignedTo = assignedToId || assignedConsultantId;

    // Check if client with this email already exists
    let client = null;
    if (email) {
      client = await prisma.client.findUnique({
        where: { email }
      });
    }

    if (client) {
      // If it exists, update it to associate with the converted lead's details
      client = await prisma.client.update({
        where: { id: client.id },
        data: {
          firstName: firstName || client.firstName,
          lastName: lastName || client.lastName,
          phone: phone || client.phone,
          nationality: nationality || client.nationality,
          serviceType: serviceType || serviceId || client.serviceType,
          assignedToId: finalAssignedTo || client.assignedToId,
          packageId: packageId || client.packageId,
          applicantsCount: applicantsCount ? String(applicantsCount) : client.applicantsCount,
          status: status || client.status,
          profileSummary: profileSummary || client.profileSummary
        }
      });
    } else {
      client = await prisma.client.create({
        data: {
          firstName,
          lastName,
          email,
          phone,
          nationality,
          serviceType: serviceType || serviceId,
          assignedToId: finalAssignedTo,
          packageId,
          applicantsCount: String(applicantsCount),
          status: status || 'Waiting for Payment',
          profileSummary
        }
      });
    }

    if (leadId) {
      await prisma.lead.update({
        where: { id: leadId },
        data: { clientId: client.id }
      });
    }

    res.status(201).json(client);
  } catch (error) {
    console.error('Error creating client:', error);
    res.status(500).json({ message: 'Server error creating client', error: error.message });
  }
};

const updateClientStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, visaStatus } = req.body;
    
    const data = {};
    if (status) data.status = status;
    if (visaStatus) data.visaStatus = visaStatus;
    
    const client = await prisma.client.update({
      where: { id },
      data
    });
    
    res.json(client);
  } catch (error) {
    res.status(500).json({ message: 'Server error updating client' });
  }
};

const selectPackage = async (req, res) => {
  try {
    const { id } = req.params;
    const { packageId, status, visaStatus } = req.body;

    const client = await prisma.client.update({
      where: { id },
      data: {
        packageId: packageId || undefined,
        documentUploadAllowed: true,
        status: status || 'Payment Received',
        visaStatus: visaStatus || 'Document Preparation'
      }
    });

    res.json({ success: true, client });
  } catch (error) {
    console.error('Error selecting package:', error);
    res.status(500).json({ message: 'Server error selecting package' });
  }
};

const generateCredentials = async (req, res) => {
  try {
    const { id } = req.params;
    const { forceReset } = req.query;

    const client = await prisma.client.findUnique({
      where: { id }
    });

    if (!client) {
      return res.status(404).json({ message: 'Client not found' });
    }

    if (client.password && forceReset !== 'true') {
      return res.json({ 
        success: true, 
        alreadyExists: true, 
        username: client.email,
        message: 'Credentials already generated' 
      });
    }

    // Generate a secure random 8-character password
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%';
    let plainPassword = '';
    for (let i = 0; i < 8; i++) plainPassword += chars.charAt(Math.floor(Math.random() * chars.length));

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(plainPassword, salt);

    await prisma.client.update({
      where: { id },
      data: { password: hashedPassword, isTemporaryPassword: true }
    });

    // Return the plaintext password so it can be securely displayed/emailed ONCE
    res.json({ success: true, password: plainPassword, username: client.email });
  } catch (error) {
    console.error('Error in generateCredentials:', error);
    res.status(500).json({ message: 'Server error generating credentials' });
  }
};

const clientLogin = async (req, res) => {
  try {
    const { clientId, password } = req.body;
    const loginIdentifier = clientId ? clientId.trim() : '';

    const client = await prisma.client.findFirst({
      where: {
        OR: [
          { email: loginIdentifier.toLowerCase() },
          { id: loginIdentifier }
        ]
      }
    });

    if (!client || !client.password) {
      return res.status(401).json({ message: 'Invalid credentials or portal access not generated yet' });
    }

    const isMatch = await bcrypt.compare(password, client.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: client.id, role: 'client' },
      process.env.JWT_SECRET || 'secret123',
      { expiresIn: '30d' }
    );

    res.json({
      token,
      client: {
        id: client.id,
        firstName: client.firstName,
        lastName: client.lastName,
        email: client.email,
        isTemporaryPassword: client.isTemporaryPassword
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error logging in client' });
  }
};

const changeClientPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;
    
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters long' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await prisma.client.update({
      where: { id },
      data: { password: hashedPassword, isTemporaryPassword: false }
    });

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error updating password' });
  }
};

const updateClientDependents = async (req, res) => {
  try {
    const { id } = req.params;
    const { dependents } = req.body;

    const client = await prisma.client.update({
      where: { id },
      data: {
        dependentsDetails: dependents
      }
    });

    res.json({ success: true, client });
  } catch (error) {
    console.error('Error updating client dependents:', error);
    res.status(500).json({ message: 'Server error updating family profiles' });
  }
};

module.exports = { 
  getClients, 
  createClient, 
  updateClientStatus, 
  selectPackage, 
  generateCredentials, 
  clientLogin, 
  changeClientPassword,
  updateClientDependents
};
