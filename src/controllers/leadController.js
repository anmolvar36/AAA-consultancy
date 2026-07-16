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
      dependentsDetails,
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
      return res.status(400).json({ message: 'Number already exists' });
    }

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
          dependentsDetails: dependentsDetails || undefined,
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

    // Auto-create consultation if assigned and meeting details are provided
    await syncLeadConsultation(lead.id);

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
    await syncLeadConsultation(lead.id);
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

    await syncLeadConsultation(lead.id);

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

// Find lead by ID — used by public self-fill form to securely retrieve details
async function getPublicLeadDetails(req, res) {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ message: 'Lead ID is required' });
    }
    const lead = await prisma.lead.findUnique({
      where: { id }
    });
    if (!lead) {
      return res.status(404).json({ message: 'No lead found with this ID' });
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
    res.status(500).json({ message: 'Server error fetching lead details', error: error.message });
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

    // Auto-create/update consultation if assigned
    await syncLeadConsultation(lead.id);

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

// Sync Consultation Session and generate/update meeting details and link
async function syncLeadConsultation(leadId) {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId }
    });
    if (!lead || !lead.assignedToId || !lead.meetingPreferredDate) {
      return;
    }

    const { getCustomization } = require('./settingsController');
    const settings = getCustomization();
    const duration = settings.flowAutomationSettings?.defaultMeetingDuration || 30;

    let consultation = await prisma.consultation.findFirst({
      where: { leadId: lead.id }
    });

    // Generate real Zoom meeting if Zoom is configured
    const zoomService = require('../services/zoomService');
    let meetingLink = consultation?.meetingLink;
    let consultationStatus = consultation?.status || 'Pending Acceptance';

    if (!meetingLink) {
      if (zoomService.isConfigured) {
        try {
          let startTimeISO = new Date().toISOString();
          if (lead.meetingPreferredDate) {
            const timeStr = lead.meetingPreferredTime && lead.meetingPreferredTime.includes(':') 
              ? lead.meetingPreferredTime 
              : '10:00';
            const dateObj = new Date(`${lead.meetingPreferredDate}T${timeStr}`);
            if (!isNaN(dateObj.getTime())) {
              startTimeISO = dateObj.toISOString();
            }
          }
          const zoomMeeting = await zoomService.createZoomMeeting({
            topic: `Eligibility Assessment for ${lead.firstName} ${lead.lastName}`,
            startTime: startTimeISO,
            durationMinutes: Number(duration) || 30
          });
          if (zoomMeeting) {
            meetingLink = zoomMeeting.joinUrl;
            consultationStatus = 'Scheduled'; // If Zoom is ready, it's Scheduled
          }
        } catch (zoomErr) {
          console.error('Failed to create Zoom meeting during lead sync:', zoomErr.message);
        }
      }

      if (!meetingLink) {
        meetingLink = 'https://zoom.us/j/' + Math.floor(100000000 + Math.random() * 900000000);
      }
    }

    if (!consultation) {
      consultation = await prisma.consultation.create({
        data: {
          date: lead.meetingPreferredDate,
          timeSlot: lead.meetingPreferredTime || 'TBD',
          durationMinutes: Number(duration),
          status: consultationStatus,
          leadId: lead.id,
          consultantId: lead.assignedToId,
          internalNotes: lead.meetingNotes || '',
          meetingLink: meetingLink
        }
      });
      console.log(`Auto-created consultation (ID: ${consultation.id}) for Lead: ${lead.id}`);
    } else {
      consultation = await prisma.consultation.update({
        where: { id: consultation.id },
        data: {
          date: lead.meetingPreferredDate,
          timeSlot: lead.meetingPreferredTime || 'TBD',
          consultantId: lead.assignedToId,
          status: consultationStatus,
          meetingLink: meetingLink
        }
      });
      console.log(`Updated consultation (ID: ${consultation.id}) for Lead: ${lead.id}`);
    }

    // Send instant confirmation email & WhatsApp to the lead
    const { sendEmail } = require('../services/emailService');
    const { sendWhatsAppMessage } = require('../services/whatsappService');
    const { remindersQueue } = require('../queues/queueSetup');

    const name = `${lead.firstName} ${lead.lastName}`;
    const date = lead.meetingPreferredDate;
    const time = lead.meetingPreferredTime || 'TBD';

    console.log(`[NOTIFICATIONS] Dispatching lead confirmation for: ${name} (${lead.phone} / ${lead.email})`);

    // 1. Send WhatsApp Message
    try {
      await sendWhatsAppMessage({
        to: lead.phone,
        templateName: 'consultation_scheduled_confirmation',
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: lead.firstName },
              { type: 'text', text: date },
              { type: 'text', text: time },
              { type: 'text', text: meetingLink }
            ]
          }
        ]
      });
    } catch (waErr) {
      console.error('[NOTIFICATIONS] Failed to send WhatsApp confirmation:', waErr.message);
    }

    // 2. Send Email
    try {
      const emailHtml = `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px; color: #2d3748;">
          <div style="text-align: center; margin-bottom: 24px;">
            <h2 style="color: #4f46e5; margin: 0;">AAA Business Consultancy</h2>
            <p style="color: #718096; font-size: 14px; margin: 4px 0 0;">Relocation & Spain Visa Services</p>
          </div>
          <h3 style="color: #1a202c; border-bottom: 1px solid #edf2f7; padding-bottom: 10px;">Booking Details 🎉</h3>
          <p>Hello <strong>${lead.firstName} ${lead.lastName}</strong>,</p>
          <p>We have scheduled/updated your Free Eligibility Assessment consultation.</p>
          
          <div style="background-color: #f7fafc; border-left: 4px solid #4f46e5; padding: 16px; margin: 20px 0; border-radius: 4px;">
            <h4 style="margin: 0 0 8px; color: #4f46e5;">Appointment Details</h4>
            <p style="margin: 4px 0;"><strong>Date:</strong> ${date}</p>
            <p style="margin: 4px 0;"><strong>Preferred Time Slot:</strong> ${time}</p>
            <p style="margin: 4px 0;"><strong>Language:</strong> ${lead.meetingPreferredLanguage || lead.preferredLanguage || 'English'}</p>
            <p style="margin: 4px 0;"><strong>Meeting Link:</strong> <a href="${meetingLink}" style="color: #4f46e5; text-decoration: underline;">Join Zoom Call</a></p>
          </div>
          
          <p>A Spain Visa expert has been assigned to your case and will meet you online at the scheduled time.</p>
          <p style="font-size: 13px; color: #718096; margin-top: 30px; border-top: 1px solid #edf2f7; padding-top: 10px;">
            This is an automated notification from AAA Visa CRM. Please do not reply directly to this email.
          </p>
        </div>
      `;
      await sendEmail({
        to: lead.email,
        subject: 'Spain Visa Eligibility Assessment Scheduled - AAA Visa',
        html: emailHtml
      });
    } catch (emailErr) {
      console.error('[NOTIFICATIONS] Failed to send Email confirmation:', emailErr.message);
    }

    // 3. Schedule 3 Reminders
    if (remindersQueue && remindersQueue.add) {
      const meetingStart = new Date(`${date}T${time.includes(':') ? time : '10:00'}`);
      if (!isNaN(meetingStart.getTime())) {
        const now = Date.now();

        const scheduleReminder = async (label, timeBeforeMs, subject, textLabel) => {
          const reminderTime = meetingStart.getTime() - timeBeforeMs;
          const delay = reminderTime - now;
          if (delay > 0) {
            await remindersQueue.add('send-reminder', {
              toEmail: lead.email,
              toPhone: lead.phone,
              subject: subject,
              emailHtml: `<h3>Meeting Reminder</h3><p>Dear ${lead.firstName}, your Spain Visa Consultation is in ${textLabel}.</p><p>Zoom Join Link: <a href="${meetingLink}">${meetingLink}</a></p>`,
              whatsappTemplate: 'consultation_scheduled_confirmation',
              whatsappComponents: [
                {
                  type: 'body',
                  parameters: [
                    { type: 'text', text: lead.firstName },
                    { type: 'text', text: date },
                    { type: 'text', text: time },
                    { type: 'text', text: meetingLink }
                  ]
                }
              ]
            }, {
              jobId: `reminder-${label}-${consultation.id}`,
              delay: delay
            });
            console.log(`[NOTIFICATIONS] Enqueued ${label} reminder with delay: ${Math.round(delay / 60000)} minutes`);
          }
        };

        await scheduleReminder('24h', 24 * 60 * 60 * 1000, 'Reminder: Spain Visa Consultation in 24 Hours', '24 Hours');
        await scheduleReminder('1h', 1 * 60 * 60 * 1000, 'Reminder: Spain Visa Consultation in 1 Hour', '1 Hour');
        await scheduleReminder('10m', 10 * 60 * 1000, 'Urgent Reminder: Spain Visa Consultation in 10 Minutes', '10 Minutes');
      }
    }

  } catch (error) {
    console.error('Error in syncLeadConsultation:', error);
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
  getPublicLeadDetails, 
  updateMeetingPreference 
};


