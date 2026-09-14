import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { config } from "./config.js";

export const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Try again later." },
});

export function verifyCredentials(username, password) {
  if (username !== config.admin.username) return false;
  if (config.admin.passwordHash) return bcrypt.compareSync(password, config.admin.passwordHash);
  if (!config.admin.password) return false;
  // constant-time-ish comparison for the plaintext fallback
  const a = Buffer.from(String(password));
  const b = Buffer.from(config.admin.password);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  return res.status(401).json({ error: "Authentication required" });
}
