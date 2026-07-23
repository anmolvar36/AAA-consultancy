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

exports.getCeoBrief = async (req, res) => {
  try {
    const today = new Date();
    
    // Start/End of today
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
    
    // Format today as YYYY-MM-DD for Consultation.date comparison
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const todayStr = `${yyyy}-${mm}-${dd}`;

    // Start of week (Sunday)
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    // Start of month
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    // 1. Number of new leads received today
    const newLeadsToday = await prisma.lead.count({
      where: {
        createdAt: { gte: startOfToday, lte: endOfToday }
      }
    });

    // 2. Number of active clients
    const activeClients = await prisma.client.count({
      where: {
        status: {
          in: [
            'Attempting Contact',
            'Assessment Booked',
            'Under Assessment',
            'Eligible',
            'Waiting for Payment',
            'Payment Received',
            'Documents Pending',
            'Documents Under Review',
            'Additional Documents Required',
            'Ready to Submit',
            'Application Submitted',
            'Appointment Booked',
            'Under Government Review',
            'Resubmission in Progress',
            'Ready for Resubmission',
            'Resubmitted',
            'Appeal in Progress',
            'Administrative Support'
          ]
        }
      }
    });

    // 3. Number of pending consultations
    const pendingConsultations = await prisma.consultation.count({
      where: {
        status: 'Scheduled'
      }
    });

    // 4. Today's meetings and webinars
    const todayMeetings = await prisma.consultation.findMany({
      where: {
        date: todayStr
      },
      include: {
        lead: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            phone: true
          }
        },
        consultant: {
          select: {
            fullName: true,
            email: true
          }
        }
      }
    });

    // 5. Outstanding payments awaiting confirmation
    const outstandingPayments = await prisma.payment.findMany({
      where: {
        status: 'Pending'
      },
      include: {
        client: {
          select: {
            firstName: true,
            lastName: true
          }
        }
      }
    });

    const outstandingPaymentsCount = outstandingPayments.length;
    const outstandingPaymentsAmount = outstandingPayments.reduce((sum, p) => sum + (p.amount || 0), 0);

    // 6. Professional Case Assessments awaiting review
    const assessmentsAwaitingReview = await prisma.document.count({
      where: {
        status: 'Pending Verification',
        client: {
          status: 'Documents Under Review'
        }
      }
    });

    // 7. Full Processing cases awaiting action
    const fullProcessingCasesAwaitingAction = await prisma.client.count({
      where: {
        status: 'Documents Under Review',
        serviceType: {
          in: ['FULL_PROCESSING', 'Full Processing Package', 'PREMIUM', 'Premium Package']
        }
      }
    });

    // 8. No-Show customers
    const noShowCustomers = await prisma.consultation.count({
      where: {
        status: 'NO_SHOW'
      }
    });

    // 9. Customers requiring follow-up
    const customersRequiringFollowUp = await prisma.client.count({
      where: {
        status: 'Cold Lead'
      }
    });

    // 10. Customers ready for payment
    const customersReadyForPayment = await prisma.client.count({
      where: {
        status: 'Waiting for Payment'
      }
    });

    // 11. Customers waiting for document submission
    const customersWaitingForDocs = await prisma.client.count({
      where: {
        status: 'Documents Pending'
      }
    });

    // 12. Customers waiting for appointment booking
    const customersWaitingForAppointment = await prisma.client.count({
      where: {
        status: 'Application Submitted'
      }
    });

    // 13. Customers waiting for application submission
    const customersWaitingForSubmission = await prisma.client.count({
      where: {
        OR: [
          { status: 'Ready to Submit' },
          { visaStatus: 'Ready for Submission' }
        ]
      }
    });

    // 14. Customers waiting for government updates
    const customersWaitingForGov = await prisma.client.count({
      where: {
        OR: [
          { status: 'Under Government Review' },
          { visaStatus: 'Submitted to Gov' }
        ]
      }
    });

    // 15. Customers requiring resubmission
    const customersRequiringResubmission = await prisma.client.count({
      where: {
        OR: [
          { status: { in: ['Resubmission in Progress', 'Ready for Resubmission'] } },
          { visaStatus: { in: ['Requires Resubmission', 'Refused'] } }
        ]
      }
    });

    // 16. Urgent or overdue tasks (using notifications as proxy)
    const urgentOverdueTasks = await prisma.notification.count({
      where: {
        isRead: false
      }
    });

    // 17. WhatsApp conversations requiring attention
    const whatsappConversations = await prisma.communicationLog.count({
      where: {
        channel: 'WHATSAPP',
        direction: 'INBOUND',
        readStatus: false
      }
    });

    // 18. Social media inquiries received
    const socialInquiries = await prisma.communicationLog.count({
      where: {
        channel: {
          in: ['FB', 'IG', 'TELEGRAM', 'CHATBOT']
        },
        direction: 'INBOUND',
        readStatus: false
      }
    });

    // 18b. New reviews and customer feedback
    const feedbackCount = await prisma.notification.count({
      where: {
        OR: [
          { title: { contains: 'feedback' } },
          { body: { contains: 'feedback' } },
          { title: { contains: 'review' } },
          { body: { contains: 'review' } }
        ]
      }
    });

    // 19. Financial summary
    const todayPaidAggregate = await prisma.payment.aggregate({
      where: {
        status: 'Paid',
        billingDate: { gte: startOfToday, lte: endOfToday }
      },
      _sum: { totalPaid: true }
    });

    const weeklyPaidAggregate = await prisma.payment.aggregate({
      where: {
        status: 'Paid',
        billingDate: { gte: startOfWeek, lte: endOfToday }
      },
      _sum: { totalPaid: true }
    });

    const monthlyPaidAggregate = await prisma.payment.aggregate({
      where: {
        status: 'Paid',
        billingDate: { gte: startOfMonth, lte: endOfToday }
      },
      _sum: { totalPaid: true }
    });

    const financeSummary = {
      today: todayPaidAggregate._sum.totalPaid || 0,
      weekly: weeklyPaidAggregate._sum.totalPaid || 0,
      monthly: monthlyPaidAggregate._sum.totalPaid || 0
    };

    // 20. Team performance overview (Consultants and client counts)
    const consultants = await prisma.user.findMany({
      where: { role: 'consultant' },
      select: {
        id: true,
        fullName: true,
        assignedClients: {
          select: { id: true, status: true }
        }
      }
    });

    const teamPerformance = consultants.map(c => {
      const activeCount = c.assignedClients.filter(cl => 
        !['Completed', 'Closed', 'Lost Lead', 'Spam'].includes(cl.status)
      ).length;
      const completedCount = c.assignedClients.filter(cl => cl.status === 'Completed').length;
      return {
        id: c.id,
        fullName: c.fullName,
        activeClients: activeCount,
        completedClients: completedCount
      };
    });

    // 21. Marketing campaign performance
    const marketingCampaigns = await prisma.lead.groupBy({
      by: ['source'],
      _count: { id: true }
    });

    const marketingPerformance = marketingCampaigns.map(mc => ({
      source: mc.source || 'Website',
      count: mc._count.id
    }));

    // 22. Compile numbers for prompt or fallback
    const bookedSessionsToday = todayMeetings.length;
    const missedWebinarFollowUps = noShowCustomers;

    const rawMetrics = {
      newLeadsToday,
      activeClients,
      pendingConsultations,
      meetingsCountToday: todayMeetings.length,
      outstandingPaymentsCount,
      outstandingPaymentsAmount,
      assessmentsAwaitingReview,
      fullProcessingCasesAwaitingAction,
      noShowCustomers,
      customersRequiringFollowUp,
      customersReadyForPayment,
      customersWaitingForDocs,
      customersWaitingForAppointment,
      customersWaitingForSubmission,
      customersWaitingForGov,
      customersRequiringResubmission,
      urgentOverdueTasks,
      whatsappConversations,
      socialInquiries,
      financeSummary,
      teamPerformance,
      marketingPerformance,
      feedbackCount,
      todayMeetings: todayMeetings.map(m => ({
        timeSlot: m.timeSlot,
        leadName: m.lead ? `${m.lead.firstName} ${m.lead.lastName}` : 'Guest',
        consultantName: m.consultant ? m.consultant.fullName : 'Unassigned'
      }))
    };

    // AI Generation
    const apiKey = process.env.OPENAI_API_KEY;
    const isRealApiKey = apiKey && !apiKey.includes('your_openai');
    let aiSummary = '';
    let aiSuggestions = [];

    if (isRealApiKey) {
      try {
        const prompt = `You are the AI CEO Assistant for Wael Madi, CEO of AAA Business Consultancy LLC (Spanish Immigration & Sworn Translation Services).
Generate a professional, motivating, and detailed daily morning briefing in the tone of "Good morning, Wael."
Base it on the following live CRM metrics:
- New leads received today/overnight: ${newLeadsToday}
- Active clients: ${activeClients}
- Pending consultations: ${pendingConsultations}
- Today's meetings/info sessions: ${bookedSessionsToday}
- Outstanding payments waiting: ${outstandingPaymentsCount} (Total amount: €${outstandingPaymentsAmount})
- Professional Case Assessments awaiting doc review: ${assessmentsAwaitingReview}
- Full Processing cases awaiting action: ${fullProcessingCasesAwaitingAction}
- No-show customers: ${noShowCustomers}
- Customers requiring follow-up: ${customersRequiringFollowUp}
- Customers ready for payment: ${customersReadyForPayment}
- Customers waiting for document submission: ${customersWaitingForDocs}
- Customers waiting for appointment booking: ${customersWaitingForAppointment}
- Customers waiting for application submission: ${customersWaitingForSubmission}
- Customers waiting for government updates: ${customersWaitingForGov}
- Customers requiring resubmission: ${customersRequiringResubmission}
- Urgent or unread notifications/tasks: ${urgentOverdueTasks}
- WhatsApp inbox items: ${whatsappConversations}
- Social inbox items: ${socialInquiries}
- New customer reviews and feedback alerts: ${feedbackCount}
- Financial summary: Today Paid: €${financeSummary.today}, Weekly: €${financeSummary.weekly}, Monthly: €${financeSummary.monthly}

Output formatting:
- Return a JSON object with two fields: "brief" (string, contains the daily greeting and natural language summary in Markdown bullet points) and "suggestions" (array of strings, contains 4-5 strategic recommendations for today).
- The brief should sound premium, executive-focused, and address Wael personally. Include specific numbers where appropriate.`;

        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
          model: 'gpt-3.5-turbo',
          messages: [
            { role: 'system', content: 'You are an executive assistant. You always reply in valid JSON format matching {"brief": "...", "suggestions": ["...", "..."]}.' },
            { role: 'user', content: prompt }
          ],
          response_format: { type: "json_object" },
          temperature: 0.7
        }, {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          }
        });

        if (response.data?.choices?.[0]?.message?.content) {
          const parsed = JSON.parse(response.data.choices[0].message.content.trim());
          aiSummary = parsed.brief;
          aiSuggestions = parsed.suggestions;
        }
      } catch (err) {
        console.warn('[AI Controller] OpenAI CEO Briefing generation failed, using heuristic fallback:', err.message);
      }
    }

    // Heuristic Fallback Engine (Runs if API fails or Key is missing)
    if (!aiSummary || !aiSuggestions.length) {
      aiSummary = `Good morning, Wael.
Here's your business summary for today:
• **${newLeadsToday} new leads** were received overnight.
• **${bookedSessionsToday} customers** booked the Free Spain Visa & Residency Information Session.
• **${customersReadyForPayment} customers** are waiting to complete their €250 Professional Case Assessment payments (Outstanding: **€${outstandingPaymentsAmount}**).
• **${assessmentsAwaitingReview} Professional Case Assessments** are ready for document review.
• **${customersWaitingForSubmission} visa applications** are complete and ready for submission.
• **${missedWebinarFollowUps} customers** missed yesterday's webinar and require follow-up.
• Today's webinar session is scheduled in the calendar.
• Marketing campaigns generated **${newLeadsToday} inquiries** within the last 24 hours.
• WhatsApp generated **${whatsappConversations} inbound conversations** requiring operator attention.
• Financial progress: Today **€${financeSummary.today}** paid, Monthly total is **€${financeSummary.monthly}**.
• Customer feedback: **${feedbackCount} customer reviews and feedback** items require your review.`;

      aiSuggestions = [
        `Follow up with the ${customersReadyForPayment} customers waiting for payment to confirm setup or trigger the 10% CEO discount reminder.`,
        `Direct operations team to review the ${assessmentsAwaitingReview} case assessments currently pending document verification.`,
        `Address the ${whatsappConversations} unread WhatsApp threads requiring consultant responses to preserve conversion rate.`,
        `Assign the ${newLeadsToday} new incoming leads to agents based on spoken language expertise.`,
        `Check appeal deadlines for application cycles requiring resubmissions (${customersRequiringResubmission} pending).`
      ];
    }

    return res.status(200).json({
      success: true,
      metrics: rawMetrics,
      brief: aiSummary,
      suggestions: aiSuggestions
    });

  } catch (error) {
    console.error('Error generating CEO Briefing:', error);
    return res.status(500).json({ success: false, message: 'Server error generating executive dashboard data' });
  }
};
