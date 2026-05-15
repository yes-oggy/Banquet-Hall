const path = require("path");
const crypto = require("crypto");
const express = require("express");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const { getDb } = require("./db");
const { bestDiscountForDate } = require("./discountEngine");
const {
  signUserToken,
  clearToken,
  verifyToken,
  requireRole,
} = require("./auth");

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(
  express.static(path.join(__dirname, "..", "public"), {
    extensions: ["html"],
  })
);

function normEmail(s) {
  return String(s || "")
    .trim()
    .toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** India mobile: 10 digits, starts 6-9 */
function isValidPhoneIN(phone) {
  const d = String(phone || "").replace(/\D/g, "");
  return /^[6-9]\d{9}$/.test(d);
}

function isStrongPassword(p) {
  const s = String(p || "");
  if (s.length < 8) return false;
  if (!/[A-Za-z]/.test(s)) return false;
  if (!/\d/.test(s)) return false;
  if (!/[^A-Za-z0-9]/.test(s)) return false;
  return true;
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function isFutureOrToday(isoDate) {
  return /^\d{4}-\d{2}-\d{2}$/.test(isoDate) && isoDate >= todayISO();
}

function touchLastSeen(userId) {
  const db = getDb();
  db.prepare(
    `UPDATE users SET last_seen_at = datetime('now') WHERE id = ?`
  ).run(userId);
}

function authAndTouch(req, res, next) {
  verifyToken(req, res, () => {
    touchLastSeen(Number(req.user.sub));
    next();
  });
}

function issuePasswordResetToken(userId) {
  const db = getDb();
  const token = crypto.randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");

  db.prepare(`UPDATE password_resets SET used_at = datetime('now') WHERE user_id = ?`)
    .run(userId);
  db.prepare(
    `INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)`
  ).run(userId, token, expiresAt);

  return token;
}

app.post("/api/auth/register", (req, res) => {
  const { name, email, phone, password } = req.body || {};
  const n = String(name || "").trim();
  const e = normEmail(email);
  const ph = String(phone || "").replace(/\D/g, "");

  if (n.length < 2) {
    return res.status(400).json({ error: "Please enter your full name." });
  }
  if (!isValidEmail(e)) {
    return res.status(400).json({ error: "Enter a valid email address." });
  }
  if (!isValidPhoneIN(ph)) {
    return res
      .status(400)
      .json({ error: "Enter a valid 10‑digit Indian mobile number." });
  }
  if (!isStrongPassword(password)) {
    return res.status(400).json({
      error:
        "Password must be 8+ characters and include a letter, a number, and a symbol.",
    });
  }

  const db = getDb();
  const exists = db.prepare("SELECT id FROM users WHERE email = ?").get(e);
  if (exists) {
    return res.status(409).json({ error: "An account with this email exists." });
  }

  const hash = bcrypt.hashSync(password, 12);
  const info = db
    .prepare(
      `INSERT INTO users (name, email, phone, password_hash, role)
       VALUES (?, ?, ?, ?, 'user')`
    )
    .run(n, e, ph, hash);

  const user = db
    .prepare(
      "SELECT id, name, email, phone, role, created_at FROM users WHERE id = ?"
    )
    .get(info.lastInsertRowid);

  signUserToken(user, res);
  res.json({ user });
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  const e = normEmail(email);
  if (!e || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const db = getDb();
  const row = db
    .prepare(
      "SELECT id, name, email, phone, role, password_hash, created_at FROM users WHERE email = ?"
    )
    .get(e);
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  db.prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`).run(
    row.id
  );

  const user = {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    created_at: row.created_at,
  };
  signUserToken(user, res);
  res.json({ user });
});

app.post("/api/auth/logout", (req, res) => {
  clearToken(res);
  res.json({ ok: true });
});

app.post("/api/auth/forgot-password", (req, res) => {
  const { email, phone } = req.body || {};
  const e = normEmail(email);
  const ph = String(phone || "").replace(/\D/g, "");
  if (!isValidEmail(e) || !isValidPhoneIN(ph)) {
    return res.status(400).json({ error: "Enter a valid email and phone." });
  }

  const db = getDb();
  const user = db
    .prepare("SELECT id FROM users WHERE email = ? AND phone = ?")
    .get(e, ph);
  if (!user) {
    return res
      .status(404)
      .json({ error: "No user found with that email and phone." });
  }

  const token = issuePasswordResetToken(user.id);
  res.json({
    ok: true,
    reset_token: token,
    note: "Demo mode: token returned directly. In production, send this by email/SMS.",
  });
});

app.post("/api/auth/reset-password", (req, res) => {
  const { token, new_password } = req.body || {};
  if (!token || !isStrongPassword(new_password)) {
    return res.status(400).json({
      error:
        "Token and strong new password are required (8+ chars with letter, number, symbol).",
    });
  }

  const db = getDb();
  const row = db
    .prepare(
      `SELECT pr.id, pr.user_id
       FROM password_resets pr
       WHERE pr.token = ?
         AND pr.used_at IS NULL
         AND datetime(pr.expires_at) > datetime('now')`
    )
    .get(String(token));

  if (!row) {
    return res.status(400).json({ error: "Invalid or expired reset token." });
  }

  const hash = bcrypt.hashSync(String(new_password), 12);
  const tx = db.transaction(() => {
    db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(
      hash,
      row.user_id
    );
    db.prepare(`UPDATE password_resets SET used_at = datetime('now') WHERE id = ?`).run(
      row.id
    );
  });
  tx();
  res.json({ ok: true });
});

app.get("/api/me", authAndTouch, (req, res) => {
  const db = getDb();
  const user = db
    .prepare(
      `SELECT id, name, email, phone, role, created_at, last_login_at, last_seen_at
       FROM users WHERE id = ?`
    )
    .get(Number(req.user.sub));
  if (!user) {
    clearToken(res);
    return res.status(401).json({ error: "Not found" });
  }
  res.json({ user });
});

app.patch("/api/me", authAndTouch, (req, res) => {
  if (req.user.role !== "user") {
    return res.status(403).json({ error: "Use admin tools for staff profiles." });
  }
  const { name, phone } = req.body || {};
  const n = name != null ? String(name).trim() : null;
  const phRaw = phone != null ? String(phone).replace(/\D/g, "") : null;

  if (n !== null && n.length < 2) {
    return res.status(400).json({ error: "Name is too short." });
  }
  if (phRaw !== null && !isValidPhoneIN(phRaw)) {
    return res.status(400).json({ error: "Invalid phone number." });
  }

  const db = getDb();
  const cur = db
    .prepare("SELECT name, phone FROM users WHERE id = ?")
    .get(Number(req.user.sub));
  const newName = n !== null ? n : cur.name;
  const newPhone = phRaw !== null ? phRaw : cur.phone;

  db.prepare(`UPDATE users SET name = ?, phone = ? WHERE id = ?`).run(
    newName,
    newPhone,
    Number(req.user.sub)
  );
  const user = db
    .prepare(
      `SELECT id, name, email, phone, role, created_at, last_login_at, last_seen_at
       FROM users WHERE id = ?`
    )
    .get(Number(req.user.sub));
  res.json({ user });
});

app.post("/api/me/change-password", authAndTouch, (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !isStrongPassword(new_password)) {
    return res.status(400).json({
      error:
        "Current password and a strong new password are required (8+ chars with letter, number, symbol).",
    });
  }

  const db = getDb();
  const row = db
    .prepare("SELECT id, password_hash FROM users WHERE id = ?")
    .get(Number(req.user.sub));
  if (!row) return res.status(404).json({ error: "User not found." });
  if (!bcrypt.compareSync(String(current_password), row.password_hash)) {
    return res.status(401).json({ error: "Current password is incorrect." });
  }

  const hash = bcrypt.hashSync(String(new_password), 12);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
    hash,
    row.id
  );
  db.prepare(`UPDATE password_resets SET used_at = datetime('now') WHERE user_id = ?`)
    .run(row.id);
  res.json({ ok: true });
});

app.get("/api/promotions", (req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT label, percent, rule_type, rule_value
       FROM discounts WHERE active = 1 ORDER BY percent DESC`
    )
    .all();
  const promos = rows.map((r) => {
    let summary = "";
    try {
      const v = JSON.parse(r.rule_value);
      if (r.rule_type === "month_range") {
        const months = [
          "",
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "Jun",
          "Jul",
          "Aug",
          "Sep",
          "Oct",
          "Nov",
          "Dec",
        ];
        summary = `${months[v.startMonth]}–${months[v.endMonth]}`;
      } else if (Array.isArray(v.dates)) {
        summary = v.dates.slice(0, 3).join(", ") + (v.dates.length > 3 ? "…" : "");
      }
    } catch {
      summary = "";
    }
    return {
      label: r.label,
      percent: r.percent,
      rule_type: r.rule_type,
      summary,
    };
  });
  res.json({ promotions: promos });
});

app.get("/api/halls", (req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, name, slug, description, base_price_per_day, image_url, capacity
       FROM halls WHERE featured = 1 ORDER BY id`
    )
    .all();
  res.json({ halls: rows });
});

app.get("/api/halls/:id/quote", (req, res) => {
  const id = Number(req.params.id);
  const eventDate = String(req.query.date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
    return res.status(400).json({ error: "Use ?date=YYYY-MM-DD" });
  }
  const db = getDb();
  const hall = db
    .prepare(
      `SELECT id, name, base_price_per_day FROM halls WHERE id = ?`
    )
    .get(id);
  if (!hall) return res.status(404).json({ error: "Hall not found" });

  const discounts = db
    .prepare(`SELECT * FROM discounts WHERE active = 1`)
    .all();
  const best = bestDiscountForDate(discounts, eventDate);
  const base = hall.base_price_per_day;
  const final = Math.round(base * (1 - best.percent / 100));

  res.json({
    hall_id: hall.id,
    hall_name: hall.name,
    event_date: eventDate,
    base_price: base,
    discount_pct: best.percent,
    discount_label: best.label || null,
    final_price: final,
  });
});

app.get("/api/my/bookings", authAndTouch, (req, res) => {
  if (req.user.role !== "user") {
    return res.json({ bookings: [] });
  }
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT b.*, h.name AS hall_name, h.image_url
       FROM bookings b
       JOIN halls h ON h.id = b.hall_id
       WHERE b.user_id = ?
       ORDER BY b.event_date DESC`
    )
    .all(Number(req.user.sub));
  res.json({ bookings: rows });
});

app.post("/api/my/bookings", authAndTouch, (req, res) => {
  if (req.user.role !== "user") {
    return res.status(403).json({ error: "Only guests use this booking flow." });
  }
  const { hall_id, event_date, guest_count } = req.body || {};
  const hid = Number(hall_id);
  const ed = String(event_date || "").slice(0, 10);
  const guests = Math.max(1, Math.min(2000, Number(guest_count) || 100));

  if (!hid || !/^\d{4}-\d{2}-\d{2}$/.test(ed)) {
    return res.status(400).json({ error: "Hall and valid event date required." });
  }
  if (!isFutureOrToday(ed)) {
    return res.status(400).json({ error: "Event date must be today or in the future." });
  }

  const db = getDb();
  const hall = db.prepare(`SELECT * FROM halls WHERE id = ?`).get(hid);
  if (!hall) return res.status(404).json({ error: "Hall not found" });

  const discounts = db
    .prepare(`SELECT * FROM discounts WHERE active = 1`)
    .all();
  const best = bestDiscountForDate(discounts, ed);
  const base = hall.base_price_per_day;
  const final = Math.round(base * (1 - best.percent / 100));

  try {
    const info = db
      .prepare(
        `INSERT INTO bookings
         (user_id, hall_id, event_date, guest_count, base_price, discount_pct, discount_label, final_price)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        Number(req.user.sub),
        hid,
        ed,
        guests,
        base,
        best.percent,
        best.label || "",
        final
      );
    const row = db
      .prepare(
        `SELECT b.*, h.name AS hall_name, h.image_url
         FROM bookings b JOIN halls h ON h.id = b.hall_id WHERE b.id = ?`
      )
      .get(info.lastInsertRowid);
    res.status(201).json({ booking: row });
  } catch (e) {
    if (String(e.message || "").includes("UNIQUE")) {
      return res
        .status(409)
        .json({ error: "This hall is already booked on that date." });
    }
    throw e;
  }
});

/* ---------- Admin ---------- */

app.delete("/api/my/bookings/:id", authAndTouch, (req, res) => {
  if (req.user.role !== "user") {
    return res.status(403).json({ error: "Only guests can cancel their bookings." });
  }
  const id = Number(req.params.id);
  const db = getDb();
  const row = db
    .prepare(`SELECT id, user_id, event_date FROM bookings WHERE id = ?`)
    .get(id);
  if (!row) return res.status(404).json({ error: "Booking not found." });
  if (row.user_id !== Number(req.user.sub)) {
    return res.status(403).json({ error: "This booking is not yours." });
  }
  if (row.event_date < todayISO()) {
    return res.status(400).json({ error: "Past events cannot be cancelled online." });
  }
  db.prepare(`DELETE FROM bookings WHERE id = ?`).run(id);
  res.json({ ok: true });
});

app.get(
  "/api/admin/overview",
  authAndTouch,
  requireRole("admin", "coadmin"),
  (req, res) => {
    const db = getDb();
    const users = db
      .prepare(
        `SELECT id, name, email, phone, role, created_at, last_login_at, last_seen_at
         FROM users ORDER BY id DESC`
      )
      .all();
    const bookings = db
      .prepare(
        `SELECT b.*, u.name AS user_name, u.email AS user_email, h.name AS hall_name
         FROM bookings b
         JOIN users u ON u.id = b.user_id
         JOIN halls h ON h.id = b.hall_id
         ORDER BY b.created_at DESC`
      )
      .all();
    const discounts = db.prepare(`SELECT * FROM discounts ORDER BY id`).all();
    const halls = db.prepare(`SELECT * FROM halls ORDER BY id`).all();

    const activeRows = db
      .prepare(
        `SELECT id FROM users WHERE last_seen_at IS NOT NULL
         AND datetime(last_seen_at) > datetime('now', '-15 minutes')`
      )
      .all();
    const activeIds = new Set(activeRows.map((r) => r.id));

    res.json({
      users,
      bookings,
      discounts,
      halls,
      stats: {
        userCount: users.filter((u) => u.role === "user").length,
        staffCount: users.filter((u) => u.role !== "user").length,
        bookingCount: bookings.length,
        recentlyActiveCount: activeIds.size,
      },
      recentlyActiveUserIds: [...activeIds],
    });
  }
);

app.post(
  "/api/admin/coadmins",
  authAndTouch,
  requireRole("admin"),
  (req, res) => {
    const { name, email, phone, password } = req.body || {};
    const n = String(name || "").trim();
    const e = normEmail(email);
    const ph = String(phone || "").replace(/\D/g, "");

    if (n.length < 2)
      return res.status(400).json({ error: "Name is required." });
    if (!isValidEmail(e))
      return res.status(400).json({ error: "Valid email required." });
    if (!isValidPhoneIN(ph))
      return res.status(400).json({ error: "Valid 10‑digit phone required." });
    if (!isStrongPassword(password)) {
      return res.status(400).json({
        error:
          "Password must be 8+ chars with letter, number, and symbol for co‑admins.",
      });
    }

    const db = getDb();
    if (db.prepare("SELECT id FROM users WHERE email = ?").get(e)) {
      return res.status(409).json({ error: "Email already registered." });
    }

    const hash = bcrypt.hashSync(password, 12);
    const info = db
      .prepare(
        `INSERT INTO users (name, email, phone, password_hash, role)
         VALUES (?, ?, ?, ?, 'coadmin')`
      )
      .run(n, e, ph, hash);

    const user = db
      .prepare(
        `SELECT id, name, email, phone, role, created_at FROM users WHERE id = ?`
      )
      .get(info.lastInsertRowid);
    res.status(201).json({ user });
  }
);

app.post(
  "/api/admin/discounts",
  authAndTouch,
  requireRole("admin", "coadmin"),
  (req, res) => {
    const { label, percent, rule_type, rule_value } = req.body || {};
    const pct = Number(percent);
    const rt = rule_type === "fixed_dates" ? "fixed_dates" : "month_range";

    if (!String(label || "").trim()) {
      return res.status(400).json({ error: "Label required." });
    }
    if (!(pct >= 1 && pct <= 90))
      return res.status(400).json({ error: "Percent must be 1–90." });

    let json = "{}";
    try {
      const v =
        typeof rule_value === "string" ? JSON.parse(rule_value) : rule_value;
      if (rt === "month_range") {
        if (!v.startMonth || !v.endMonth) throw new Error("months");
      } else {
        if (!Array.isArray(v.dates) || !v.dates.length) throw new Error("dates");
      }
      json = JSON.stringify(v);
    } catch {
      return res.status(400).json({
        error:
          rt === "month_range"
            ? 'rule_value must be JSON like {"startMonth":6,"endMonth":8}'
            : 'rule_value must be JSON like {"dates":["2026-12-31"]}',
      });
    }

    const db = getDb();
    const info = db
      .prepare(
        `INSERT INTO discounts (label, percent, rule_type, rule_value, active)
         VALUES (?, ?, ?, ?, 1)`
      )
      .run(String(label).trim(), pct, rt, json);

    const row = db.prepare(`SELECT * FROM discounts WHERE id = ?`).get(
      info.lastInsertRowid
    );
    res.status(201).json({ discount: row });
  }
);

app.patch(
  "/api/admin/discounts/:id",
  authAndTouch,
  requireRole("admin", "coadmin"),
  (req, res) => {
    const id = Number(req.params.id);
    const { active, label } = req.body || {};
    const db = getDb();
    const row = db.prepare(`SELECT * FROM discounts WHERE id = ?`).get(id);
    if (!row) return res.status(404).json({ error: "Not found" });

    const newLabel = label != null ? String(label).trim() : row.label;
    const newActive =
      active === true ? 1 : active === false ? 0 : row.active;

    db.prepare(
      `UPDATE discounts SET label = ?, active = ? WHERE id = ?`
    ).run(newLabel, newActive, id);
    const out = db.prepare(`SELECT * FROM discounts WHERE id = ?`).get(id);
    res.json({ discount: out });
  }
);

app.delete(
  "/api/admin/users/:id",
  authAndTouch,
  requireRole("admin"),
  (req, res) => {
    const id = Number(req.params.id);
    if (id === Number(req.user.sub)) {
      return res.status(400).json({ error: "You cannot delete yourself." });
    }
    const db = getDb();
    const u = db.prepare(`SELECT role FROM users WHERE id = ?`).get(id);
    if (!u) return res.status(404).json({ error: "Not found" });
    if (u.role === "admin") {
      return res.status(403).json({ error: "Cannot delete primary admin." });
    }
    db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
    res.json({ ok: true });
  }
);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Server error" });
});

app.get("*", (req, res) => {
  if (req.path.startsWith("/api")) {
    return res.status(404).json({ error: "Not found" });
  }
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Banquet Hall server → http://localhost:${PORT}`);
  console.log(`On your LAN, others can try http://<this-PC-IPv4>:${PORT} (firewall must allow it).`);
});
