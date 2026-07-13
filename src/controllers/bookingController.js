const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { remindersQueue, noShowEnforcerQueue } = require('../queues/queueSetup');
const pdfParse = require('pdf-parse');

exports.createEligibilityBooking = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      nationality,
      countryOfResidence,
      preferredLanguage,
      serviceType,
      applicantsCount,
      deviceFingerprint,
      date,
      timeSlot,
    } = req.body;

    // 1. Anti-Fraud & Identity Normalization
    const normalizedPhone = phone.replace(/[\s\-\+]/g, ''); // strip spaces, dashes, country code prefix (naively for now)

    // 2. Check for Blocking (Cross-Device Detection)
    const blockedClient = await prisma.client.findFirst({
      where: {
        isBlocked: true,
        OR: [
          { email: email.toLowerCase() },
          { phone: { contains: normalizedPhone } }, // Fuzzy match
          ...(deviceFingerprint ? [{ deviceFingerprint }] : [])
        ]
      }
    });

    if (blockedClient) {
      return res.status(403).json({
        success: false,
        message: 'Your booking cannot be processed automatically. Contact support.',
      });
    }

    // 3. Find or Create Client
    let client = await prisma.client.findUnique({
      where: { email: email.toLowerCase() }
    });

    if (!client) {
      client = await prisma.client.create({
        data: {
          firstName,
          lastName,
          email: email.toLowerCase(),
          phone,
          nationality,
          countryOfResidence,
          preferredLanguage,
          serviceType,
          applicantsCount,
          deviceFingerprint,
          status: 'Waiting for Assessment'
        }
      });
    } else {
      // Update device fingerprint if missing
      if (deviceFingerprint && !client.deviceFingerprint) {
        await prisma.client.update({
          where: { id: client.id },
          data: { deviceFingerprint }
        });
      }
    }

    // 4. Create Lead (if doesn't exist for UI compatibility)
    let lead = await prisma.lead.findUnique({ where: { clientId: client.id }});
    if (!lead) {
      lead = await prisma.lead.create({
        data: {
          firstName, lastName, email: email.toLowerCase(), phone, nationality, countryOfResidence,
          preferredLanguage, serviceType, applicantsCount, status: 'Assessment Booked',
          clientId: client.id
        }
      });
    }

    // 5. Create Application Cycle
    const appCycle = await prisma.applicationCycle.create({
      data: {
        clientId: client.id,
        serviceType,
        status: 'Assessment Booked'
      }
    });

    // 6. Create Booking (Consultation)
    const consultation = await prisma.consultation.create({
      data: {
        date,
        timeSlot,
        status: 'REQUESTED',
        leadId: lead.id,
      }
    });

    // 7. Enqueue Reminders and No-Show Enforcer Jobs
    // Assuming meeting date/time is parsed to a JS Date object `meetingStart`
    const meetingStart = new Date(`${date} ${timeSlot}`); // Naive parsing
    const tenMinsAfterStart = new Date(meetingStart.getTime() + 10 * 60000);

    // Schedule NO-SHOW enforcer precisely at meetingStart + 10 mins
    const delay = tenMinsAfterStart.getTime() - Date.now();
    
    if (delay > 0) {
      await noShowEnforcerQueue.add('enforce-no-show', {
        consultationId: consultation.id,
        clientId: client.id,
      }, {
        jobId: `noshow-${consultation.id}`,
        delay: delay
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Booking confirmed successfully',
      data: { consultation, client }
    });

  } catch (error) {
    console.error('Eligibility Booking Error:', error);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
};

exports.uploadTranslationDocument = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    if (req.file.mimetype !== 'application/pdf') {
      return res.status(400).json({ success: false, message: 'Only PDF files are supported' });
    }

    // Parse PDF
    const data = await pdfParse(req.file.buffer);
    const text = data.text;
    
    // Count words (naive whitespace split)
    const wordCount = text.trim().split(/\s+/).filter(word => word.length > 0).length;

    // Fetch settings for dynamic pricing
    let settings = await prisma.companySetting.findFirst();
    let rates = settings?.swornTranslationRates || { perWord: 0.10, baseFee: 20 };
    
    const calculatedPrice = (wordCount * rates.perWord) + rates.baseFee;

    return res.status(200).json({
      success: true,
      data: {
        wordCount,
        estimatedPrice: calculatedPrice,
        currency: 'EUR'
      }
    });

  } catch (error) {
    console.error('PDF Parse Error:', error);
    return res.status(500).json({ success: false, error: 'Failed to parse PDF document' });
  }
};
