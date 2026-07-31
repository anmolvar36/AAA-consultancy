const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { paymentDripQueue } = require('../queues/queueSetup');

// Secure Payment State Machine Transition
const processPaymentEvent = async (event) => {
  try {
    const session = event.data.object;
    // Assuming we pass paymentId in client_reference_id or metadata
    const paymentId = session.client_reference_id || session.metadata?.paymentId;
    const transactionId = session.id;

    if (!paymentId) {
      console.warn('Payment Event received without paymentId reference', event.id);
      return;
    }

    // Use Prisma transaction for atomicity and idempotency check
    await prisma.$transaction(async (tx) => {
      // Find the payment record
      const payment = await tx.payment.findUnique({
        where: { id: paymentId },
        include: { client: true, applicationCycle: true }
      });

      if (!payment) {
        throw new Error(`Payment record ${paymentId} not found`);
      }

      // Idempotency: Ignore if this transactionId has already been successfully processed
      if (payment.transactionId === transactionId && payment.status === 'Paid') {
        console.log(`Payment event ${event.id} already processed. Skipping.`);
        return;
      }

      // Define state transition logic
      if (event.type === 'checkout.session.completed' || event.type === 'payment_intent.succeeded') {
        // Enforce deterministic transition rules (Only Pending -> Paid)
        if (payment.status !== 'Pending') {
          throw new Error(`Invalid state transition: Cannot transition from ${payment.status} to Paid`);
        }

        const totalPaid = session.amount_total ? session.amount_total / 100 : payment.amount;

        const clientWithAgent = await tx.client.findUnique({
          where: { id: payment.clientId },
          include: { assignedTo: true }
        });
        const snapshotRate = (clientWithAgent && clientWithAgent.assignedTo) 
          ? (clientWithAgent.assignedTo.commissionRate || 0) 
          : 0;

        await tx.payment.update({
          where: { id: paymentId },
          data: {
            status: 'Paid',
            transactionId: transactionId,
            paymentMethod: 'Stripe',
            totalPaid: totalPaid,
            commissionRate: snapshotRate
          }
        });

        // Trigger cascade state changes: If application exists, move to Active State
        if (payment.applicationId) {
          await tx.applicationCycle.update({
            where: { id: payment.applicationId },
            data: { status: 'Payment Received - Pending Docs' }
          });

          // Immutable Audit Log
          await tx.auditLog.create({
            data: {
              applicationId: payment.applicationId,
              actorId: 'System-StripeWebhook',
              action: 'PAYMENT_RECEIVED',
              newState: { status: 'Payment Received - Pending Docs' }
            }
          });
        }

        // Also update Client status and package details
        if (payment.client) {
          const isTranslation = (payment.client.serviceType || '').includes('Translation') || (payment.client.serviceId || '').includes('translation');
          const packageId = session.metadata?.packageId;
          const isNoShowAssessment = session.metadata?.type === 'no_show_case_assessment' || packageId === 'option_a' || packageId === 'Option A';

          const updatedClient = await tx.client.update({
            where: { id: payment.clientId },
            data: {
              documentUploadAllowed: !isNoShowAssessment, // Keep locked if it's only €250 case assessment
              packageId: packageId || undefined,
              status: isNoShowAssessment 
                ? 'Partially Paid' 
                : (isTranslation ? 'Documents Under Review' : 'Payment Received'),
              visaStatus: isNoShowAssessment
                ? 'Not Started'
                : (isTranslation ? 'Not Started' : 'Document Preparation')
            }
          });

          // Send Checklist Email only if they paid for full package
          if (!isNoShowAssessment) {
            try {
              const { sendVisaChecklist } = require('./emailService');
              await sendVisaChecklist(updatedClient.email, `${updatedClient.firstName} ${updatedClient.lastName}`, updatedClient.serviceType);
              console.log(`[Auto-Checklist Webhook] Sent checklist to client ${updatedClient.email} for ${updatedClient.serviceType}`);
            } catch (emailErr) {
              console.error('[Auto-Checklist Webhook] Failed to send checklist email:', emailErr.message);
            }
          }

          // Send Automated Payment Receipt & Credentials WhatsApp Message
          try {
            const { sendPaymentSuccessWhatsApp } = require('./whatsappService');
            await sendPaymentSuccessWhatsApp({
              client: updatedClient,
              paymentId: payment.id,
              amount: totalPaid,
              serviceType: updatedClient.serviceType,
              generatedPassword: session.metadata?.tempPassword || null
            });
            console.log(`[Auto-WhatsApp Payment Webhook] Sent payment success & portal credentials to client ${updatedClient.phone}`);
          } catch (waErr) {
            console.error('[Auto-WhatsApp Payment Webhook] Failed to send WhatsApp notification:', waErr.message);
          }
        }
        
        // Remove from payment drip queue if applicable (handled by queue removal logic usually)
        
      } else if (event.type === 'checkout.session.expired' || event.type === 'payment_intent.payment_failed') {
        // We do not change state from Pending, but we might enqueue a payment drip reminder
        await paymentDripQueue.add('payment-failed-reminder', {
          clientId: payment.clientId,
          paymentId: payment.id,
          amount: payment.amount
        });
      }
    });

  } catch (err) {
    console.error('Failed to process payment event:', err);
    throw err; // Allow BullMQ or caller to handle retry/dlq
  }
};

