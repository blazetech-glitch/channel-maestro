import "dotenv/config";
import path from "node:path";
import fs from "node:fs";

const bool = (v, d = false) => (v === undefined ? d : ["1", "true", "yes"].includes(String(v).toLowerCase()));
const int = (v, d) => (v === undefined || v === "" || Number.isNaN(Number(v)) ? d : Number(v));

const root = process.cwd();
const abs = (p) => (path.isAbsolute(p) ? p : path.join(root, p));

export const config = {
  env: process.env.NODE_ENV || "development",
  port: int(process.env.PORT, 3000),
  publicUrl: process.env.PUBLIC_URL || "",
  trustProxy: true,

  admin: {
    username: process.env.ADMIN_USERNAME || "admin",
    password: process.env.ADMIN_PASSWORD || "",
    passwordHash: process.env.ADMIN_PASSWORD_HASH || "",
  },
  sessionSecret: process.env.SESSION_SECRET || "",
  secureCookies: bool(process.env.SECURE_COOKIES, (process.env.NODE_ENV || "") === "production"),

  channelJid: (process.env.CHANNEL_JID || "").trim(),
  waAuthDir: abs(process.env.WA_AUTH_DIR || "./data/wa-auth"),
  minSendIntervalMs: int(process.env.MIN_SEND_INTERVAL_MS, 5000),

  dbPath: abs(process.env.DB_PATH || "./data/bot.db"),
  uploadDir: abs(process.env.UPLOAD_DIR || "./data/uploads"),
  maxUploadMb: int(process.env.MAX_UPLOAD_MB, 32),

  timezone: process.env.TIMEZONE || "UTC",
};

export function validateConfig() {
  const problems = [];
  if (!config.sessionSecret || config.sessionSecret.length < 16) {
    problems.push("SESSION_SECRET must be set to a random string of at least 16 characters.");
  }
  if (!config.admin.passwordHash && !config.admin.password) {
    problems.push("Set ADMIN_PASSWORD or ADMIN_PASSWORD_HASH.");
  }
  if (config.channelJid && !config.channelJid.endsWith("@newsletter")) {
    problems.push("CHANNEL_JID must end with @newsletter.");
  }
  return problems;
}

export function ensureDirs() {
  for (const dir of [path.dirname(config.dbPath), config.uploadDir, config.waAuthDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
