# System Design Document: High-Demand Ticket Booking Platform

## 1. Overview & Core Architecture
High-demand event ticketing systems must solve three critical engineering challenges:
1. **Preventing Double-Bookings (Concurrency Control)** during flash sales.
2. **Auto-Releasing Abandoned Seat Holds (TTL Management)** without leaking seats.
3. **Automated Priority Seat Reallocation (Waitlist Engine)** when bookings are cancelled.

The system uses a Node.js + Express backend paired with a transactional SQLite database engine to ensure ACID compliance, zero race conditions, and real-time state updates.

---

## 2. Concurrency Protection & Double-Booking Prevention
Simultaneous checkout attempts for high-demand seats are handled using **Optimistic Locking combined with Database-Level Immediate Transactions**.

```
[Customer A] --\  (Simultaneous Seat Hold Request: Seat A1)
                ===> [BEGIN IMMEDIATE Transaction] ---> [Check Seat Status = 'available']
[Customer B] --/                   |
                                   v
             [Customer A Granted Hold (Version 1 -> 2)]
             [Customer B Transaction Rejected: Concurrency Conflict]
```

### Protocol:
1. **Transaction Isolation**: Every hold request initiates an atomic `BEGIN IMMEDIATE` transaction, acquiring a write lock on the database before reading seat status.
2. **Optimistic Version Check**: Seats feature a integer `version` field. When updating a seat from `available` to `held`:
   ```sql
   UPDATE seats 
   SET status = 'held', version = version + 1 
   WHERE id = ? AND status = 'available';
   ```
3. **Result**: If two customers select the exact same seat simultaneously, only one transaction modifies the row (`changes === 1`). The second customer receives an explicit `409 Concurrency Conflict` error response.

---

## 3. Seat Hold & TTL Auto-Release Mechanism
To prevent customers from locking up seats indefinitely during checkout, seats are placed on a **Time-To-Live (TTL) Hold** (default: 10 minutes).

### Hold Workflow:
1. **Token Generation**: Upon requesting a seat hold, a unique token (`HOLD-XXXXXX`) and an exact UTC timestamp (`expires_at = NOW() + 10 MINS`) are generated.
2. **Client Countdown**: The frontend initiates a live JavaScript countdown timer.
3. **Backend Background Poller (TTL Worker)**:
   - A background process runs periodically (every 5 seconds) executing:
     ```sql
     SELECT h.*, s.show_id, s.category 
     FROM holds h JOIN seats s ON h.seat_id = s.id 
     WHERE h.status = 'active' AND h.expires_at <= DATETIME('now');
     ```
   - For every expired hold, an atomic transaction marks the hold as `released` and sets the seat status back to `available`.
   - The poller immediately notifies the waitlist engine to check if a queued customer can be offered the newly freed seat.

---

## 4. Waitlist Auto-Assignment & Time-Limited Offer Flow
When an event or specific seat category (e.g., *Premium*) is sold out, customers can join a category-specific waitlist queue.

```
                        [Booking Cancelled / Seat Freed]
                                       |
                                       v
                   [Query Oldest 'waiting' Entry in Queue]
                                       |
                                       v
                  [Hold Seat for Waitlisted Customer (TTL: 15m)]
                                       |
                                       v
                     [Dispatch Time-Limited Offer Email]
                                  /         \
                       (Accepted) /           \ (Expired)
                                 v             v
                    [Booking Confirmed]    [Pass Offer to Next Customer]
```

### Offer Engine Workflow:
1. **Queue Rank**: Waitlist entries are ordered by `joined_at ASC` (First-In, First-Out queue).
2. **Cancellation Event**: When a customer cancels a booking or a held seat expires, the system queries for the next waiting customer:
   ```sql
   SELECT * FROM waitlists 
   WHERE show_id = ? AND category = ? AND status = 'waiting' 
   ORDER BY joined_at ASC LIMIT 1;
   ```
3. **Time-Limited Offer Dispatch**:
   - The seat is placed in a `held` state.
   - An `offers` record is created with an `OFFER-XXXXXX` token and a 15-minute expiration time.
   - An email notification containing a magic redemption button is dispatched.
4. **Offer Expiration**: If the waitlisted customer does not claim the offer within 15 minutes, the TTL background poller marks the offer as `expired` and automatically triggers the assignment pipeline for the *next* customer in line.

---

## 5. QR Ticket & Email Delivery Architecture
Upon successful checkout:
1. A unique `booking_reference` (e.g. `TICKET-8X9Y2Z`) is generated.
2. The `qrcode` generator builds a high-density QR code Data URL encoding the reference.
3. Nodemailer constructs an HTML email containing event details, seat assignment, and embedded QR image.
4. An outbox record is simultaneously stored in the database to enable real-time in-app email previewing for demonstration and audit purposes.
