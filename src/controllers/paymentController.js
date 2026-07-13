const prisma = require('../config/db');

const getPayments = async (req, res) => {
  try {
    const payments = await prisma.payment.findMany({
      include: {
        client: { select: { firstName: true, lastName: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    
    const mapped = payments.map(p => ({
      ...p,
      clientName: p.client ? `${p.client.firstName} ${p.client.lastName}` : 'Unknown'
    }));
    
    res.json(mapped);
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching payments' });
  }
};

const generatePaymentLink = async (req, res) => {
  try {
    const { clientId, packageId, amount, discount } = req.body;
    
    const payment = await prisma.payment.create({
      data: {
        clientId,
        amount: Number(amount) || 0,
        discount: Number(discount) || 0,
        status: 'Pending',
        dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
      }
    });

    // Mock link generation
    res.status(201).json({
      ...payment,
      paymentUrl: `https://checkout.stripe.mock/pay/${payment.id}`
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error generating payment link' });
  }
};

const updatePaymentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, paymentMethod, transactionId } = req.body;
    
    const payment = await prisma.payment.findUnique({ where: { id } });
    
    const updatedPayment = await prisma.payment.update({
      where: { id },
      data: { 
        status, 
        paymentMethod, 
        transactionId,
        totalPaid: status === 'Paid' ? payment.amount : payment.totalPaid
      }
    });
    
    res.json(updatedPayment);
  } catch (error) {
    res.status(500).json({ message: 'Server error updating payment' });
  }
};
const getRefundRequests = async (req, res) => {
  try {
    const refunds = await prisma.refundRequest.findMany({
      include: { client: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' }
    });
    
    const mapped = refunds.map(r => ({
      id: r.id,
      clientId: r.clientId,
      clientName: r.client ? `${r.client.firstName} ${r.client.lastName}` : 'Unknown',
      category: r.category,
      amount: r.amount,
      date: r.createdAt.toISOString().split('T')[0],
      status: r.status,
      reason: r.reason
    }));
    
    res.json(mapped);
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching refunds' });
  }
};

const createRefundRequest = async (req, res) => {
  try {
    const { clientId, category, reason, amount } = req.body;
    let refundAmount = Number(amount) || 0;
    
    if (category === 'Visa Rejection') {
      const payments = await prisma.payment.findMany({
        where: { clientId, status: 'Paid' }
      });
      const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
      refundAmount = totalPaid * 0.5; // Auto 50% refund
    }
    
    const refund = await prisma.refundRequest.create({
      data: {
        clientId,
        category,
        reason,
        amount: refundAmount,
        status: 'Pending Review'
      }
    });
    
    res.status(201).json(refund);
  } catch (error) {
    res.status(500).json({ message: 'Server error creating refund request' });
  }
};

const updateRefundStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    const refund = await prisma.refundRequest.update({
      where: { id },
      data: { status }
    });
    
    res.json(refund);
  } catch (error) {
    res.status(500).json({ message: 'Server error updating refund status' });
  }
};

const getCommissionRates = async (req, res) => {
  try {
    const agents = await prisma.user.findMany({
      where: { role: { in: ['admin', 'consultant', 'super_admin'] } },
      select: { id: true, commissionType: true, commissionRate: true }
    });
    
    const rates = agents.map(a => ({
      agentId: a.id,
      type: a.commissionType || '10%',
      value: a.commissionRate || 10
    }));
    
    res.json(rates);
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching commission rates' });
  }
};

const updateCommissionRate = async (req, res) => {
  try {
    const { agentId, type, value } = req.body;
    
    await prisma.user.update({
      where: { id: agentId },
      data: {
        commissionType: type,
        commissionRate: Number(value)
      }
    });
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: 'Server error updating commission rate' });
  }
};

const getCommissionsReport = async (req, res) => {
  try {
    const payments = await prisma.payment.findMany({
      where: { status: 'Paid' },
      include: {
        client: {
          include: { assignedTo: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    
    const report = payments.map(p => {
      const agent = p.client?.assignedTo;
      const rate = agent?.commissionRate || 0;
      const commissionEarned = p.amount * (rate / 100);
      
      // For now, assume commission is accrued (pending) unless agent has explicitly been paid
      // We are distributing agent.commissionPaid across their payments sequentially if needed, 
      // but a simpler approach is just to flag them all as pending unless we build payout logic.
      // The UI expects commissionEarned, commissionPending, commissionPaid per row.
      const commissionPaid = 0; 
      
      return {
        id: p.id,
        date: p.createdAt.toISOString().split('T')[0],
        paymentId: p.id.substring(0, 8),
        clientName: p.client ? `${p.client.firstName} ${p.client.lastName}` : 'Unknown',
        agentName: agent ? agent.fullName : 'Unassigned',
        agentId: agent?.id,
        amountPaid: p.amount,
        structure: agent?.commissionType || '10%',
        commissionEarned,
        commissionPaid,
        commissionPending: commissionEarned - commissionPaid
      };
    });
    
    res.json(report);
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching commissions report' });
  }
};
module.exports = { 
  getPayments, 
  generatePaymentLink, 
  updatePaymentStatus,
  getRefundRequests,
  createRefundRequest,
  updateRefundStatus,
  getCommissionRates,
  updateCommissionRate,
  getCommissionsReport
};
