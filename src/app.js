require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// CORS Configuration
const corsOptions = {
  origin: [process.env.CLIENT_URL, "https://visaconsultancy41.netlify.app", "http://localhost:5173", "http://localhost:3000"],
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  credentials: true
};

// Express CORS
app.use(cors(corsOptions));

// Setup Socket.io
const io = new Server(server, {
  cors: corsOptions
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

// Middleware

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

// Initialize BullMQ Workers
const { setupWorkers } = require('./queues/workers');
setupWorkers();

// Start Server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
