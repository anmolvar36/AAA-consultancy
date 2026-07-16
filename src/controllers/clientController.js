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
      assignedConsultantId: c.assignedToId,
      hasCredentials: !!c.password
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
      leadId, packageId, applicantsCount, status, profileSummary,
      dependentsDetails
    } = req.body;
    
    // Frontend sometimes sends assignedConsultantId instead of assignedToId
    const finalAssignedTo = assignedToId || assignedConsultantId;

    // Fetch dependentsDetails from lead if leadId is passed
    let fetchedDependentsDetails = null;
    if (leadId) {
      try {
        const leadObj = await prisma.lead.findUnique({
          where: { id: leadId },
          select: { dependentsDetails: true }
        });
        if (leadObj && leadObj.dependentsDetails) {
          fetchedDependentsDetails = leadObj.dependentsDetails;
        }
      } catch (err) {
        console.warn("Could not fetch lead dependents details:", err);
      }
    }

    const finalDeps = dependentsDetails || fetchedDependentsDetails;

    // Check if client with this email already exists
    let client = null;
    let credentialsGenerated = false;
    let plainPassword = '';

    if (email) {
      client = await prisma.client.findUnique({
        where: { email }
      });
    }

    if (client) {
      let updateData = {
        firstName: firstName || client.firstName,
        lastName: lastName || client.lastName,
        phone: phone || client.phone,
        nationality: nationality || client.nationality,
        serviceType: serviceType || serviceId || client.serviceType,
        assignedToId: finalAssignedTo || client.assignedToId,
        packageId: packageId || client.packageId,
        applicantsCount: applicantsCount ? String(applicantsCount) : client.applicantsCount,
        dependentsDetails: finalDeps !== undefined && finalDeps !== null ? finalDeps : client.dependentsDetails,
        status: status || client.status,
        profileSummary: profileSummary || client.profileSummary
      };

      // Generate credentials if missing
      if (!client.password) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%';
        for (let i = 0; i < 8; i++) plainPassword += chars.charAt(Math.floor(Math.random() * chars.length));

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(plainPassword, salt);
        updateData.password = hashedPassword;
        updateData.isTemporaryPassword = true;
        credentialsGenerated = true;
      }

      // If it exists, update it to associate with the converted lead's details
      client = await prisma.client.update({
        where: { id: client.id },
        data: updateData
      });
    } else {
      // Generate secure random password for new client
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%';
      for (let i = 0; i < 8; i++) plainPassword += chars.charAt(Math.floor(Math.random() * chars.length));

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(plainPassword, salt);
      credentialsGenerated = true;

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
          dependentsDetails: finalDeps || undefined,
          status: status || 'Waiting for Payment',
          profileSummary,
          password: hashedPassword,
          isTemporaryPassword: true
        }
      });
    }

    // Send auto welcome email with portal credentials dynamically
    if (credentialsGenerated && client.email) {
      const { sendEmail } = require('../services/emailService');
      const { getCustomization } = require('./settingsController');
      
      const settings = getCustomization();
      const flowSettings = settings.flowAutomationSettings || {};
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      const portalUrl = `${frontendUrl}/#/portal/login`;
      
      const customSubject = flowSettings.welcomeEmailSubject || 'Welcome to AAA Business Consultancy - Your Client Portal is Ready! ✈️';
      let customHtml = flowSettings.welcomeEmailTemplate || '';
      
      if (!customHtml) {
        customHtml = `
          <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px; color: #2d3748;">
            <div style="text-align: center; margin-bottom: 24px;">
              <h2 style="color: #4f46e5; margin: 0;">AAA Business Consultancy</h2>
              <p style="color: #718096; font-size: 14px; margin: 4px 0 0;">Relocation & Spain Visa Services</p>
            </div>
            <h3 style="color: #1a202c; border-bottom: 1px solid #edf2f7; padding-bottom: 10px;">Welcome to the Client Portal! 🎉</h3>
            <p>Hello <strong>{client_name}</strong>,</p>
            <p>Congratulations! Your file has been initialized. We have successfully set up your profile and created your Client Portal account.</p>
            <p>You can now log in to select your relocation package, complete your payment, and upload your visa documents.</p>
            <div style="background-color: #f7fafc; border-left: 4px solid #4f46e5; padding: 16px; margin: 20px 0; border-radius: 4px;">
              <h4 style="margin: 0 0 8px; color: #4f46e5;">Access Credentials</h4>
              <p style="margin: 4px 0;"><strong>Portal URL:</strong> <a href="{portal_url}" style="color: #4f46e5; text-decoration: underline;">Login Here</a></p>
              <p style="margin: 4px 0;"><strong>Username:</strong> {username}</p>
              <p style="margin: 4px 0;"><strong>Temporary Password:</strong> <code style="background-color: #edf2f7; padding: 2px 6px; border-radius: 4px; font-weight: bold; color: #e11d48;">{temp_password}</code></p>
            </div>
            <p style="font-size: 13px; color: #e11d48; font-weight: 600;">
              ⚠️ Note: For your security, you will be prompted to change this temporary password immediately upon your first login.
            </p>
            <p>If you have any questions, feel free to contact your assigned consultant.</p>
            <p style="font-size: 13px; color: #718096; margin-top: 30px; border-top: 1px solid #edf2f7; padding-top: 10px;">
              This is an automated notification from AAA Visa CRM. Please do not reply directly to this email.
            </p>
          </div>
        `;
      }
      
      // Perform dynamic placeholders replacement
      const clientFullName = `${client.firstName} ${client.lastName}`;
      const renderedHtml = customHtml
        .replace(/{client_name}/g, clientFullName)
        .replace(/{portal_url}/g, portalUrl)
        .replace(/{username}/g, client.email)
        .replace(/{temp_password}/g, plainPassword);

      sendEmail({
        to: client.email,
        subject: customSubject,
        html: renderedHtml
      }).catch(err => console.error('Failed to send auto welcome email:', err));
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

    if (req.user.role === 'client' && req.user.id !== id) {
      return res.status(403).json({ message: 'Access denied. You cannot select packages for other clients.' });
    }

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

    if (req.user.role === 'client' && req.user.id !== id) {
      return res.status(403).json({ message: 'Access denied. You cannot change password for other clients.' });
    }
    
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

    if (req.user.role === 'client' && req.user.id !== id) {
      return res.status(403).json({ message: 'Access denied. You cannot modify family profiles for other clients.' });
    }

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
