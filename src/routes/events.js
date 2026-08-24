const express = require('express');
const router = express.Router();
const { run, get, all, transaction } = require('../db');
const { verifyToken, requireRole } = require('./auth');

// Get all events with venue info and active shows
router.get('/', async (req, res) => {
  try {
    const { type, search } = req.query;
    let query = `
      SELECT e.*, v.name as venue_name, v.location as venue_location,
             u.name as organiser_name,
             (SELECT MIN(show_time) FROM shows WHERE event_id = e.id) as next_show_time,
             (SELECT COUNT(*) FROM shows WHERE event_id = e.id) as total_shows
      FROM events e
      JOIN venues v ON e.venue_id = v.id
      JOIN users u ON e.organiser_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (type) {
      query += ` AND e.type = ?`;
      params.push(type);
    }
    if (search) {
      query += ` AND (e.title LIKE ? OR e.description LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }

    query += ` ORDER BY e.id DESC`;

    const events = await all(query, params);
    res.json({ events });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Event Details with Shows
router.get('/:id', async (req, res) => {
  try {
    const event = await get(
      `SELECT e.*, v.name as venue_name, v.location as venue_location, v.rows_count, v.cols_count
       FROM events e
       JOIN venues v ON e.venue_id = v.id
       WHERE e.id = ?`,
      [req.params.id]
    );

    if (!event) return res.status(404).json({ error: 'Event not found' });

    const shows = await all(
      `SELECT s.*,
              (SELECT COUNT(*) FROM seats WHERE show_id = s.id AND status = 'available') as available_seats,
              (SELECT COUNT(*) FROM seats WHERE show_id = s.id AND status = 'held') as held_seats,
              (SELECT COUNT(*) FROM seats WHERE show_id = s.id AND status = 'booked') as booked_seats,
              (SELECT COUNT(*) FROM seats WHERE show_id = s.id) as total_seats
       FROM shows s
       WHERE s.event_id = ?
       ORDER BY s.show_time ASC`,
      [req.params.id]
    );

    res.json({ event, shows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Organiser: Create Event & Schedule Show with Auto Seat Generation
router.post('/', verifyToken, requireRole(['organiser', 'admin']), async (req, res) => {
  try {
    const { title, type, description, poster_url, venue_id, show_time, premium_price, standard_price } = req.body;

    if (!title || !type || !venue_id || !show_time || !premium_price || !standard_price) {
      return res.status(400).json({ error: 'Title, type, venue_id, show_time, premium_price, and standard_price are required' });
    }

    const venue = await get('SELECT * FROM venues WHERE id = ?', [venue_id]);
    if (!venue) return res.status(400).json({ error: 'Invalid venue ID' });

    let eventId;
    let showId;

    await transaction(async () => {
      // 1. Create Event
      const eventRes = await run(
        `INSERT INTO events (title, type, description, poster_url, venue_id, organiser_id) VALUES (?, ?, ?, ?, ?, ?)`,
        [title, type, description || '', poster_url || '', venue_id, req.user.id]
      );
      eventId = eventRes.lastID;

      // 2. Create Show
      const showRes = await run(
        `INSERT INTO shows (event_id, show_time, premium_price, standard_price) VALUES (?, ?, ?, ?)`,
        [eventId, show_time, parseFloat(premium_price), parseFloat(standard_price)]
      );
      showId = showRes.lastID;

      // 3. Auto-generate visual seat grid (Rows 1-2 = Premium, remaining = Standard)
      const rowLabels = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
      for (let r = 1; r <= venue.rows_count; r++) {
        const isPremium = r <= 2;
        const category = isPremium ? 'Premium' : 'Standard';
        const price = isPremium ? parseFloat(premium_price) : parseFloat(standard_price);

        for (let c = 1; c <= venue.cols_count; c++) {
          const seatLabel = `${rowLabels[r - 1] || r}${c}`;
          await run(
            `INSERT INTO seats (show_id, seat_label, row_num, col_num, category, price, status) VALUES (?, ?, ?, ?, ?, ?, 'available')`,
            [showId, seatLabel, r, c, category, price]
          );
        }
      }
    });

    res.status(201).json({
      message: 'Event and Show created successfully with visual seat map generated',
      eventId,
      showId,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Organiser Dashboard: Analytics & Revenue Per Event
router.get('/analytics/revenue', verifyToken, requireRole(['organiser', 'admin']), async (req, res) => {
  try {
    const isOrganiser = req.user.role === 'organiser';
    let query = `
      SELECT e.id as event_id, e.title as event_title, e.type as event_type, v.name as venue_name,
             COUNT(DISTINCT b.id) as total_bookings,
             COALESCE(SUM(b.total_price), 0) as total_revenue,
             (SELECT COUNT(*) FROM seats s JOIN shows sh ON s.show_id = sh.id WHERE sh.event_id = e.id AND s.status = 'booked') as booked_seats_count,
             (SELECT COUNT(*) FROM seats s JOIN shows sh ON s.show_id = sh.id WHERE sh.event_id = e.id) as total_seats_count
      FROM events e
      JOIN venues v ON e.venue_id = v.id
      LEFT JOIN shows sh ON sh.event_id = e.id
      LEFT JOIN bookings b ON b.show_id = sh.id AND b.status = 'confirmed'
    `;

    const params = [];
    if (isOrganiser) {
      query += ` WHERE e.organiser_id = ?`;
      params.push(req.user.id);
    }

    query += ` GROUP BY e.id ORDER BY total_revenue DESC`;

    const analytics = await all(query, params);
    res.json({ analytics });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
