require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDB } = require('./db');
const { router: authRouter } = require('./routes/auth');
const venuesRouter = require('./routes/venues');
const eventsRouter = require('./routes/events');
const seatsRouter = require('./routes/seats');
const waitlistRouter = require('./routes/waitlist');
const { getOutboxEmails } = require('./services/emailService');
const { startTTLScheduler } = require('./services/ttlScheduler');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// API Routes
app.use('/api/auth', authRouter);
app.use('/api/venues', venuesRouter);
app.use('/api/events', eventsRouter);
app.use('/api/seats', seatsRouter);
app.use('/api/waitlist', waitlistRouter);

// Outbox API for live email previewing in UI
app.get('/api/outbox', async (req, res) => {
  try {
    const emails = await getOutboxEmails();
    res.json({ emails });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fallback to index.html for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Start Server & Initialize Services
async function bootstrap() {
  try {
    await initDB();
    startTTLScheduler(5000); // Check TTLs every 5s

    app.listen(PORT, () => {
      console.log(`=======================================================`);
      console.log(`🚀 Ticket Booking Platform Server running on port ${PORT}`);
      console.log(`🔗 Local URL: http://localhost:${PORT}`);
      console.log(`=======================================================`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

bootstrap();
