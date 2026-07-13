const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { connection: redis } = require('../queues/connection');

// Simulated AI integration (e.g. OpenAI or Gemini)
const generateAiSummary = async (communications) => {
  // Mock AI summary logic for this implementation
  return `Client has had ${communications.length} interactions. Main topic seems to be visa eligibility and document submission requirements.`;
};

exports.summarizeClient = async (req, res) => {
  try {
    const { clientId } = req.body;

    if (!clientId) {
      return res.status(400).json({ success: false, message: 'clientId is required' });
    }

    // Check if client exists
    const client = await prisma.client.findUnique({
      where: { id: clientId }
    });

    if (!client) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }

    // 1. Get the latest communication log to check cache validity
    const latestComm = await prisma.communicationLog.findFirst({
      where: { clientId },
      orderBy: { createdAt: 'desc' }
    });

    const cacheKey = `ai-summary:client:${clientId}`;
    const cacheHash = latestComm ? latestComm.id : 'no-comms';

    // 2. Check Redis Cache
    const cachedData = await redis.get(cacheKey);
    if (cachedData) {
      const parsed = JSON.parse(cachedData);
      // Cache is valid if the latest communication log ID matches our cached hash
      if (parsed.hash === cacheHash) {
        console.log(`Returning cached AI summary for client ${clientId}`);
        return res.status(200).json({
          success: true,
          data: { summary: parsed.summary, cached: true }
        });
      }
    }

    // 3. Cache Miss or Invalidated Cache: Fetch all communications and generate new summary
    const allComms = await prisma.communicationLog.findMany({
      where: { clientId },
      orderBy: { createdAt: 'asc' }
    });

    const summary = await generateAiSummary(allComms);

    // 4. Update Cache (Store for 24 hours)
    await redis.set(cacheKey, JSON.stringify({
      hash: cacheHash,
      summary
    }), 'EX', 86400);

    return res.status(200).json({
      success: true,
      data: { summary, cached: false }
    });

  } catch (error) {
    console.error('AI Summarization Error:', error);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
};
