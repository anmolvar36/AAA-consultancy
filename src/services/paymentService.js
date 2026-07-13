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

        await tx.payment.update({
          where: { id: paymentId },
          data: {
            status: 'Paid',
            transactionId: transactionId,
            paymentMethod: 'Stripe',
            totalPaid: totalPaid
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
  processPaymentEvent
};
