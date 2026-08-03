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
      createdDate: l.createdAt,
      assignedAt: l.assignedAt || l.createdAt,
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
      countryOfResidence,
      preferredLanguage, 
      applicantsCount,
      dependentsDetails,
      meetingPreferredDate,
      meetingPreferredTime,
      meetingPreferredLanguage,
      meetingNotes,
      qualificationData,
      preferableArea,
      budget,
      sourceLanguage,
      targetLanguage,
      wordCount
    } = req.body;
    
    // Normalize phone number to check for existing lead (last 10 digits to match with or without country code)
    const cleanEmail = email ? String(email).toLowerCase().trim() : '';
    const cleanPhone = phone ? String(phone).replace(/\D/g, '') : '';
    const matchDigits = cleanPhone.length >= 10 ? cleanPhone.slice(-10) : cleanPhone;

    // Build OR conditions safely so OR array is never empty
    const matchConditions = [];
    if (cleanEmail) matchConditions.push({ email: cleanEmail });
    if (matchDigits) matchConditions.push({ phone: { contains: matchDigits } });

    // 1. Check blocked client
    let blockedClient = null;
    if (matchConditions.length > 0) {
      blockedClient = await prisma.client.findFirst({
        where: {
          isBlocked: true,
          OR: matchConditions
        }
      });
    }

    if (blockedClient) {
      return res.status(403).json({
        code: 'BLOCKED',
        message: 'Your booking cannot be processed automatically. Contact support.'
      });
    }

    // 2. Check blacklist first
    let blacklisted = null;
    if (matchConditions.length > 0) {
      blacklisted = await prisma.blacklistedClient.findFirst({
        where: {
          OR: matchConditions
        }
      });
    }

    const { isNameSimilar } = require('../utils/fuzzyMatch');
    const blacklist = await prisma.blacklistedClient.findMany();
    const fullNameInput = `${firstName || ''} ${lastName || ''}`.trim();
    const matchesBlacklistByName = fullNameInput.length > 2 && blacklist.some(b => isNameSimilar(fullNameInput, b.name));

    if (blacklisted || matchesBlacklistByName) {
      return res.status(403).json({
        code: 'BLACKLISTED',
        message: 'This profile is not eligible for further eligibility assessments due to a previous missed appointment.'
      });
    }
    
    // 3. Check for Duplicate Active Bookings (Status-aware based on Most Recent Lead)
    let latestLead = null;
    if (matchConditions.length > 0) {
      latestLead = await prisma.lead.findFirst({
        where: {
          OR: matchConditions
        },
        orderBy: { createdAt: 'desc' }
      });
    }

    const inactiveStatuses = ['Lost Lead', 'Spam', 'Cold Lead', 'No Show', 'Completed', 'Cancelled', 'Canceled', 'Refused'];
    
    if (latestLead && !inactiveStatuses.includes(latestLead.status)) {
      const qual = (typeof latestLead.qualificationData === 'object' && latestLead.qualificationData !== null) ? latestLead.qualificationData : {};
      const isPaidReschedule = qual?.assessmentCredit === 250 || qual?.isNoShowPaid || latestLead.status === 'Partial Paid' || req.body.leadId === latestLead.id;

      if (!isPaidReschedule) {
        return res.status(409).json({
          code: 'DUPLICATE_LEAD',
          message: 'You already have an active booking or application under this email/phone.'
        });
      }
    }

    let lead = null;

    // Smart auto-assign: prefer property specialist for Property Investment leads
    const finalServiceType = serviceType || serviceId || '';
    const isPropertyLead = finalServiceType.toLowerCase().includes('property') || finalServiceType.toLowerCase().includes('investment');
    let assignedToId = null;
    if (isPropertyLead) {
      // Try to find a property specialist first
      const propertySpecialists = await prisma.user.findMany({ where: { role: 'consultant', isPropertySpecialist: true } });
      if (propertySpecialists.length > 0) {
        assignedToId = propertySpecialists[0].id;
      } else {
        // Fallback to any available consultant
        const consultants = await prisma.user.findMany({ where: { role: 'consultant' } });
        assignedToId = consultants.length > 0 ? consultants[0].id : null;
      }
    } else {
      // Normal round-robin assignment for non-property leads
      const consultants = await prisma.user.findMany({ where: { role: 'consultant' } });
      assignedToId = consultants.length > 0 ? consultants[0].id : null;
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
          countryOfResidence: countryOfResidence || null,
          preferredLanguage,
          applicantsCount: applicantsCount ? String(applicantsCount) : undefined,
          dependentsDetails: dependentsDetails || undefined,
          meetingPreferredDate,
          meetingPreferredTime,
          meetingPreferredLanguage,
          meetingNotes,
          qualificationData: qualificationData || undefined,
          assignedToId,
          assignedAt: assignedToId ? new Date() : null,
          preferableArea: preferableArea || null,
          budget: budget || null,
          sourceLanguage: sourceLanguage || null,
          targetLanguage: targetLanguage || null,
          wordCount: wordCount ? parseInt(wordCount, 10) : null,
          formSubmittedAt: meetingPreferredDate ? new Date() : undefined,
          status: meetingPreferredDate ? 'Form Submitted' : 'New Lead'
        }
      });
      console.log(`New Lead created (ID: ${lead.id}, Phone: ${lead.phone})`);

      // Trigger In-App Notifications for all staff
      const { createLeadNotification } = require('./notificationController');
      createLeadNotification({
        leadName: `${lead.firstName} ${lead.lastName}`,
        email: lead.email,
        phone: lead.phone,
        country: lead.countryOfResidence,
        serviceCategory: lead.serviceType,
        appointmentDate: lead.meetingPreferredDate ? `${lead.meetingPreferredDate} ${lead.meetingPreferredTime || ''}` : null,
        reqApp: req.app
      }).catch(err => console.error('[Lead Notification Error]:', err.message));

    // Auto-create consultation — runs in background, does NOT block response
    res.status(201).json(lead);
    syncLeadConsultation(lead.id).catch(err => console.error('[BG] syncLeadConsultation failed:', err.message));
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
      data: { assignedToId: agentId, assignedAt: new Date() }
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

    if (status === 'No Show' || status === 'No-Show') {
      if (lead && lead.email) {
        try {
          await prisma.blacklistedClient.upsert({
            where: { email: lead.email.toLowerCase() },
            update: { phone: lead.phone || '' },
            create: {
              email: lead.email.toLowerCase(),
              name: `${lead.firstName || ''} ${lead.lastName || ''}`.trim(),
              phone: lead.phone || ''
            }
          });
          console.log(`[Blacklist] Blacklisted client on No Show status: ${lead.email}`);
        } catch (dbErr) {
          console.error('[Blacklist] Failed to insert blacklist record:', dbErr.message);
        }
      }

      // Automated No-Show WhatsApp and Email notification disabled per user instruction
      console.log(`[No Show LeadStatus] Lead ${lead?.email || lead?.id} marked No Show. Automated message suppressed.`);
    } else if (lead.email || lead.phone) {
      // Automatically unblock/remove from blacklistedClient when status is changed away from No Show
      try {
        const cleanEmail = (lead.email || '').toLowerCase().trim();
        const cleanPhone = (lead.phone || '').replace(/\D/g, '');
        const matchConditions = [];
        if (cleanEmail) matchConditions.push({ email: cleanEmail });
        if (cleanPhone) matchConditions.push({ phone: { contains: cleanPhone.slice(-10) } });

        if (matchConditions.length > 0) {
          await prisma.blacklistedClient.deleteMany({
            where: { OR: matchConditions }
          });
          console.log(`[Unblock] Removed from blacklist as status changed to ${status}: ${lead.email}`);

          // Send Unblock Pre-filled Reschedule Link Notification via WhatsApp & Email
          try {
            const { sendCustomWhatsApp } = require('../services/chatbotService');
            const { sendEmail } = require('../services/emailService');
            const clientName = `${lead.firstName} ${lead.lastName}`;
            const rescheduleUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/#/public/lead-form?id=${lead.id}&reschedule=true`;

            const unblockMsg = `Hello *${clientName}*,\n\nGreat news! Your Spain Visa Eligibility Assessment booking has been *restored & unblocked* by our team. 🇪🇸\n\nPlease choose your preferred date and time to select your new consultation meeting:\n🔗 ${rescheduleUrl}`;

            if (lead.phone) {
              sendCustomWhatsApp(lead.phone, unblockMsg).catch(err => console.error('[Unblock WA Error]:', err.message));
            }
            if (lead.email) {
              sendEmail({
                to: lead.email,
                subject: 'Your Spain Visa Consultation Booking Has Been Restored - AAA Business Consultancy',
                html: `
                  <h3>Consultation Booking Restored ✈️</h3>
                  <p>Dear ${lead.firstName},</p>
                  <p>Great news! Your Spain Visa Eligibility Assessment booking has been <strong>restored and unblocked</strong> by our team.</p>
                  <p>Please click the link below to select your new consultation meeting date and time slot (your contact details are pre-filled):</p>
                  <p><a href="${rescheduleUrl}" style="background-color: #1a56db; color: white; padding: 10px 18px; text-decoration: none; border-radius: 5px; font-weight: bold;">Select New Meeting Slot</a></p>
                  <p>Or copy this link into your browser: <br><a href="${rescheduleUrl}">${rescheduleUrl}</a></p>
                  <p>Thank you for choosing AAA Business Consultancy!</p>
                `
              }).catch(err => console.error('[Unblock Email Error]:', err.message));
            }
          } catch (notifyErr) {
            console.error('[Unblock Notification Error]:', notifyErr.message);
          }
        }
      } catch (dbErr) {
        console.error('[Unblock] Failed to remove blacklist record:', dbErr.message);
      }
    }

    const { logActivity } = require('../services/auditService');
    const actorName = req.user ? (req.user.fullName || req.user.email) : 'System';
    const actorRole = req.user ? (req.user.role || 'staff') : 'system';
    logActivity({
      leadId: lead.id,
      actorId: req.user?.id || 'system',
      actorName,
      actorRole,
      action: 'STATUS_CHANGED',
      description: `Lead status updated to "${status}" by ${actorName}.`
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

    // Wipe Redis Chatbot Session & Agent Mode lock so new message triggers fresh greeting link
    if (lead && lead.phone) {
      try {
        const { connection: redis } = require('../queues/connection');
        const cleanPhone = '+' + lead.phone.replace(/[^\d]/g, '');
        if (redis && redis.del) {
          await redis.del(`chatbot:session:${cleanPhone}`);
          await redis.del(`chatbot:agent_mode:${cleanPhone}`);
          console.log(`[Redis Cleanup] Cleared chatbot session & agent mode for deleted lead phone ${cleanPhone}`);
        }
      } catch (rErr) {
        console.warn('[Redis Cleanup Error]:', rErr.message);
      }
    }

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

    if (lead.assignedToId) {
      await syncLeadConsultation(lead.id).catch(err => console.error('[getLeadById] Sync Error:', err.message));
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
      assignedConsultantId,
      preferableArea,
      budget,
      sourceLanguage,
      targetLanguage,
      wordCount,
      nextFollowUpDate
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
        assignedToId: assignedConsultantId,
        ...(assignedConsultantId ? { assignedAt: new Date() } : {}),
        nextFollowUpDate: nextFollowUpDate !== undefined ? (nextFollowUpDate ? new Date(nextFollowUpDate) : null) : undefined,
        preferableArea: preferableArea !== undefined ? preferableArea : undefined,
        budget: budget !== undefined ? budget : undefined,
        sourceLanguage: sourceLanguage !== undefined ? sourceLanguage : undefined,
        targetLanguage: targetLanguage !== undefined ? targetLanguage : undefined,
        wordCount: wordCount !== undefined ? (wordCount ? parseInt(wordCount, 10) : null) : undefined
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
      meetingNotes,
      qualificationData,
      serviceType,
      serviceId
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
        qualificationData: qualificationData || undefined,
        serviceType: serviceType || serviceId || undefined,
        formSubmittedAt: new Date(),
        status: 'Form Submitted'
      }
    });

    // Auto-create/update consultation — runs in background, does NOT block response
    res.json({
      success: true,
      message: 'Shukriya! Aapki details save ho gayi hain. Hum jald hi aapse contact karenge.',
      lead: {
        id: lead.id,
        firstName: lead.firstName,
        formSubmittedAt: lead.formSubmittedAt
      }
    });
    syncLeadConsultation(lead.id).catch(err => console.error('[BG] syncLeadConsultation failed:', err.message));
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
    if (!lead || !lead.assignedToId) {
      return;
    }

    const { getCustomization } = require('./settingsController');
    const settings = getCustomization();
    const duration = settings.flowAutomationSettings?.defaultMeetingDuration || 30;

    let consultation = await prisma.consultation.findFirst({
      where: { leadId: lead.id }
    });

    const zoomService = require('../services/zoomService');
    const { sendCustomWhatsApp } = require('../services/chatbotService');
    const { sendEmail } = require('../services/emailService');

    const fallbackDate = lead.formSubmittedAt ? new Date(lead.formSubmittedAt).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
    const meetingDate = lead.meetingPreferredDate || fallbackDate;
    const meetingTime = lead.meetingPreferredTime || '09:00';

    let meetingLink = `https://zoom.us/j/${Math.floor(Math.random() * 9000000000 + 1000000000)}`;
    if (zoomService && zoomService.isConfigured) {
      try {
        const timeStr = meetingTime && meetingTime.includes(':') ? meetingTime : '09:00';
        const dateObj = new Date(`${meetingDate}T${timeStr}`);
        const startTimeISO = !isNaN(dateObj.getTime()) ? dateObj.toISOString() : new Date().toISOString();
        const zoomMeeting = await zoomService.createZoomMeeting({
          topic: `Eligibility Assessment for ${lead.firstName} ${lead.lastName}`,
          startTime: startTimeISO,
          durationMinutes: Number(duration)
        });
        if (zoomMeeting && zoomMeeting.joinUrl) {
          meetingLink = zoomMeeting.joinUrl;
        }
      } catch (zErr) {
        console.warn('[SyncConsultation] Zoom generation error:', zErr.message);
      }
    }

    if (!consultation) {
      consultation = await prisma.consultation.create({
        data: {
          date: meetingDate,
          timeSlot: meetingTime,
          durationMinutes: Number(duration),
          status: 'Scheduled',
          leadId: lead.id,
          consultantId: lead.assignedToId,
          internalNotes: lead.meetingNotes || '',
          meetingLink: meetingLink
        }
      });
      console.log(`Auto-created Scheduled consultation (ID: ${consultation.id}) for Lead: ${lead.id}`);
    } else {
      consultation = await prisma.consultation.update({
        where: { id: consultation.id },
        data: {
          date: meetingDate,
          timeSlot: meetingTime,
          status: 'Scheduled',
          consultantId: lead.assignedToId,
          meetingLink: meetingLink,
          internalNotes: lead.meetingNotes || consultation.internalNotes || ''
        }
      });
    }

    // Update Lead status to 'Meeting Scheduled'
    await prisma.lead.update({
      where: { id: lead.id },
      data: { status: 'Meeting Scheduled' }
    }).catch(() => null);

    // Send instant WhatsApp & Email confirmation to customer
    const clientName = `${lead.firstName} ${lead.lastName}`;
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const rescheduleUrl = `${frontendUrl}/#/public/lead-form?reschedule=true&consultationId=${consultation.id}`;
    const cancelUrl = `${frontendUrl}/#/public/lead-form?cancel=true&consultationId=${consultation.id}`;
    const packagesUrl = "https://aaabusinessconsultancy.com/services-and-packages/";

    const waMsg = `✈️ *Spain Visa Consultation Confirmed!*

Dear *${clientName}*,

Your Spain Visa Eligibility Assessment is confirmed.

📅 *Date:* ${meetingDate}
⏰ *Time:* ${meetingTime} (UTC)
🔗 *Zoom Join Link:* ${meetingLink}

─────────────
👇 *Quick Action Links:*
• 🔄 *Reschedule Booking:* ${rescheduleUrl}
• ❌ *Cancel Booking:* ${cancelUrl}
• 📦 *View Visa Packages:* ${packagesUrl}

_Note: Please join within 10 minutes of appointment time to avoid automatic cancellation._`;

    if (lead.phone) {
      sendCustomWhatsApp(lead.phone, waMsg).catch(err => console.error('[SyncConsultation WA Error]:', err.message));
    }
    if (lead.email) {
      sendEmail({
        to: lead.email,
        subject: 'Spain Visa Consultation Confirmed - AAA Business Consultancy',
        html: `
          <h3>Spain Visa Consultation Confirmed ✈️</h3>
          <p>Dear ${lead.firstName},</p>
          <p>Your Spain Visa Eligibility Assessment is confirmed.</p>
          <p><strong>Date:</strong> ${meetingDate}<br><strong>Time:</strong> ${meetingTime} (UTC)<br><strong>Zoom Join Link:</strong> <a href="${meetingLink}">${meetingLink}</a></p>
          <p>Thank you for choosing AAA Business Consultancy!</p>
        `
      }).catch(err => console.error('[SyncConsultation Email Error]:', err.message));
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


