const { run, all, get, transaction } = require('../db');
const { sendWaitlistOfferEmail } = require('./emailService');

const OFFER_TTL_MINUTES = parseInt(process.env.OFFER_TTL_MINUTES || '15');

async function checkAndReleaseExpiredHolds() {
  const now = new Date().toISOString();
  
  // 1. Find all expired holds
  const expiredHolds = await all(
    `SELECT h.*, s.show_id, s.category FROM holds h 
     JOIN seats s ON h.seat_id = s.id 
     WHERE h.status = 'active' AND h.expires_at <= ?`,
    [now]
  );

  if (expiredHolds.length === 0) return;

  console.log(`[TTL Scheduler] Found ${expiredHolds.length} expired hold(s) to release.`);

  for (const hold of expiredHolds) {
    try {
      await transaction(async () => {
        // Mark hold released
        await run(`UPDATE holds SET status = 'released' WHERE id = ?`, [hold.id]);
        
        // Revert seat to available
        await run(`UPDATE seats SET status = 'available' WHERE id = ? AND status = 'held'`, [hold.seat_id]);

        console.log(`[TTL Scheduler] Auto-released seat ${hold.seat_id} from hold token ${hold.hold_token}.`);
      });

      // Check if there is someone on the waitlist for this show and category!
      await triggerWaitlistAutoAssign(hold.show_id, hold.seat_id, hold.category);
    } catch (err) {
      console.error(`[TTL Scheduler] Error releasing hold ${hold.id}:`, err.message);
    }
  }
}

async function checkAndExpireWaitlistOffers() {
  const now = new Date().toISOString();
  
  // Find expired pending offers
  const expiredOffers = await all(
    `SELECT o.*, w.category FROM offers o
     JOIN waitlists w ON o.waitlist_id = w.id
     WHERE o.status = 'pending' AND o.expires_at <= ?`,
    [now]
  );

  if (expiredOffers.length === 0) return;

  console.log(`[TTL Scheduler] Found ${expiredOffers.length} expired waitlist offer(s).`);

  for (const offer of expiredOffers) {
    try {
      await transaction(async () => {
        // Mark offer expired
        await run(`UPDATE offers SET status = 'expired' WHERE id = ?`, [offer.id]);
        
        // Mark waitlist entry expired
        await run(`UPDATE waitlists SET status = 'expired' WHERE id = ?`, [offer.waitlist_id]);

        // Release seat back to available if not booked
        await run(`UPDATE seats SET status = 'available' WHERE id = ? AND status = 'held'`, [offer.seat_id]);

        console.log(`[TTL Scheduler] Expired offer ${offer.offer_token} for user ${offer.user_id}.`);
      });

      // Pass offer to NEXT person in line on waitlist
      await triggerWaitlistAutoAssign(offer.show_id, offer.seat_id, offer.category);
    } catch (err) {
      console.error(`[TTL Scheduler] Error processing expired offer ${offer.id}:`, err.message);
    }
  }
}

// Auto-assign available seat to next waitlisted customer
async function triggerWaitlistAutoAssign(showId, seatId, category) {
  try {
    // Check if seat is currently available
    const seat = await get(`SELECT * FROM seats WHERE id = ? AND status = 'available'`, [seatId]);
    if (!seat) return;

    // Get next person in waitlist queue for this show & category
    const nextWaitlistEntry = await get(
      `SELECT w.*, u.email, u.name, e.title as event_title, sh.show_time
       FROM waitlists w
       JOIN users u ON w.user_id = u.id
       JOIN shows sh ON w.show_id = sh.id
       JOIN events e ON sh.event_id = e.id
       WHERE w.show_id = ? AND w.category = ? AND w.status = 'waiting'
       ORDER BY w.joined_at ASC LIMIT 1`,
      [showId, category]
    );

    if (!nextWaitlistEntry) return;

    // We have a match! Hold seat for waitlisted user and create offer
    const offerToken = 'OFFER-' + Math.random().toString(36).substring(2, 10).toUpperCase();
    const expiresAt = new Date(Date.now() + OFFER_TTL_MINUTES * 60 * 1000).toISOString();

    await transaction(async () => {
      // Hold seat
      await run(`UPDATE seats SET status = 'held' WHERE id = ? AND status = 'available'`, [seatId]);

      // Update waitlist entry status
      await run(`UPDATE waitlists SET status = 'offered' WHERE id = ?`, [nextWaitlistEntry.id]);

      // Create offer
      await run(
        `INSERT INTO offers (waitlist_id, show_id, seat_id, user_id, offer_token, expires_at, status) 
         VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
        [nextWaitlistEntry.id, showId, seatId, nextWaitlistEntry.user_id, offerToken, expiresAt]
      );
    });

    console.log(`[Waitlist Engine] Auto-offered seat ${seat.seat_label} to waitlisted user ${nextWaitlistEntry.name} (${nextWaitlistEntry.email}). Token: ${offerToken}`);

    // Send offer email
    await sendWaitlistOfferEmail(
      nextWaitlistEntry.email,
      offerToken,
      nextWaitlistEntry.event_title,
      nextWaitlistEntry.show_time,
      seat.seat_label,
      category,
      seat.price,
      expiresAt
    );
  } catch (err) {
    console.error(`[Waitlist Engine] Auto-assign error:`, err.message);
  }
}

function startTTLScheduler(intervalMs = 10000) {
  console.log(`[TTL Scheduler] Service started (Polling every ${intervalMs / 1000}s)...`);
  setInterval(async () => {
    try {
      await checkAndReleaseExpiredHolds();
      await checkAndExpireWaitlistOffers();
    } catch (err) {
      console.error('[TTL Scheduler Loop Error]:', err.message);
    }
  }, intervalMs);
}

module.exports = {
  startTTLScheduler,
  triggerWaitlistAutoAssign,
  checkAndReleaseExpiredHolds,
  checkAndExpireWaitlistOffers,
};
