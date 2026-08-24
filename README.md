# TicketBox - High-Demand Ticket Booking Platform

A full-stack ticket booking platform for movies and concerts featuring real-time visual seat selection, TTL seat hold auto-release, concurrency locks against double-booking, automated waitlist reallocation, and QR-coded ticket email delivery.

---

## 🚀 Quick Start Guide

### Prerequisites
- Node.js (v16+ recommended)
- npm

### 1. Installation
Clone or navigate to the project directory:
```bash
cd ticket-booking-system
npm install
```

### 2. Configure Environment
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Default `.env` configuration:
```env
PORT=3000
JWT_SECRET=super_secret_ticket_system_key_2026
HOLD_TTL_MINUTES=10
OFFER_TTL_MINUTES=15
NODE_ENV=development
```

### 3. Start the Application
Run the server (automatically initializes & seeds database):
```bash
npm start
```
Open your browser and navigate to:
👉 **`http://localhost:3000`**

---

## 🧪 Automated Testing

### 1. Concurrency Protection Test (Simultaneous Double-Booking Lock)
Simulates 10 concurrent HTTP requests simultaneously attempting to hold the exact same seat:
```bash
npm run test:concurrency
```
*Expected Output*: 1 Request Succeeded (200 OK), 9 Requests Rejected (409 Concurrency Conflict).

### 2. TTL Auto-Release Test
Creates an expired seat hold and verifies automatic status rollback to available:
```bash
npm run test:ttl
```
*Expected Output*: Verified seat status reverted from `held` to `available`.

---

## 🔑 Demo Pre-Seeded Accounts

Use the **Role Switcher** in the top-right header of the web interface to instantly test all user personas without typing passwords:

| Role | Name | Email | Password |
|---|---|---|---|
| **Customer 1** | John Customer | `john@example.com` | `password123` |
| **Customer 2 (Waitlist)** | Sarah Waitlist | `sarah@example.com` | `password123` |
| **Organiser** | Event Organiser | `organiser@ticketbox.com` | `password123` |
| **Admin** | System Admin | `admin@ticketbox.com` | `password123` |

---

## 🗄️ Database Schema & Data Model

The application uses SQLite (`data.db`) with 10 core tables:

1. **`users`**: User accounts with roles (`admin`, `organiser`, `customer`).
2. **`venues`**: Physical locations with seating dimensions (`rows_count`, `cols_count`).
3. **`events`**: Movies or concerts linked to venues and organisers.
4. **`shows`**: Scheduled event times with category pricing (`premium_price`, `standard_price`).
5. **`seats`**: Per-show visual grid seats with status (`available`, `held`, `booked`) and versioning.
6. **`holds`**: Active TTL holds linked to unique tokens and expiration timestamps.
7. **`bookings`**: Confirmed purchases with reference codes and QR code data.
8. **`waitlists`**: Queued customers per show and seat category (`waiting`, `offered`, `fulfilled`, `expired`).
9. **`offers`**: Time-limited seat offer tokens sent to waitlisted users.
10. **`outbox_emails`**: System email outbox storing dispatched QR tickets and waitlist offers for live UI inspection.

---

## 📡 API Documentation

### Authentication Routes (`/api/auth`)
- `POST /api/auth/register`: Create new user account.
- `POST /api/auth/login`: Authenticate and receive JWT token.
- `GET /api/auth/me`: Get profile of authenticated user.
- `GET /api/auth/users`: List demo users for quick role switching.

### Venue Routes (`/api/venues`)
- `GET /api/venues`: List all venues.
- `POST /api/venues` *(Admin only)*: Create a new venue with grid dimensions.

### Event & Revenue Routes (`/api/events`)
- `GET /api/events`: Search and filter events.
- `GET /api/events/:id`: Get event details and scheduled shows.
- `POST /api/events` *(Organiser/Admin)*: Publish event, schedule show, and auto-generate seat map.
- `GET /api/events/analytics/revenue` *(Organiser/Admin)*: Revenue and seat occupancy metrics.

### Seat & Booking Routes (`/api/seats`)
- `GET /api/seats/show/:showId`: Get visual seat map with real-time seat status.
- `POST /api/seats/hold`: Place 10-minute hold on selected seats (atomic transaction).
- `POST /api/seats/hold/release`: Manually release seat hold.
- `POST /api/seats/checkout`: Confirm payment, generate QR ticket, and dispatch email.
- `GET /api/seats/bookings/my`: View user's confirmed booking history.
- `POST /api/seats/bookings/cancel`: Cancel booking and trigger waitlist auto-reallocation.

### Waitlist Routes (`/api/waitlist`)
- `POST /api/waitlist/join`: Join waitlist queue for a sold-out seat category.
- `GET /api/waitlist/my`: View user's active waitlists and offers.
- `POST /api/waitlist/offer/claim`: Redeem time-limited seat offer.

---

## 📜 System Design Document
For a detailed 800-word architectural write-up covering TTL mechanics, concurrency locks, and waitlist offer flows, refer to [`SYSTEM_DESIGN.md`](file:///C:/Users/alekh/.gemini/antigravity/scratch/ticket-booking-system/SYSTEM_DESIGN.md).
