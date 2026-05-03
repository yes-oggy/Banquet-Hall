const jwt = require("jsonwebtoken");

const JWT_SECRET =
  process.env.JWT_SECRET || "banquet-dev-secret-change-in-production";
const COOKIE_NAME = "banquet_token";

function signUserToken(user, res) {
  const payload = {
    sub: String(user.id),
    role: user.role,
    email: user.email,
  };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    secure: !!process.env.COOKIE_SECURE,
  });
  return token;
}

function clearToken(res) {
  res.cookie(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 0,
  });
}

function readToken(req) {
  const c = req.cookies && req.cookies[COOKIE_NAME];
  if (c) return c;
  const h = req.headers.authorization;
  if (h && h.startsWith("Bearer ")) return h.slice(7);
  return null;
}

function verifyToken(req, res, next) {
  const tok = readToken(req);
  if (!tok) {
    return res.status(401).json({ error: "Not signed in" });
  }
  try {
    req.user = jwt.verify(tok, JWT_SECRET);
    return next();
  } catch {
    clearToken(res);
    return res.status(401).json({ error: "Session expired" });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Not signed in" });
    if (!roles.includes(req.user.role))
      return res.status(403).json({ error: "Forbidden" });
    next();
  };
}

module.exports = {
  signUserToken,
  clearToken,
  readToken,
  verifyToken,
  requireRole,
  COOKIE_NAME,
};
