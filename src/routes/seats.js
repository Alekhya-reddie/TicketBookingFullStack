const express = require('express');
const router = express.Router();
const { run, get, all, transaction } = require('../db');
const { verifyToken } = require('./auth');
const { sendTicketEmail } = require('../services/emailService');
const { triggerWaitlistAutoAssign } = require('../services/ttlScheduler');

const HOLD_TTL_MINUTES = parseInt(process.env.HOLD_TTL_MINUTES || '10');

// Get Visual Seat Grid for a Show
router.get('/show/:showId', async (req, res) => {
  try {
    const showId = req.params.showId;
    const show = await get(
      `SELECT sh.*, e.title as event_title, e.type as event_type, v.name as venue_name, v.rows_count, v.cols_count
       FROM shows sh
       JOIN events e ON sh.event_id = e.id
       JOIN venues v ON e.venue_id = v.id
       WHERE sh.id = ?`,
      [showId]
    );

    if (!show) return res.status(404).json({ error: 'Show not found' });

    const seats = await all(
      `SELECT s.*,
              h.user_id as held_by_user_id,
              h.expires_at as hold_expires_at,
              h.hold_token
       FROM seats s
       LEFT JOIN holds h ON s.id = h.seat_id AND h.status = 'active'
       WHERE s.show_id = ?
       ORDER BY s.row_num ASC, s.col_num ASC`,
      [showId]
    );

    // Calculate per-category summary for waitlist checking
    const categorySummary = await all(
      `SELECT category,
              COUNT(*) as total_seats,
              SUM(CASE WHEN status = 'booked' THEN 1 ELSE 0 END) as booked_seats,
              SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) as available_seats
       FROM seats
       WHERE show_id = ?
       GROUP BY category`,
      [showId]
    );

    res.json({ show, seats, categorySummary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Hold Seats (With Concurrency Lock & TTL)
router.post('/hold', verifyToken, async (req, res) => {
  try {
    const { show_id, seat_ids } = req.body; // array of seat IDs
    if (!show_id || !Array.isArray(seat_ids) || seat_ids.length === 0) {
      return res.status(400).json({ error: 'show_id and seat_ids array are required' });
    }

    const userId = req.user.id;
    const holdToken = 'HOLD-' + Math.random().toString(36).substring(2, 10).toUpperCase();
    const expiresAt = new Date(Date.now() + HOLD_TTL_MINUTES * 60 * 1000).toISOString();

    const heldSeats = [];

    // Atomic Transaction to prevent race conditions / simultaneous double-holds
    await transaction(async () => {
      for (const seatId of seat_ids) {
        // Check current seat status with atomic lock
        const seat = await get(`SELECT * FROM seats WHERE id = ? AND show_id = ?`, [seatId, show_id]);

        if (!seat) {
          throw new Error(`Seat ID ${seatId} does not exist for this show.`);
        }

        if (seat.status !== 'available') {
          throw new Error(`Seat ${seat.seat_label} is no longer available (Current Status: ${seat.status}).`);
        }

        // 1. Update seat status to held
        const updateRes = await run(
          `UPDATE seats SET status = 'held', version = version + 1 WHERE id = ? AND status = 'available'`,
          [seatId]
        );

        if (updateRes.changes === 0) {
          throw new Error(`Concurrency Conflict: Seat ${seat.seat_label} was claimed by another customer simultaneously.`);
        }

        // 2. Create hold record
        await run(
          `INSERT INTO holds (show_id, seat_id, user_id, hold_token, expires_at, status) VALUES (?, ?, ?, ?, ?, 'active')`,
          [show_id, seatId, userId, holdToken, expiresAt]
        );

        heldSeats.push(seat);
      }
    });

    res.status(200).json({
      message: `${heldSeats.length} seat(s) successfully held for ${HOLD_TTL_MINUTES} minutes.`,
      hold_token: holdToken,
      expires_at: expiresAt,
      seats: heldSeats,
    });
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

// Release Hold Manually (Checkout Cancellation)
router.post('/hold/release', verifyToken, async (req, res) => {
  try {
    const { hold_token } = req.body;
    if (!hold_token) return res.status(400).json({ error: 'hold_token is required' });

    const holds = await all(`SELECT * FROM holds WHERE hold_token = ? AND user_id = ? AND status = 'active'`, [hold_token, req.user.id]);
    if (holds.length === 0) return res.status(404).json({ error: 'Active hold token not found' });

    await transaction(async () => {
      for (const hold of holds) {
        await run(`UPDATE holds SET status = 'released' WHERE id = ?`, [hold.id]);
        await run(`UPDATE seats SET status = 'available' WHERE id = ? AND status = 'held'`, [hold.seat_id]);

        // Trigger waitlist auto-assignment check
        const seat = await get('SELECT category, show_id FROM seats WHERE id = ?', [hold.seat_id]);
        if (seat) {
          await triggerWaitlistAutoAssign(seat.show_id, hold.seat_id, seat.category);
        }
      }
    });

    res.json({ message: 'Seat hold released successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Checkout & Confirm Booking
router.post('/checkout', verifyToken, async (req, res) => {
  try {
    const { hold_token } = req.body;
    if (!hold_token) return res.status(400).json({ error: 'hold_token is required' });

    const holds = await all(
      `SELECT h.*, s.seat_label, s.category, s.price, s.show_id, sh.show_time, e.title as event_title
       FROM holds h
       JOIN seats s ON h.seat_id = s.id
       JOIN shows sh ON s.show_id = sh.id
       JOIN events e ON sh.event_id = e.id
       WHERE h.hold_token = ? AND h.user_id = ? AND h.status = 'active'`,
      [hold_token, req.user.id]
    );

    if (holds.length === 0) {
      return res.status(400).json({ error: 'Hold expired or invalid. Please re-select your seats.' });
    }

    const now = new Date().toISOString();
    if (holds[0].expires_at <= now) {
      return res.status(400).json({ error: 'Seat hold has expired. Please re-select your seats.' });
    }

    const confirmedBookings = [];

    await transaction(async () => {
      for (const hold of holds) {
        const bookingRef = 'TICKET-' + Math.random().toString(36).substring(2, 8).toUpperCase();

        // 1. Mark seat booked
        const updateRes = await run(
          `UPDATE seats SET status = 'booked', version = version + 1 WHERE id = ? AND status = 'held'`,
          [hold.seat_id]
        );

        if (updateRes.changes === 0) {
          throw new Error(`Failed to confirm booking for seat ${hold.seat_label}. State invalid.`);
        }

        // 2. Mark hold converted
        await run(`UPDATE holds SET status = 'converted' WHERE id = ?`, [hold.id]);

        // 3. Create booking record
        const bookingRes = await run(
          `INSERT INTO bookings (booking_reference, user_id, show_id, seat_id, total_price, qr_code_data, status)
           VALUES (?, ?, ?, ?, ?, ?, 'confirmed')`,
          [bookingRef, req.user.id, hold.show_id, hold.seat_id, hold.price, bookingRef]
        );

        // 4. Send email notification with QR code
        const qrCodeDataUrl = await sendTicketEmail(
          req.user.email,
          bookingRef,
          hold.event_title,
          hold.show_time,
          hold.seat_label,
          hold.category,
          hold.price
        );

        confirmedBookings.push({
          booking_id: bookingRes.lastID,
          booking_reference: bookingRef,
          seat_label: hold.seat_label,
          category: hold.category,
          price: hold.price,
          event_title: hold.event_title,
          show_time: hold.show_time,
          qr_code_url: qrCodeDataUrl,
        });
      }
    });

    res.status(201).json({
      message: 'Booking confirmed successfully! QR code ticket emailed.',
      bookings: confirmedBookings,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get User's Booking History
router.get('/bookings/my', verifyToken, async (req, res) => {
  try {
    const bookings = await all(
      `SELECT b.*, s.seat_label, s.category, sh.show_time, e.title as event_title, e.type as event_type, v.name as venue_name
       FROM bookings b
       JOIN seats s ON b.seat_id = s.id
       JOIN shows sh ON b.show_id = sh.id
       JOIN events e ON sh.event_id = e.id
       JOIN venues v ON e.venue_id = v.id
       WHERE b.user_id = ?
       ORDER BY b.id DESC`,
      [req.user.id]
    );

    res.json({ bookings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Customer: Cancel Booking (Triggers Waitlist Auto-reallocation!)
router.post('/bookings/cancel', verifyToken, async (req, res) => {
  try {
    const { booking_id } = req.body;
    if (!booking_id) return res.status(400).json({ error: 'booking_id is required' });

    const booking = await get(
      `SELECT b.*, s.category, s.show_id, s.seat_label FROM bookings b JOIN seats s ON b.seat_id = s.id WHERE b.id = ? AND b.user_id = ? AND b.status = 'confirmed'`,
      [booking_id, req.user.id]
    );

    if (!booking) return res.status(404).json({ error: 'Confirmed booking not found' });

    await transaction(async () => {
      // 1. Mark booking cancelled
      await run(`UPDATE bookings SET status = 'cancelled' WHERE id = ?`, [booking_id]);

      // 2. Mark seat available
      await run(`UPDATE seats SET status = 'available' WHERE id = ?`, [booking.seat_id]);
    });

    console.log(`Booking ${booking.booking_reference} cancelled for seat ${booking.seat_label}. Triggering waitlist re-allocation...`);

    // 3. Trigger automatic waitlist assignment for next in line!
    await triggerWaitlistAutoAssign(booking.show_id, booking.seat_id, booking.category);

    res.json({ message: 'Booking cancelled successfully. Seat re-allocated to waitlist if queue exists.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
