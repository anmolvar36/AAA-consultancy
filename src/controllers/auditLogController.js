const prisma = require('../config/db');

/**
 * Get unified case activity timeline logs for a lead or client.
 */
const getCaseTimeline = async (req, res) => {
  try {
    const { clientId, leadId, applicationId } = req.query;

    if (!clientId && !leadId && !applicationId) {
      return res.status(400).json({ success: false, message: 'Must provide clientId, leadId, or applicationId' });
    }

    const whereConditions = [];
    if (clientId) whereConditions.push({ clientId });
    if (leadId) whereConditions.push({ leadId });
    if (applicationId) whereConditions.push({ applicationId });

    // 1. Fetch Audit Logs
    const auditLogs = await prisma.auditLog.findMany({
      where: {
        OR: whereConditions
      },
      orderBy: { createdAt: 'desc' },
      take: 100
    });

    // 2. Fetch Communication Logs if clientId provided
    let commLogs = [];
    if (clientId) {
      commLogs = await prisma.communicationLog.findMany({
        where: { clientId },
        include: { respondedByUser: { select: { fullName: true, role: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50
      });
    }

    // 3. Map & Combine into unified timeline entries
    const mappedAudit = auditLogs.map(log => ({
      id: log.id,
      timestamp: log.createdAt,
      type: log.action,
      actorName: log.actorName || 'System',
      actorRole: log.actorRole || 'system',
      description: log.description || '',
      category: 'AUDIT',
      previousState: log.previousState,
      newState: log.newState
    }));

    const mappedComm = commLogs.map(comm => ({
      id: comm.id,
      timestamp: comm.createdAt,
      type: `COMM_${comm.channel}_${comm.direction}`,
      actorName: comm.direction === 'INBOUND' ? (comm.name || 'Client') : (comm.respondedByUser?.fullName || 'System Automated'),
      actorRole: comm.direction === 'INBOUND' ? 'client' : (comm.respondedByUser?.role || 'system'),
      description: `[${comm.channel}] ${comm.direction === 'INBOUND' ? 'Received message' : 'Sent message'}: "${comm.content.substring(0, 120)}${comm.content.length > 120 ? '...' : ''}"`,
      category: 'COMMUNICATION'
    }));

    const combinedTimeline = [...mappedAudit, ...mappedComm].sort(
      (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
    );

    res.json({
      success: true,
      timeline: combinedTimeline
    });
  } catch (error) {
    console.error('[getCaseTimeline Error]:', error);
    res.status(500).json({ success: false, message: 'Server error fetching case timeline', error: error.message });
  }
};

module.exports = {
  getCaseTimeline
};
