const prisma = require('../config/db');

const getLeads = async (req, res) => {
  try {
    const leads = await prisma.lead.findMany({
      include: {
        assignedTo: {
          select: { fullName: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    // Map to frontend expectation
    const mapped = leads.map(l => ({
      ...l,
      name: `${l.firstName} ${l.lastName}`,
      serviceId: l.serviceType,
      assignedConsultantId: l.assignedToId,
      assignedConsultantName: l.assignedTo?.fullName
    }));
    res.json(mapped);
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching leads', error: error.message });
  }
};

const createLead = async (req, res) => {
  try {
    const { 
      firstName, 
      lastName, 
      email, 
      phone, 
      source, 
      campaignId, 
      serviceType, 
      serviceId, 
      nationality, 
      preferredLanguage, 
      applicantsCount,
      meetingPreferredDate,
      meetingPreferredTime,
      meetingPreferredLanguage,
      meetingNotes
    } = req.body;
    
    // Normalize phone number to check for existing lead (last 10 digits to match with or without country code)
    const cleanPhone = phone ? phone.replace(/\D/g, '') : '';
    const matchDigits = cleanPhone.length >= 10 ? cleanPhone.slice(-10) : cleanPhone;
    
    let lead = null;
    if (matchDigits) {
      lead = await prisma.lead.findFirst({
        where: {
          phone: {
            contains: matchDigits
          }
        }
      });
    }

    // Simple auto-assign logic: assign to first available consultant
    const consultants = await prisma.user.findMany({ where: { role: 'consultant' } });
    const assignedToId = consultants.length > 0 ? consultants[0].id : null;

    if (lead) {
      // Update existing lead
      lead = await prisma.lead.update({
        where: { id: lead.id },
        data: {
          firstName: firstName || lead.firstName,
          lastName: lastName || lead.lastName,
          email: email || lead.email,
          phone: phone || lead.phone,
          nationality: nationality || lead.nationality,
          preferredLanguage: preferredLanguage || lead.preferredLanguage,
          serviceType: serviceType || serviceId || lead.serviceType,
          applicantsCount: applicantsCount ? String(applicantsCount) : lead.applicantsCount,
          source: source || lead.source,
          campaignId: campaignId || lead.campaignId,
          meetingPreferredDate: meetingPreferredDate || lead.meetingPreferredDate,
          meetingPreferredTime: meetingPreferredTime || lead.meetingPreferredTime,
          meetingPreferredLanguage: meetingPreferredLanguage || lead.meetingPreferredLanguage,
          meetingNotes: meetingNotes || lead.meetingNotes,
          formSubmittedAt: meetingPreferredDate ? new Date() : lead.formSubmittedAt,
          status: meetingPreferredDate ? 'Form Submitted' : lead.status
        }
      });
      console.log(`Lead updated via upsert (ID: ${lead.id}, Phone: ${lead.phone})`);
    } else {
      // Create new lead
      lead = await prisma.lead.create({
        data: {
          firstName,
          lastName,
          email,
          phone,
          source,
          campaignId,
          serviceType: serviceType || serviceId,
          nationality,
          preferredLanguage,
          applicantsCount: applicantsCount ? String(applicantsCount) : undefined,
          meetingPreferredDate,
          meetingPreferredTime,
          meetingPreferredLanguage,
          meetingNotes,
          assignedToId,
          formSubmittedAt: meetingPreferredDate ? new Date() : undefined,
          status: meetingPreferredDate ? 'Form Submitted' : 'New Lead'
        }
      });
      console.log(`New Lead created (ID: ${lead.id}, Phone: ${lead.phone})`);
    }

    // Auto-create consultation if assigned and meeting details are provided
    if (lead.assignedToId && lead.meetingPreferredDate) {
      const existingCons = await prisma.consultation.findFirst({
        where: { leadId: lead.id }
      });
      if (!existingCons) {
        const meetingLink = 'https://zoom.us/j/' + Math.floor(100000000 + Math.random() * 900000000);
        const consultation = await prisma.consultation.create({
          data: {
            date: lead.meetingPreferredDate,
            timeSlot: lead.meetingPreferredTime || 'TBD',
            durationMinutes: 30,
            status: 'Pending Acceptance',
            leadId: lead.id,
            consultantId: lead.assignedToId,
            internalNotes: lead.meetingNotes || '',
            meetingLink: meetingLink
          }
        });
        console.log(`Auto-created consultation (ID: ${consultation.id}) for Lead: ${lead.id}`);

        // Send instant booking confirmation email to the lead
        const { sendEmail } = require('../services/emailService');
        if (lead.email) {
          sendEmail({
            to: lead.email,
            subject: 'Spain Visa Eligibility Assessment Scheduled - AAA Visa',
            html: `
              <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px; color: #2d3748;">
                <div style="text-align: center; margin-bottom: 24px;">
                  <h2 style="color: #4f46e5; margin: 0;">AAA Business Consultancy</h2>
                  <p style="color: #718096; font-size: 14px; margin: 4px 0 0;">Relocation & Spain Visa Services</p>
                </div>
                <h3 style="color: #1a202c; border-bottom: 1px solid #edf2f7; padding-bottom: 10px;">Booking Confirmation 🎉</h3>
                <p>Hello <strong>${lead.firstName} ${lead.lastName}</strong>,</p>
                <p>Thank you for submitting your booking preferences. We have scheduled your Free 20-Minute Eligibility Assessment consultation.</p>
                
                <div style="background-color: #f7fafc; border-left: 4px solid #4f46e5; padding: 16px; margin: 20px 0; border-radius: 4px;">
                  <h4 style="margin: 0 0 8px; color: #4f46e5;">Appointment Details</h4>
                  <p style="margin: 4px 0;"><strong>Date:</strong> ${lead.meetingPreferredDate}</p>
                  <p style="margin: 4px 0;"><strong>Preferred Time Slot:</strong> ${lead.meetingPreferredTime}</p>
                  <p style="margin: 4px 0;"><strong>Language:</strong> ${lead.meetingPreferredLanguage || 'English'}</p>
                  <p style="margin: 4px 0;"><strong>Meeting Link:</strong> <a href="${meetingLink}" style="color: #4f46e5; text-decoration: underline;">Join Zoom Call</a></p>
                </div>
                
                <p>A Spain Visa expert has been assigned to your case and will meet you online at the scheduled time.</p>
                <p style="font-size: 13px; color: #718096; margin-top: 30px; border-top: 1px solid #edf2f7; padding-top: 10px;">
                  This is an automated notification from AAA Visa CRM. Please do not reply directly to this email.
                </p>
              </div>
            `
          }).catch(err => console.error('Failed to send instant confirmation email:', err));
        }
      }
    }

    res.status(201).json(lead);
  } catch (error) {
    console.error('Error in createLead:', error);
    res.status(500).json({ message: 'Server error creating lead', error: error.message });
  }
};

const assignLead = async (req, res) => {
  try {
    const { leadId, agentId } = req.body;
    const lead = await prisma.lead.update({
      where: { id: leadId },
      data: { assignedToId: agentId }
    });
    res.json(lead);
  } catch (error) {
    res.status(500).json({ message: 'Server error assigning lead' });
  }
};

const updateLeadStatus = async (req, res) => {
  try {
    const { leadId, status } = req.body;
    const lead = await prisma.lead.update({
      where: { id: leadId },
      data: { status }
    });
    res.json(lead);
  } catch (error) {
    res.status(500).json({ message: 'Server error updating status' });
  }
};

const deleteLead = async (req, res) => {
  try {
    const { id } = req.params;

    // Delete associated consultations first to avoid foreign key constraint violations
    await prisma.consultation.deleteMany({
      where: { leadId: id }
    });

    // Delete the lead
    const lead = await prisma.lead.delete({
      where: { id }
    });

    res.json({ success: true, message: 'Lead deleted successfully', lead });
  } catch (error) {
    res.status(500).json({ message: 'Server error deleting lead', error: error.message });
  }
};

const getLeadById = async (req, res) => {
  try {
    const { id } = req.params;
    const lead = await prisma.lead.findUnique({
      where: { id },
      include: {
        assignedTo: {
          select: { fullName: true }
        }
      }
    });
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }
    const mapped = {
      ...lead,
      name: `${lead.firstName} ${lead.lastName}`,
      serviceId: lead.serviceType,
      assignedConsultantId: lead.assignedToId,
      assignedConsultantName: lead.assignedTo?.fullName
    };
    res.json(mapped);
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching lead details', error: error.message });
  }
};

const updateLead = async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      firstName, 
      lastName, 
      email, 
      phone, 
      nationality, 
      preferredLanguage, 
      serviceId, 
      applicantsCount, 
      source, 
      campaignId, 
      status, 
      notes, 
      timeline, 
      qualificationData,
      assignedConsultantId 
    } = req.body;

    const lead = await prisma.lead.update({
      where: { id },
      data: {
        firstName,
        lastName,
        email,
        phone,
        nationality,
        preferredLanguage,
        serviceType: serviceId,
        applicantsCount: applicantsCount ? String(applicantsCount) : undefined,
        source,
        campaignId,
        status,
        notes,
        timeline,
        qualificationData,
        assignedToId: assignedConsultantId
      }
    });

    const mapped = {
      ...lead,
      name: `${lead.firstName} ${lead.lastName}`,
      serviceId: lead.serviceType,
      assignedConsultantId: lead.assignedToId
    };
    res.json(mapped);
  } catch (error) {
    res.status(500).json({ message: 'Server error updating lead', error: error.message });
  }
};

// Find lead by email — used by public self-fill form
async function findLeadByEmail(req, res) {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }
    const lead = await prisma.lead.findFirst({
      where: { email: email.toLowerCase().trim() }
    });
    if (!lead) {
      return res.status(404).json({ message: 'No lead found with this email. Please contact us.' });
    }
    // Return only safe fields to the public form
    res.json({
      id: lead.id,
      firstName: lead.firstName,
      lastName: lead.lastName,
      email: lead.email,
      phone: lead.phone,
      nationality: lead.nationality,
      preferredLanguage: lead.preferredLanguage,
      serviceType: lead.serviceType,
      meetingPreferredDate: lead.meetingPreferredDate,
      meetingPreferredTime: lead.meetingPreferredTime,
      meetingPreferredLanguage: lead.meetingPreferredLanguage,
      meetingNotes: lead.meetingNotes,
      formSubmittedAt: lead.formSubmittedAt
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
}

// Update meeting preferences — called when lead submits self-fill form
async function updateMeetingPreference(req, res) {
  try {
    const { id } = req.params;
    const {
      firstName,
      lastName,
      phone,
      nationality,
      preferredLanguage,
      meetingPreferredDate,
      meetingPreferredTime,
      meetingPreferredLanguage,
      meetingNotes
    } = req.body;

    const lead = await prisma.lead.update({
      where: { id },
      data: {
        firstName,
        lastName,
        phone,
        nationality,
        preferredLanguage,
        meetingPreferredDate,
        meetingPreferredTime,
        meetingPreferredLanguage,
        meetingNotes,
        formSubmittedAt: new Date(),
        status: 'Form Submitted'
      }
    });

    // Auto-create consultation if assigned
    if (lead.assignedToId) {
      const existingCons = await prisma.consultation.findFirst({
        where: { leadId: lead.id }
      });
      if (!existingCons) {
        await prisma.consultation.create({
          data: {
            date: meetingPreferredDate,
            timeSlot: meetingPreferredTime || 'TBD',
            durationMinutes: 30,
            status: 'Pending Acceptance',
            leadId: lead.id,
            consultantId: lead.assignedToId,
            internalNotes: meetingNotes || ''
          }
        });
      }
    }

    res.json({
      success: true,
      message: 'Shukriya! Aapki details save ho gayi hain. Hum jald hi aapse contact karenge.',
      lead: {
        id: lead.id,
        firstName: lead.firstName,
        formSubmittedAt: lead.formSubmittedAt
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error saving meeting preferences', error: error.message });
  }
}

module.exports = { 
  getLeads, 
  createLead, 
  assignLead, 
  updateLeadStatus, 
  deleteLead,
  getLeadById, 
  updateLead, 
  findLeadByEmail, 
  updateMeetingPreference 
};


