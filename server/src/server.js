const express = require('express');
const session = require('express-session');
const cors = require('cors');
require('dotenv').config();

const authRoutes = require('./routes/authRoutes');
const catalogRoutes = require('./routes/catalogRoutes');
const memberRoutes = require('./routes/memberRoutes');
const circulationRoutes = require('./routes/circulationRoutes');
const reportRoutes = require('./routes/reportRoutes');
const bookRequestRoutes = require('./routes/bookRequestRoutes');
const ledgerRoutes = require('./routes/ledgerRoutes');
const { sweepExpiredReservationHolds } = require('./services/reservationExpiry');

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS with credentials for React SPA frontend
app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Express session with secure HTTP-only cookies
app.use(session({
  name: 'olms_sid',
  secret: process.env.SESSION_SECRET || 'academic_olms_session_key_2026_super_secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false, // In development HTTP, set to true on HTTPS (CI-3)
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 // 24 hours
  }
}));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/catalog', catalogRoutes);
app.use('/api/members', memberRoutes);
app.use('/api/circulation', circulationRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/requests', bookRequestRoutes);
app.use('/api/ledger', ledgerRoutes);

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    system: 'Online Library Management System',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error occurred'
  });
});

if (require.main === module) {
  app.listen(PORT, async () => {
    console.log(`OLMS Backend Server running on port ${PORT}`);
    try { await sweepExpiredReservationHolds(); } catch (error) { console.error('Initial reservation-hold sweep failed:', error.message); }
    const holdSweep = setInterval(async () => {
      try { await sweepExpiredReservationHolds(); } catch (error) { console.error('Reservation-hold sweep failed:', error.message); }
    }, 60 * 1000);
    if (typeof holdSweep.unref === 'function') holdSweep.unref();
  });
}

module.exports = app;