module.exports = {
  processPaymentEvent,
  createNoShowCheckoutSession: async (targetId) => {
    let lead = null;
    let client = null;

    if (targetId) {
      lead = await prisma.lead.findUnique({ where: { id: targetId } }).catch(() => null);
      if (!lead) {
        client = await prisma.client.findUnique({ where: { id: targetId } }).catch(() => null);
      }
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const stripeSecret = process.env.STRIPE_SECRET_KEY || 'sk_test_mock';
    const stripe = require('stripe')(stripeSecret);

    const targetLeadId = lead ? lead.id : null;
    const targetClientId = client ? client.id : null;
    const clientName = lead ? `${lead.firstName} ${lead.lastName}` : (client ? `${client.firstName} ${client.lastName}` : 'Valued Client');

    // Create database payment entry if client exists, or track via metadata if lead
    let paymentId = null;
    if (client) {
      const payment = await prisma.payment.create({
        data: {
          clientId: client.id,
          amount: 250.00,
          status: 'Pending',
          paymentMethod: 'Stripe',
          dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
        }
      });
      paymentId = payment.id;
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: 'Professional Case Assessment & Rescheduling Fee',
            description: `One-to-One Case Review for ${clientName}. €250 credit deductible from Visa Package.`,
          },
          unit_amount: 25000, // Flat €250.00 in cents
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${frontendUrl}/#/public/payment-success?type=no_show&leadId=${targetLeadId || ''}&clientId=${targetClientId || ''}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/#/public/lead-form`,
      metadata: {
        leadId: targetLeadId || '',
        clientId: targetClientId || '',
        paymentId: paymentId || '',
        type: 'no_show_fee',
        amount: '250'
      }
    });

    if (paymentId) {
      await prisma.payment.update({
        where: { id: paymentId },
        data: { gatewayId: session.id }
      });
    }

    return session.url;
  },

  checkAndApplyDeduction: async (clientIdOrLeadId, basePrice) => {
    let creditAmount = 0;

    if (clientIdOrLeadId) {
      // Check client or lead record for paid assessment credit
      const client = await prisma.client.findUnique({
        where: { id: clientIdOrLeadId },
        select: { id: true, dependentsDetails: true, email: true, phone: true }
      }).catch(() => null);

      if (client) {
        // Check if paid 250 payment exists or credit flagged
        const paidPayment = await prisma.payment.findFirst({
          where: {
            clientId: client.id,
            status: 'Paid',
            amount: { gte: 250 }
          }
        });
        if (paidPayment) {
          creditAmount = 250;
        }
      }

      if (!creditAmount) {
        const lead = await prisma.lead.findUnique({
          where: { id: clientIdOrLeadId },
          select: { qualificationData: true, status: true }
        }).catch(() => null);
        if (lead) {
          const qual = typeof lead.qualificationData === 'object' ? lead.qualificationData : {};
          if (qual?.assessmentCredit === 250 || lead.status === 'Partial Paid') {
            creditAmount = 250;
          }
        }
      }
    }

    if (creditAmount > 0) {
      const finalPrice = Math.max(0, basePrice - creditAmount);
      return {
        deducted: true,
        price: finalPrice,
        creditApplied: creditAmount
      };
    }

    return {
      deducted: false,
      price: basePrice,
      creditApplied: 0
    };
  }
};
