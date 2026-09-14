import pino from "pino";
import { config } from "./config.js";

/**
 * Central logger. Credentials, keys and tokens are redacted so WhatsApp
 * session material can never end up in logs.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL || (config.env === "production" ? "info" : "debug"),
  redact: {
    paths: [
      "password",
      "*.password",
      "creds",
      "*.creds",
      "keys",
      "*.keys",
      "req.headers.cookie",
      "req.headers.authorization",
      "*.noiseKey",
      "*.signedIdentityKey",
      "*.signedPreKey",
      "*.myAppStateKeyId",
      "*.sessionSecret",
    ],
    censor: "[redacted]",
  },
});

// Baileys expects a pino-like child logger.
export const waLogger = logger.child({ module: "baileys" }, { level: "warn" });
