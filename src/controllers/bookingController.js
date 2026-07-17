const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { remindersQueue, noShowEnforcerQueue } = require('../queues/queueSetup');
const { PDFParse } = require('pdf-parse');
const { sendEmail } = require('../services/emailService');
const { sendWhatsAppMessage } = require('../services/whatsappService');
const zoomService = require('../services/zoomService');

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
    let lead = await prisma.lead.findUnique({ where: { clientId: client.id } });
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

    let meetingLink = null;
    let consultationStatus = 'REQUESTED';

    if (zoomService.isConfigured) {
      try {
        let startTimeISO = new Date().toISOString();
        const timeStr = timeSlot && timeSlot.includes(':') ? timeSlot : '10:00';
        const dateObj = new Date(`${date}T${timeStr}`);
        if (!isNaN(dateObj.getTime())) {
          startTimeISO = dateObj.toISOString();
        }

        const zoomMeeting = await zoomService.createZoomMeeting({
          topic: `Eligibility Assessment for ${firstName} ${lastName}`,
          startTime: startTimeISO,
          durationMinutes: 20
        });

        if (zoomMeeting) {
          meetingLink = zoomMeeting.joinUrl;
          consultationStatus = 'Scheduled';
        }
      } catch (zoomErr) {
        console.error('Failed to create Zoom meeting for booking:', zoomErr.message);
      }
    }

    // 6. Create Booking (Consultation)
    const consultation = await prisma.consultation.create({
      data: {
        date,
        timeSlot,
        status: consultationStatus,
        leadId: lead.id,
        meetingLink
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

    // Asynchronously trigger instant Email and WhatsApp confirmations + reminders
    (async () => {
      try {
        const clientName = `${firstName} ${lastName}`;
        const link = meetingLink || 'https://zoom.us';

        console.log(`[NOTIFICATIONS] Dispatching booking confirmation for Lead: ${clientName} (${phone} / ${email})`);

        // 1. Send WhatsApp Message
        try {
          await sendWhatsAppMessage({
            to: phone,
            templateName: 'consultation_scheduled_confirmation',
            components: [
              {
                type: 'body',
                parameters: [
                  { type: 'text', text: firstName },
                  { type: 'text', text: date },
                  { type: 'text', text: timeSlot },
                  { type: 'text', text: link }
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
            <h3>Spain Visa & Relocation - Assessment Booking Confirmed</h3>
            <p>Dear ${firstName},</p>
            <p>Thank you for booking your Free Eligibility Assessment and Consultation with AAA Business Consultancy.</p>
            <p><strong>Appointment Details:</strong></p>
            <ul>
              <li><strong>Date:</strong> ${date}</li>
              <li><strong>Time:</strong> ${timeSlot} (UTC)</li>
              <li><strong>Duration:</strong> 20 Minutes</li>
            </ul>
            <p><strong>Meeting Join Link:</strong><br/>
               <em>The Zoom meeting join link will be shared with you shortly via email once a consultant is confirmed. Please stay tuned and join the meeting on time.</em>
            </p>
            <p><em>Important: If you do not join your scheduled Free Eligibility Assessment within 10 minutes of the appointment time, your booking will be automatically cancelled. Due to high demand, missed appointments are not eligible for rescheduling.</em></p>
            <p>Thank you for choosing AAA Business Consultancy!</p>
          `;
          await sendEmail({
            to: email,
            subject: 'Booking Confirmed: Spain Visa Eligibility Assessment',
            html: emailHtml
          });
        } catch (emailErr) {
          console.error('[NOTIFICATIONS] Failed to send Email confirmation:', emailErr.message);
        }

        // 3. Schedule 3 Reminders (24h, 1h, 10m before)
        if (remindersQueue && remindersQueue.add) {
          const mStart = new Date(`${date}T${timeSlot.includes(':') ? timeSlot : '10:00'}`);
          if (!isNaN(mStart.getTime())) {
            const now = Date.now();

            const scheduleReminder = async (label, timeBeforeMs, subject, textLabel) => {
              const reminderTime = mStart.getTime() - timeBeforeMs;
              const dly = reminderTime - now;
              if (dly > 0) {
                await remindersQueue.add('send-reminder', {
                  toEmail: email,
                  toPhone: phone,
                  subject: subject,
                  emailHtml: `<h3>Meeting Reminder</h3><p>Dear ${firstName}, your Spain Visa Consultation is in ${textLabel}.</p><p>Zoom Join Link: <a href="${link}">${link}</a></p>`,
                  whatsappTemplate: 'consultation_scheduled_confirmation',
                  whatsappComponents: [
                    {
                      type: 'body',
                      parameters: [
                        { type: 'text', text: firstName },
                        { type: 'text', text: date },
                        { type: 'text', text: timeSlot },
                        { type: 'text', text: link }
                      ]
                    }
                  ]
                }, {
                  jobId: `reminder-${label}-${consultation.id}`,
                  delay: dly
                });
                console.log(`[NOTIFICATIONS] Enqueued ${label} reminder with delay: ${Math.round(dly / 60000)} minutes`);
              }
            };

            await scheduleReminder('24h', 24 * 60 * 60 * 1000, 'Reminder: Spain Visa Consultation in 24 Hours', '24 Hours');
            await scheduleReminder('1h', 1 * 60 * 60 * 1000, 'Reminder: Spain Visa Consultation in 1 Hour', '1 Hour');
            await scheduleReminder('10m', 10 * 60 * 1000, 'Urgent Reminder: Spain Visa Consultation in 10 Minutes', '10 Minutes');
          }
        }
      } catch (err) {
        console.error('[NOTIFICATIONS] Error sending booking confirmation:', err);
      }
    })().catch(err => console.error('[NOTIFICATIONS] Async error:', err));

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

function getTranslationRate(sourceLanguage) {
  const lang = (sourceLanguage || 'English').toLowerCase().trim();
  if (lang.includes('arabic')) {
    return 0.25;
  }
  if (lang.includes('urdu')) {
    return 0.40;
  }
  // Default (English)
  return 0.15;
}

function calculateSwornTranslationPrice(wordCount, sourceLanguage) {
  const rate = getTranslationRate(sourceLanguage);
  const subtotal = wordCount * rate;
  const vat = subtotal * 0.05;
  return parseFloat((subtotal + vat).toFixed(2));
}

exports.uploadTranslationDocument = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    if (req.file.mimetype !== 'application/pdf') {
      return res.status(400).json({ success: false, message: 'Only PDF files are supported' });
    }

    // Parse PDF using PDFParse class (correct API: pass data + verbosity in constructor, then call getText())
    const parser = new PDFParse({ data: req.file.buffer, verbosity: 0 });
    const result = await parser.getText();
    const text = (result.pages || []).map(p => p.text || '').join('\n');

    // Count words (naive whitespace split)
    const wordCount = text.trim().split(/\s+/).filter(word => word.length > 0).length;

    const sourceLanguage = req.body.sourceLanguage || 'English';
    const calculatedPrice = calculateSwornTranslationPrice(wordCount, sourceLanguage);

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

exports.checkoutTranslationDocument = async (req, res) => {
  const crypto = require('crypto');
  const bcrypt = require('bcrypt');

  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const {
      firstName,
      lastName,
      email,
      phone,
      nationality,
      sourceLanguage,
      targetLanguage,
      wordCount,
      estimatedPrice
    } = req.body;

    if (!firstName || !lastName || !email || !phone) {
      return res.status(400).json({ success: false, message: 'Missing required client details' });
    }

    // 1. Find or create Client
    let client = await prisma.client.findUnique({
      where: { email: email.toLowerCase() }
    });

    let generatedPassword = '';
    if (!client) {
      generatedPassword = crypto.randomBytes(8).toString('hex');
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(generatedPassword, salt);

      client = await prisma.client.create({
        data: {
          firstName,
          lastName,
          email: email.toLowerCase(),
          phone,
          nationality: nationality || null,
          serviceType: 'Spanish Sworn Translation',
          password: hashedPassword,
          isTemporaryPassword: true,
          status: 'Documents Under Review',
          sourceLanguage: sourceLanguage || 'English',
          targetLanguage: targetLanguage || 'Spanish',
          wordCount: parseInt(wordCount, 10) || 0
        }
      });
    } else {
      client = await prisma.client.update({
        where: { id: client.id },
        data: {
          status: 'Documents Under Review',
          sourceLanguage: sourceLanguage || undefined,
          targetLanguage: targetLanguage || undefined,
          wordCount: wordCount ? parseInt(wordCount, 10) : undefined
        }
      });
    }

    // 2. Save Document record
    let category = req.body.category || 'Translation Input';
    if (category.startsWith('Other: ')) {
      category = category.replace('Other: ', '');
    }

    await prisma.document.create({
      data: {
        clientId: client.id,
        name: req.file.originalname,
        category: category,
        url: `/uploads/${req.file.filename}`,
        size: `${(req.file.size / 1024 / 1024).toFixed(2)} MB`,
        status: 'Pending Verification',
        belongsTo: 'Main Applicant'
      }
    });

    // 3. Create Case Cycle (ApplicationCycle)
    const applicationCycle = await prisma.applicationCycle.create({
      data: {
        clientId: client.id,
        serviceType: 'sworn_translation',
        status: 'Documents Under Review'
      }
    });

    // 4. Create Payment Record
    const finalPrice = calculateSwornTranslationPrice(Number(wordCount) || 0, sourceLanguage || 'English');

    // Check if Stripe is configured
    const stripeSecret = process.env.STRIPE_SECRET_KEY;
    const isRealStripe = stripeSecret && !stripeSecret.includes('your_stripe');

    const payment = await prisma.payment.create({
      data: {
        clientId: client.id,
        applicationId: applicationCycle.id,
        amount: finalPrice,
        totalPaid: isRealStripe ? 0 : finalPrice, // 0 paid initially for real Stripe
        status: isRealStripe ? 'Pending' : 'Paid',
        paymentMethod: isRealStripe ? 'Stripe' : 'Stripe Mock Auto',
        dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
      }
    });

    // 5. Generate Stripe Mock Link (Direct portal redirect for local testing)
    const frontendUrl = process.env.FRONTEND_URL || req.headers.origin || 'http://localhost:5173';
    const paymentUrl = `${frontendUrl}/#/portal/login?success=true&clientId=${client.id}&tempPassword=${generatedPassword || 'Pre-existing'}`;

    if (isRealStripe) {
      try {
        const stripe = require('stripe')(stripeSecret);
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ['card'],
          line_items: [{
            price_data: {
              currency: 'eur',
              product_data: {
                name: 'Spanish Sworn Translation Certification',
                description: `Sworn translation of documents. Source: ${sourceLanguage || 'English'}. Words: ${wordCount || 0}. (5% VAT Included)`,
              },
              unit_amount: Math.round(finalPrice * 100), // finalPrice already includes 5% VAT
            },
            quantity: 1,
          }],
          mode: 'payment',
          success_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/#/portal/login?success=true&clientId=${client.id}&tempPassword=${generatedPassword || 'Pre-existing'}&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/#/public/translation?cancel=true`,
          metadata: {
            clientId: client.id,
            paymentId: payment.id,
            serviceType: 'sworn_translation'
          }
        });
        paymentUrl = session.url;
        gatewayId = session.id;
      } catch (stripeErr) {
        console.error('Failed to create Stripe Session for Translation Checkout:', stripeErr);
      }
    }

    // Update payment record with gateway details
    await prisma.payment.update({
      where: { id: payment.id },
      data: { gatewayId }
    });

    return res.status(201).json({
      success: true,
      message: 'Checkout initialized successfully',
      data: {
        clientId: client.id,
        paymentUrl,
        tempPassword: generatedPassword || null
      }
    });

  } catch (error) {
    console.error('Translation Checkout Error:', error);
    return res.status(500).json({ success: false, error: 'Internal Server Error during checkout' });
  }
};
