require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Setup Socket.io
const io = new Server(server, {
  cors: {
    origin: "*", // Or specify frontend URL
    methods: ["GET", "POST", "PUT", "DELETE"]
  }
});

// Expose io to routes if needed
app.set('io', io);

io.on('connection', (socket) => {
  console.log(`User connected to socket: ${socket.id}`);

  // When a user logs in, they send their role to join a specific room
  socket.on('join-role', (role) => {
    const roomName = `role:${role}`;
    socket.join(roomName);
    console.log(`Socket ${socket.id} joined room ${roomName}`);
  });

  // When a user logs in, they also join their individual user room
  socket.on('join-user', (userId) => {
    const roomName = `user:${userId}`;
    socket.join(roomName);
    console.log(`Socket ${socket.id} joined room ${roomName}`);
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected from socket: ${socket.id}`);
  });
});

app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'Access-Control-Allow-Origin', 'X-com-zoho-invoice-organizationid']
}));

app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Setup Basic Route
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'AAA Consultancy Backend is running.' });
});

// Mount Routes
app.use('/api/v1/auth', require('./routes/authRoutes'));
app.use('/api/v1/users', require('./routes/userRoutes'));
app.use('/api/v1/settings', require('./routes/settingsRoutes'));
app.use('/api/v1/leads', require('./routes/leadRoutes'));
app.use('/api/v1/clients', require('./routes/clientRoutes'));
app.use('/api/v1/cases', require('./routes/caseRoutes'));
app.use('/api/v1/consultations', require('./routes/consultationRoutes'));
app.use('/api/v1/payments', require('./routes/paymentRoutes'));
app.use('/api/v1/documents', require('./routes/documentRoutes'));
app.use('/api/v1/marketing', require('./routes/marketingRoutes'));
app.use('/api/v1/webhooks', require('./routes/webhookRoutes'));
app.use('/api/v1/booking', require('./routes/bookingRoutes'));
app.use('/api/v1/ai', require('./routes/aiRoutes'));
app.use('/api/v1/notifications', require('./routes/notificationRoutes'));
app.use('/api/v1/audit-logs', require('./routes/auditLogRoutes'));
app.use('/api/v1/social', require('./routes/socialRoutes'));
app.use('/api/v1/communications', require('./routes/communicationRoutes'));

// Initialize BullMQ Workers
const { setupWorkers } = require('./queues/workers');
setupWorkers();

// Schedule Daily Missing Documents Checker (runs every day at 10:00 AM)
const { remindersQueue } = require('./queues/queueSetup');
if (remindersQueue && remindersQueue.add) {
  remindersQueue.add('daily-missing-documents-check', {}, {
    repeat: {
      pattern: '0 10 * * *' // CRON pattern: 10:00 AM daily
    },
    jobId: 'daily-missing-documents-check-cron' // Deduplication ID
  }).then(() => {
    console.log('[Scheduler] Scheduled daily missing documents cron job.');
  }).catch(err => {
    console.error('[Scheduler] Failed to schedule daily missing documents cron job:', err.message);
  });
}

// Initialize CEO Discount Automation scheduler
const { startDiscountScheduler } = require('./services/discountAutomationService');
startDiscountScheduler();

// Initialize Payment Drip Reminders scheduler
const { startReminderScheduler } = require('./services/reminderScheduler');
startReminderScheduler();

// Self-Healing Database Column Auto-Migration on Startup
const prisma = require('./config/db');
(async () => {
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE payments ADD COLUMN packageType VARCHAR(191) NULL;`);
    console.log('[DB Auto-Migration] Added missing packageType column to payments table.');
  } catch (e) {}

  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE payments ADD COLUMN discount DOUBLE NULL DEFAULT 0;`);
  } catch (e) {}

  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE relocation_packages ADD COLUMN isRefundable TINYINT(1) NOT NULL DEFAULT 0;`);
    console.log('[DB Auto-Migration] Added missing isRefundable column to relocation_packages table.');
  } catch (e) {}

  const companySettingCols = [
    `refundGuaranteePercentage DOUBLE NOT NULL DEFAULT 50`,
    `enableStripeRefunds TINYINT(1) NOT NULL DEFAULT 1`,
    `enableManualBankPayouts TINYINT(1) NOT NULL DEFAULT 1`,
    `lockClientRefundTab TINYINT(1) NOT NULL DEFAULT 1`,
    `requireMeetingAcceptance TINYINT(1) NOT NULL DEFAULT 1`,
    `customRefundTerms TEXT NULL`,
    `customizationSettings JSON NULL`,
    `swornTranslationRates JSON NULL`,
    `leadStages JSON NULL`,
    `recordingStorage VARCHAR(191) NOT NULL DEFAULT 'cloud'`,
    `autoAssignConsultant TINYINT(1) NOT NULL DEFAULT 1`
  ];

  for (const colDef of companySettingCols) {
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE company_settings ADD COLUMN ${colDef};`);
      console.log(`[DB Auto-Migration] Added missing column to company_settings table: ${colDef.split(' ')[0]}`);
    } catch (e) {}
  }

  try {
    const res = await prisma.template.deleteMany({
      where: { OR: [{ id: 'consultation_no_show_cancelled' }, { id: { contains: 'no_show', mode: 'insensitive' } }] }
    });
    if (res.count > 0) console.log(`[DB Cleanup] Removed ${res.count} No-Show template records from Database.`);
  } catch (err) {
    console.warn('[DB Cleanup Warning]:', err.message);
  }
})();

// Start Server
const PORT = process.env.PORT || 5000;

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[Server Error] Port ${PORT} is already in use. Please kill existing process or wait...`);
    process.exit(1);
  } else {
    console.error('[Server Error]', err);
  }
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
