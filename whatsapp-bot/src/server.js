import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import express from "express";
import helmet from "helmet";
import session from "express-session";
import cookieParser from "cookie-parser";
import { config, validateConfig, ensureDirs } from "./config.js";
import { logger } from "./logger.js";
import { migrate, recoverStaleRuns, db } from "./db.js";
import { api } from "./routes/api.js";
import { startScheduler, stopScheduler } from "./scheduler.js";
import { startWhatsApp, stopWhatsApp } from "./whatsapp.js";

const log = logger.child({ module: "server" });

const problems = validateConfig();
if (problems.length) {
  for (const p of problems) log.fatal(p);
  log.fatal("fix the configuration in .env and start again (see .env.example)");
  process.exit(1);
}

ensureDirs();
migrate();
recoverStaleRuns();

const app = express();
app.set("trust proxy", 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "img-src": ["'self'", "data:"],
        "script-src": ["'self'"],
        "style-src": ["'self'", "'unsafe-inline'"],
      },
    },
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));
app.use(cookieParser());
app.use(
  session({
    name: "wacb.sid",
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: config.secureCookies,
      maxAge: 12 * 60 * 60 * 1000,
    },
  }),
);

app.get("/healthz", (_req, res) => res.json({ ok: true, uptime: process.uptime() }));
app.use("/api", api);
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
app.use(express.static(publicDir, { maxAge: "1h" }));
app.get("*", (_req, res) => res.sendFile(path.join(publicDir, "index.html")));

// Central error handler — never leaks stack traces to clients.
app.use((err, _req, res, _next) => {
  const isUpload = err?.code?.startsWith?.("LIMIT_");
  const status = isUpload || /Unsupported file type/.test(err.message) ? 400 : 500;
  log.error({ err: err.message, code: err.code }, "request failed");
  res.status(status).json({ error: status === 400 ? err.message : "Internal server error" });
});

const server = http.createServer(app);
server.listen(config.port, () => {
  log.info({ port: config.port, env: config.env }, "dashboard listening");
});

startScheduler();
startWhatsApp().catch((err) => log.error({ err: err.message }, "WhatsApp startup failed"));

/* ---------------------------- graceful shutdown --------------------------- */

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, "shutting down");
  stopScheduler();
  await stopWhatsApp();
  server.close(() => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    log.info("bye");
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => log.error({ reason: String(reason) }, "unhandled rejection"));
process.on("uncaughtException", (err) => log.error({ err: err.message }, "uncaught exception"));
