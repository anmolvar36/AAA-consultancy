const prisma = require('../config/db');
const zoomService = require('../services/zoomService');

const getConsultations = async (req, res) => {
  try {
    const consultations = await prisma.consultation.findMany({
      include: {
        lead: { select: { firstName: true, lastName: true, email: true } },
        consultant: { select: { fullName: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    
    const mapped = consultations.map(c => {
      let parsedOutcome = null;
      try {
        if (c.eligibility && c.eligibility.startsWith('{')) {
          parsedOutcome = JSON.parse(c.eligibility);
        }
      } catch (e) {}
      
      return {
        ...c,
        outcome: parsedOutcome,
        meetingDate: c.date,
        meetingTime: c.timeSlot,
        clientName: c.lead ? `${c.lead.firstName} ${c.lead.lastName}` : 'Unknown',
        agentName: c.consultant?.fullName || 'Unassigned'
      };
    });
    
    res.json(mapped);
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching consultations' });
  }
};

const createConsultation = async (req, res) => {
  try {
    const { leadId, meetingDate, meetingTime, durationMinutes, assignedConsultantId, notes } = req.body;
    
    let meetingLink = 'https://zoom.us/j/' + Math.floor(100000000 + Math.random() * 900000000);
    
    if (zoomService.isConfigured) {
      try {
        let startTimeISO = new Date().toISOString();
        if (meetingDate) {
          const timeStr = meetingTime && meetingTime.includes(':') ? meetingTime : '10:00';
          const dateObj = new Date(`${meetingDate}T${timeStr}`);
          if (!isNaN(dateObj.getTime())) {
            startTimeISO = dateObj.toISOString();
          }
        }
        
        const zoomMeeting = await zoomService.createZoomMeeting({
          topic: `Eligibility Assessment for Lead ${leadId || ''}`,
          startTime: startTimeISO,
          durationMinutes: durationMinutes || 30
        });
        
        if (zoomMeeting) {
          meetingLink = zoomMeeting.joinUrl;
        }
      } catch (zoomErr) {
        console.error('Failed to create Zoom meeting, falling back to mock link:', zoomErr.message);
      }
    }
    
    const consultation = await prisma.consultation.create({
      data: {
        leadId,
        date: meetingDate,
        timeSlot: meetingTime,
        durationMinutes: durationMinutes || 30,
        consultantId: assignedConsultantId,
        internalNotes: notes,
        meetingLink
      }
    });

    res.status(201).json(consultation);
  } catch (error) {
    console.error('Error booking consultation:', error);
    res.status(500).json({ message: 'Server error booking consultation' });
  }
};

const updateOutcome = async (req, res) => {
  try {
    const { id } = req.params;
    let { status, eligibility, recommendedService, recommendedPackageId, internalNotes } = req.body;
    
    // If frontend sends an object (outcome), stringify it for DB storage
    if (typeof eligibility === 'object' && eligibility !== null) {
      eligibility = JSON.stringify(eligibility);
    }
    
    const consultation = await prisma.consultation.update({
      where: { id },
      data: { status, eligibility, recommendedService, recommendedPackageId, internalNotes }
    });
    
    res.json(consultation);
  } catch (error) {
    res.status(500).json({ message: 'Server error updating consultation outcome' });
  }
};

const respondToConsultation = async (req, res) => {
  try {
    const { id } = req.params;
    const { action, declineReason } = req.body; // action: 'accept' | 'decline'

    if (!['accept', 'decline'].includes(action)) {
      return res.status(400).json({ message: 'Invalid action. Must be accept or decline.' });
    }

    const isDecline = action === 'decline';
    const newStatus = isDecline ? 'Declined' : 'Scheduled';

    const consultation = await prisma.consultation.update({
      where: { id },
      data: {
        status: newStatus,
        consultantId: isDecline ? null : undefined, // Remove from agent's calendar
        internalNotes: isDecline && declineReason
          ? `[Agent Declined]: ${declineReason}`
          : undefined
      },
      include: {
        lead: { select: { id: true, firstName: true, lastName: true } },
        consultant: { select: { fullName: true } }
      }
    });

    if (isDecline && consultation.lead?.id) {
      // Unassign the lead so it goes back to Admin pool
      await prisma.lead.update({
        where: { id: consultation.lead.id },
        data: { 
          assignedToId: null, 
          status: 'Agent Declined',
          notes: declineReason ? `Meeting declined by agent. Reason: ${declineReason}` : 'Meeting declined by agent.'
        }
      });
    }

    res.json({
      success: true,
      status: newStatus,
      message: action === 'accept'
        ? 'Meeting accepted successfully!'
        : 'Meeting declined. Lead has been sent back to Admin for reassignment.',
      consultation
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error responding to consultation', error: error.message });
  }
};

// Auto-create a consultation with "Pending Acceptance" when admin assigns an agent
const createConsultationForLead = async (req, res) => {
  try {
    const { leadId, consultantId, meetingDate, meetingTime, durationMinutes } = req.body;

    // Check if a Pending Acceptance consultation already exists for this lead
    const existing = await prisma.consultation.findFirst({
      where: { leadId, status: 'Pending Acceptance' }
    });
    if (existing) {
      // Just reassign the existing one
      const updated = await prisma.consultation.update({
        where: { id: existing.id },
        data: { consultantId, status: 'Pending Acceptance' }
      });
      return res.json({ success: true, consultation: updated, reassigned: true });
    }

    let meetingLink = 'https://zoom.us/j/' + Math.floor(100000000 + Math.random() * 900000000);
    
    if (zoomService.isConfigured) {
      try {
        let startTimeISO = new Date().toISOString();
        if (meetingDate) {
          const timeStr = meetingTime && meetingTime.includes(':') ? meetingTime : '10:00';
          const dateObj = new Date(`${meetingDate}T${timeStr}`);
          if (!isNaN(dateObj.getTime())) {
            startTimeISO = dateObj.toISOString();
          }
        }
        
        const zoomMeeting = await zoomService.createZoomMeeting({
          topic: `Eligibility Assessment for Lead ${leadId || ''}`,
          startTime: startTimeISO,
          durationMinutes: durationMinutes || 30
        });
        
        if (zoomMeeting) {
          meetingLink = zoomMeeting.joinUrl;
        }
      } catch (zoomErr) {
        console.error('Failed to create Zoom meeting, falling back to mock link:', zoomErr.message);
      }
    }

    const consultation = await prisma.consultation.create({
      data: {
        leadId,
        consultantId,
        date: meetingDate || '',
        timeSlot: meetingTime || 'TBD',
        durationMinutes: durationMinutes || 30,
        status: 'Pending Acceptance',
        meetingLink
      }
    });

    res.status(201).json({ success: true, consultation });
  } catch (error) {
    res.status(500).json({ message: 'Server error creating consultation for lead', error: error.message });
  }
};

module.exports = { getConsultations, createConsultation, updateOutcome, respondToConsultation, createConsultationForLead };

