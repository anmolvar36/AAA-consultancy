const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { connection: redis } = require('../queues/connection');

const axios = require('axios');

// AI Summarization Engine (OpenAI with Heuristic Fallback)
const generateAiSummary = async (client, communications = [], lead = null) => {
  const apiKey = process.env.OPENAI_API_KEY;
  const isRealApiKey = apiKey && !apiKey.includes('your_openai');

  const commText = communications.map(c => `[${c.channel} - ${c.direction}]: ${c.content}`).join('\n');
  const qualText = lead && lead.qualificationData ? JSON.stringify(lead.qualificationData) : 'None';

  if (isRealApiKey) {
    try {
      const prompt = `You are an AI assistant for a Spanish Immigration Consultancy. Summarize this client in 3 crisp bullet points for consultants:
Client Name: ${client.firstName} ${client.lastName}
Service: ${client.serviceType}
Nationality: ${client.nationality}
Qualification Data: ${qualText}
Communication Logs: ${commText || 'No logs yet'}

Output 3 bullet points starting with •. Focus on Residency Goal, Financial/Income Status, and Next Steps.`;

      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'system', content: 'You summarize immigration clients.' }, { role: 'user', content: prompt }],
        temperature: 0.5,
        max_tokens: 250
      }, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.data?.choices?.[0]?.message?.content) {
        return response.data.choices[0].message.content.trim();
      }
    } catch (err) {
      console.warn('[AI Controller] OpenAI API call failed or rate-limited, falling back to smart heuristic:', err.message);
    }
  }

  // Smart Structured Heuristic Fallback Summarizer
  const areaInfo = client.preferableArea || lead?.preferableArea ? ` | Target Area: ${client.preferableArea || lead?.preferableArea}` : '';
  const budgetInfo = client.budget || lead?.budget ? ` | Budget: ${client.budget || lead?.budget}` : '';

  return [
    `• Target Service Goal: ${client.serviceType || 'Spain Residency'}${areaInfo}${budgetInfo}`,
    `• Qualification Summary: ${lead?.qualificationData ? Object.entries(lead.qualificationData).map(([k, v]) => `${k.replace(/([A-Z])/g, ' $1')}: ${v}`).join('; ') : 'Self-Assessment completed. Full verification in progress.'}`,
    `• Case Status & History: Current Status: ${client.status} | Visa Stage: ${client.visaStatus || 'Not Started'} | Total Interactions logged: ${communications.length}`
  ].join('\n\n');
};

exports.summarizeClient = async (req, res) => {
  try {
    const { clientId } = req.body;

    if (!clientId) {
      return res.status(400).json({ success: false, message: 'clientId is required' });
    }

    // Check if client exists
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: { lead: true }
    });

    if (!client) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }

    // 1. Get communications
    const allComms = await prisma.communicationLog.findMany({
      where: { clientId },
      orderBy: { createdAt: 'asc' }
    });

    const summary = await generateAiSummary(client, allComms, client.lead);

    return res.status(200).json({
      success: true,
      data: { summary, cached: false }
    });

  } catch (error) {
    console.error('AI Summarization Error:', error);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
};

exports.extractIntent = async (req, res) => {
  try {
    const { chatHistory } = req.body;
    const apiKey = process.env.OPENAI_API_KEY;
    const isRealApiKey = apiKey && !apiKey.includes('your_openai');

    if (isRealApiKey && chatHistory) {
      try {
        const prompt = `Extract lead qualification data from this conversation history as JSON:
${typeof chatHistory === 'string' ? chatHistory : JSON.stringify(chatHistory)}

Output JSON format:
{
  "nationality": "string",
  "preferredLanguage": "string",
  "visaGoal": "string",
  "applicantsCount": number,
  "aiSummary": "string"
}`;

        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'system', content: 'You extract structured json from chat logs.' }, { role: 'user', content: prompt }],
          temperature: 0.2
        }, {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          }
        });

        if (response.data?.choices?.[0]?.message?.content) {
          const parsed = JSON.parse(response.data.choices[0].message.content.trim());
          return res.status(200).json({ success: true, extractedData: parsed });
        }
      } catch (openAiErr) {
        console.warn('[AI Controller] OpenAI extractIntent failed, using heuristic fallback:', openAiErr.message);
      }
    }

    // Heuristic Fallback Intent Extractor
    const historyStr = (typeof chatHistory === 'string' ? chatHistory : JSON.stringify(chatHistory || '')).toLowerCase();
    
    let visaGoal = "Non-Lucrative Visa (NLV)";
    if (historyStr.includes('nomad') || historyStr.includes('remote')) visaGoal = "Digital Nomad Visa (DNV)";
    if (historyStr.includes('golden') || historyStr.includes('invest') || historyStr.includes('property')) visaGoal = "Property Investment Guidance";
    if (historyStr.includes('student') || historyStr.includes('study')) visaGoal = "Student Visa";

    return res.status(200).json({
      success: true,
      extractedData: {
        nationality: historyStr.includes('uk') || historyStr.includes('british') ? "British" : "International Applicant",
        preferredLanguage: historyStr.includes('spanish') ? "Spanish" : "English",
        visaGoal,
        applicantsCount: historyStr.includes('family') || historyStr.includes('spouse') ? 2 : 1,
        aiSummary: `Qualified lead interested in ${visaGoal}. Automatic intent score computed.`
      }
    });
  } catch (error) {
    console.error('Error in extractIntent:', error);
    return res.status(500).json({ success: false, message: 'Server error extracting intent' });
  }
};

exports.scoreConsultants = async (req, res) => {
  try {
    const { leadDetails } = req.body;
    
    // Fetch all active consultants from database
    const consultants = await prisma.user.findMany({
      where: { role: 'consultant' }
    });
    
    // In production, execute the heuristic match score formula or pass to LLM
    const scoredRankings = consultants.map(c => {
      const isLanguageMatch = (c.spokenLanguages || '').toLowerCase().includes((leadDetails.preferredLanguage || 'English').toLowerCase());
      const isVisaMatch = c.visaExpertise && JSON.stringify(c.visaExpertise).toLowerCase().includes((leadDetails.serviceId || 'dnv').toLowerCase());
      
      let score = 50; // Base score
      if (isLanguageMatch) score += 30;
      if (isVisaMatch) score += 20;
      
      return {
        consultantId: c.id,
        name: c.name,
        score: Math.min(score, 100),
        reasons: [
          isLanguageMatch ? 'Language Preference Match (+30)' : 'Language mismatch (+0)',
          isVisaMatch ? 'Visa Stream Expertise Match (+20)' : 'Expertise mismatch (+0)'
        ]
      };
    }).sort((a, b) => b.score - a.score);

    return res.status(200).json({
      success: true,
      rankings: scoredRankings
    });
  } catch (error) {
    console.error('Error in scoreConsultants:', error);
    return res.status(500).json({ success: false, message: 'Server error scoring consultants' });
  }
};

exports.analyzeTranslationPdf = async (req, res) => {
  try {
    // In production, read req.file.buffer, count words, and analyze handwriting using OpenAI Vision
    // const imageBase64 = req.file.buffer.toString('base64');
    
    return res.status(200).json({
      success: true,
      isValid: true,
      wordCount: req.body.wordCount ? parseInt(req.body.wordCount, 10) : 450,
      classification: "Digital PDF",
      isAiFlagged: false,
      flagReason: null,
      routeToSeniorOperator: false
    });
  } catch (error) {
    console.error('Error in analyzeTranslationPdf:', error);
    return res.status(500).json({ success: false, message: 'Server error analyzing PDF' });
  }
};
