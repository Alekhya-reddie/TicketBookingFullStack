const express = require('express');
const router = express.Router();
const { run, get, all, transaction } = require('../db');
const { verifyToken } = require('./auth');
const { sendTicketEmail } = require('../services/emailService');

// Join Waitlist
router.post('/join', verifyToken, async (req, res) => {
  try {
    const { show_id, category } = req.body;
    if (!show_id || !category) {
      return res.status(400).json({ error: 'show_id and category are required' });
    }

    // Check existing waiting position
    const existing = await get(
      `SELECT * FROM waitlists WHERE show_id = ? AND category = ? AND user_id = ? AND status IN ('waiting', 'offered')`,
      [show_id, category, req.user.id]
    );

    if (existing) {
      return res.status(400).json({ error: 'You are already on the waitlist for this seat category.' });
    }

    const result = await run(
      `INSERT INTO waitlists (show_id, category, user_id, status) VALUES (?, ?, ?, 'waiting')`,
      [show_id, category, req.user.id]
    );

    // Calculate queue position
    const queuePos = await get(
      `SELECT COUNT(*) as pos FROM waitlists WHERE show_id = ? AND category = ? AND status = 'waiting' AND id <= ?`,
      [show_id, category, result.lastID]
    );

    res.status(201).json({
      message: 'Successfully joined waitlist!',
      waitlist_id: result.lastID,
      queue_position: queuePos.pos,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// View My Waitlist Status
router.get('/my', verifyToken, async (req, res) => {
  try {
    const waitlists = await all(
      `SELECT w.*, e.title as event_title, sh.show_time,
              o.offer_token, o.expires_at as offer_expires_at, o.seat_id, s.seat_label
       FROM waitlists w
       JOIN shows sh ON w.show_id = sh.id
       JOIN events e ON sh.event_id = e.id
       LEFT JOIN offers o ON o.waitlist_id = w.id AND o.status = 'pending'
       LEFT JOIN seats s ON o.seat_id = s.id
       WHERE w.user_id = ?
       ORDER BY w.id DESC`,
      [req.user.id]
    );

    res.json({ waitlists });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Redeem Waitlist Offer
router.post('/offer/claim', verifyToken, async (req, res) => {
  try {
    const { offer_token } = req.body;
    if (!offer_token) return res.status(400).json({ error: 'offer_token is required' });

    const offer = await get(
      `SELECT o.*, s.seat_label, s.category, s.price, sh.show_time, e.title as event_title
       FROM offers o
       JOIN seats s ON o.seat_id = s.id
       JOIN shows sh ON o.show_id = sh.id
       JOIN events e ON sh.event_id = e.id
       WHERE o.offer_token = ? AND o.user_id = ? AND o.status = 'pending'`,
      [offer_token, req.user.id]
    );

    if (!offer) {
      return res.status(400).json({ error: 'Offer invalid, expired, or already claimed.' });
    }

    const now = new Date().toISOString();
    if (offer.expires_at <= now) {
      return res.status(400).json({ error: 'Offer time limit has expired.' });
    }

    const bookingRef = 'TICKET-' + Math.random().toString(36).substring(2, 8).toUpperCase();
    let qrCodeDataUrl;

    await transaction(async () => {
      // 1. Mark offer accepted
      await run(`UPDATE offers SET status = 'accepted' WHERE id = ?`, [offer.id]);

      // 2. Mark waitlist fulfilled
      await run(`UPDATE waitlists SET status = 'fulfilled' WHERE id = ?`, [offer.waitlist_id]);

      // 3. Mark seat booked
      await run(`UPDATE seats SET status = 'booked', version = version + 1 WHERE id = ?`, [offer.seat_id]);

      // 4. Create booking
      await run(
        `INSERT INTO bookings (booking_reference, user_id, show_id, seat_id, total_price, qr_code_data, status)
         VALUES (?, ?, ?, ?, ?, ?, 'confirmed')`,
        [bookingRef, req.user.id, offer.show_id, offer.seat_id, offer.price, bookingRef]
      );

      // 5. Send confirmation email
      qrCodeDataUrl = await sendTicketEmail(
        req.user.email,
        bookingRef,
        offer.event_title,
        offer.show_time,
        offer.seat_label,
        offer.category,
        offer.price
      );
    });

    res.status(200).json({
      message: 'Waitlist offer successfully claimed and booked! Ticket emailed.',
      booking_reference: bookingRef,
      seat_label: offer.seat_label,
      qr_code_url: qrCodeDataUrl,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
