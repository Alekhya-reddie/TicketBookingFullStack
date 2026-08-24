const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.resolve(__dirname, '../data.db');
const db = new sqlite3.Database(dbPath);

// Helper to wrap db queries in Promises
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// Transaction wrapper for atomic execution & concurrency control
async function transaction(workFn) {
  await run('BEGIN IMMEDIATE');
  try {
    const result = await workFn();
    await run('COMMIT');
    return result;
  } catch (err) {
    await run('ROLLBACK');
    throw err;
  }
}

async function initDB() {
  await run('PRAGMA foreign_keys = ON');

  // 1. Users
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'organiser', 'customer')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 2. Venues
  await run(`
    CREATE TABLE IF NOT EXISTS venues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      location TEXT NOT NULL,
      rows_count INTEGER NOT NULL,
      cols_count INTEGER NOT NULL,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 3. Events
  await run(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT,
      poster_url TEXT,
      venue_id INTEGER NOT NULL,
      organiser_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(venue_id) REFERENCES venues(id)
    )
  `);

  // 4. Shows
  await run(`
    CREATE TABLE IF NOT EXISTS shows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      show_time DATETIME NOT NULL,
      premium_price REAL NOT NULL,
      standard_price REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE
    )
  `);

  // 5. Seats
  await run(`
    CREATE TABLE IF NOT EXISTS seats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      show_id INTEGER NOT NULL,
      seat_label TEXT NOT NULL,
      row_num INTEGER NOT NULL,
      col_num INTEGER NOT NULL,
      category TEXT NOT NULL,
      price REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available', 'held', 'booked')),
      version INTEGER DEFAULT 1,
      FOREIGN KEY(show_id) REFERENCES shows(id) ON DELETE CASCADE,
      UNIQUE(show_id, seat_label)
    )
  `);

  // 6. Holds
  await run(`
    CREATE TABLE IF NOT EXISTS holds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      show_id INTEGER NOT NULL,
      seat_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      hold_token TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'released', 'converted')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(seat_id) REFERENCES seats(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  // 7. Bookings
  await run(`
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_reference TEXT UNIQUE NOT NULL,
      user_id INTEGER NOT NULL,
      show_id INTEGER NOT NULL,
      seat_id INTEGER NOT NULL,
      total_price REAL NOT NULL,
      qr_code_data TEXT NOT NULL,
      status TEXT DEFAULT 'confirmed' CHECK(status IN ('confirmed', 'cancelled')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(seat_id) REFERENCES seats(id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  // 8. Waitlist
  await run(`
    CREATE TABLE IF NOT EXISTS waitlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      show_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT DEFAULT 'waiting' CHECK(status IN ('waiting', 'offered', 'fulfilled', 'expired', 'cancelled')),
      FOREIGN KEY(show_id) REFERENCES shows(id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  // 9. Offers
  await run(`
    CREATE TABLE IF NOT EXISTS offers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      waitlist_id INTEGER NOT NULL,
      show_id INTEGER NOT NULL,
      seat_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      offer_token TEXT UNIQUE NOT NULL,
      expires_at DATETIME NOT NULL,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'expired')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(waitlist_id) REFERENCES waitlists(id),
      FOREIGN KEY(seat_id) REFERENCES seats(id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  // 10. Outbox Emails (For live UI previewing & debugging)
  await run(`
    CREATE TABLE IF NOT EXISTS outbox_emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipient TEXT NOT NULL,
      subject TEXT NOT NULL,
      body_html TEXT NOT NULL,
      qr_code TEXT,
      sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Seed default data if users table is empty
  const userCount = await get('SELECT COUNT(*) as count FROM users');
  if (userCount.count === 0) {
    await seedDefaultData();
  }
}

async function seedDefaultData() {
  console.log('Seeding initial data...');
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash('password123', salt);

  // Users
  await run(`INSERT INTO users (name, email, password, role) VALUES ('System Admin', 'admin@ticketbox.com', ?, 'admin')`, [passwordHash]);
  await run(`INSERT INTO users (name, email, password, role) VALUES ('Event Organiser', 'organiser@ticketbox.com', ?, 'organiser')`, [passwordHash]);
  await run(`INSERT INTO users (name, email, password, role) VALUES ('John Customer', 'john@example.com', ?, 'customer')`, [passwordHash]);
  await run(`INSERT INTO users (name, email, password, role) VALUES ('Sarah Waitlist', 'sarah@example.com', ?, 'customer')`, [passwordHash]);

  // Venue 1: Grand Cineplex (5 rows x 8 cols = 40 seats)
  const venue1 = await run(`INSERT INTO venues (name, location, rows_count, cols_count, created_by) VALUES ('Grand Cineplex', 'Downtown Hall A', 5, 8, 1)`);
  const venueId1 = venue1.lastID;

  // Venue 2: Arena Amphitheatre (6 rows x 10 cols = 60 seats)
  const venue2 = await run(`INSERT INTO venues (name, location, rows_count, cols_count, created_by) VALUES ('Arena Amphitheatre', 'City Center Stadium', 6, 10, 1)`);
  const venueId2 = venue2.lastID;

  // Event 1: Cyberpunk 2099 Movie Premiere
  const event1 = await run(`INSERT INTO events (title, type, description, poster_url, venue_id, organiser_id) VALUES 
    ('Cyberpunk 2099: Neon Horizon', 'Movie', 'Experience the futuristic cinematic masterpiece on IMAX 3D.', 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=800&auto=format&fit=crop&q=80', ?, 2)`, [venueId1]);
  const eventId1 = event1.lastID;

  // Event 2: ColdPlay Lights Concert
  const event2 = await run(`INSERT INTO events (title, type, description, poster_url, venue_id, organiser_id) VALUES 
    ('Celestial Lights World Tour', 'Concert', 'Live electrifying stadium performance with laser lights.', 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=800&auto=format&fit=crop&q=80', ?, 2)`, [venueId2]);
  const eventId2 = event2.lastID;

  // Shows
  const showTime1 = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const show1 = await run(`INSERT INTO shows (event_id, show_time, premium_price, standard_price) VALUES (?, ?, 25.00, 15.00)`, [eventId1, showTime1]);
  const showId1 = show1.lastID;

  const showTime2 = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
  const show2 = await run(`INSERT INTO shows (event_id, show_time, premium_price, standard_price) VALUES (?, ?, 120.00, 75.00)`, [eventId2, showTime2]);
  const showId2 = show2.lastID;

  // Generate Seats for Show 1 (5 rows x 8 cols)
  // Rows 1-2 = Premium, Rows 3-5 = Standard
  const rowLabels = ['A', 'B', 'C', 'D', 'E', 'F'];
  for (let r = 1; r <= 5; r++) {
    const isPremium = r <= 2;
    const category = isPremium ? 'Premium' : 'Standard';
    const price = isPremium ? 25.00 : 15.00;
    for (let c = 1; c <= 8; c++) {
      const seatLabel = `${rowLabels[r - 1]}${c}`;
      await run(`INSERT INTO seats (show_id, seat_label, row_num, col_num, category, price, status) VALUES (?, ?, ?, ?, ?, ?, 'available')`,
        [showId1, seatLabel, r, c, category, price]);
    }
  }

  // Generate Seats for Show 2 (6 rows x 10 cols)
  for (let r = 1; r <= 6; r++) {
    const isPremium = r <= 2;
    const category = isPremium ? 'Premium' : 'Standard';
    const price = isPremium ? 120.00 : 75.00;
    for (let c = 1; c <= 10; c++) {
      const seatLabel = `${rowLabels[r - 1]}${c}`;
      await run(`INSERT INTO seats (show_id, seat_label, row_num, col_num, category, price, status) VALUES (?, ?, ?, ?, ?, ?, 'available')`,
        [showId2, seatLabel, r, c, category, price]);
    }
  }

  console.log('Database initialized and seeded successfully.');
}

module.exports = {
  db,
  run,
  get,
  all,
  transaction,
  initDB
};
