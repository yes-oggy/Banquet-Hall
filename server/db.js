const Database = require("better-sqlite3");
const path = require("path");
const bcrypt = require("bcryptjs");

const DB_PATH =
  process.env.BANQUET_DB_PATH ||
  path.join(__dirname, "..", "data", "banquet.db");

function openDb() {
  const fs = require("fs");
  const dir = path.dirname(DB_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      phone TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin','coadmin')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT,
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS halls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      base_price_per_day INTEGER NOT NULL DEFAULT 50000,
      image_url TEXT NOT NULL,
      capacity INTEGER NOT NULL DEFAULT 200,
      featured INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      hall_id INTEGER NOT NULL REFERENCES halls(id) ON DELETE RESTRICT,
      event_date TEXT NOT NULL,
      guest_count INTEGER NOT NULL DEFAULT 100,
      status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending','confirmed','cancelled')),
      base_price INTEGER NOT NULL,
      discount_pct INTEGER NOT NULL DEFAULT 0,
      discount_label TEXT,
      final_price INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(hall_id, event_date)
    );

    CREATE TABLE IF NOT EXISTS discounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      percent INTEGER NOT NULL CHECK (percent >= 0 AND percent <= 90),
      rule_type TEXT NOT NULL CHECK (rule_type IN ('month_range','fixed_dates')),
      rule_value TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function seedIfEmpty(db) {
  const { count } = db
    .prepare("SELECT COUNT(*) AS count FROM users WHERE role IN ('admin','coadmin')")
    .get();
  if (count > 0) return;

  const adminEmail = "avinandanp138@gmail.com";
  const adminPhone = "9064355617";
  const adminPass = "Avi#1427";
  const hash = bcrypt.hashSync(adminPass, 12);

  const insUser = db.prepare(
    `INSERT INTO users (name, email, phone, password_hash, role)
     VALUES (?, ?, ?, ?, 'admin')`
  );
  insUser.run("Avinandan Prasad", adminEmail, adminPhone, hash);

  const halls = [
    [
      "Celestial Ballroom",
      "celestial",
      "Crystal chandeliers and floor‑to‑ceiling daylight for receptions up to 300 guests.",
      85000,
      "https://images.unsplash.com/photo-1519167758481-83f29da4a90b?w=1200&q=80",
      300,
    ],
    [
      "Garden Atrium",
      "garden-atrium",
      "Indoor‑outdoor flow with lush greenery — ideal for daytime celebrations.",
      72000,
      "https://images.unsplash.com/photo-1464366400600-7168b8af9bc3?w=1200&q=80",
      220,
    ],
    [
      "Ivory Hall",
      "ivory",
      "Soft ivory panels and warm uplighting for intimate premium gatherings.",
      68000,
      "https://images.unsplash.com/photo-1523438885200-e635ba2c076e?w=1200&q=80",
      180,
    ],
  ];
  const insHall = db.prepare(
    `INSERT INTO halls (name, slug, description, base_price_per_day, image_url, capacity)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  for (const h of halls) insHall.run(...h);

  const insDisc = db.prepare(
    `INSERT INTO discounts (label, percent, rule_type, rule_value, active)
     VALUES (?, ?, ?, ?, 1)`
  );
  insDisc.run(
    "Summer evenings (Jun–Aug)",
    12,
    "month_range",
    JSON.stringify({ startMonth: 6, endMonth: 8 })
  );
  insDisc.run(
    "New Year week",
    18,
    "fixed_dates",
    JSON.stringify({ dates: ["2026-12-31", "2027-01-01", "2027-01-02"] })
  );
  insDisc.run(
    "Monsoon month offer (July)",
    15,
    "month_range",
    JSON.stringify({ startMonth: 7, endMonth: 7 })
  );
}

let _db;
function getDb() {
  if (!_db) {
    _db = openDb();
    migrate(_db);
    seedIfEmpty(_db);
  }
  return _db;
}

module.exports = { getDb, openDb, migrate, seedIfEmpty };
