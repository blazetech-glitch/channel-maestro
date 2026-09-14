import Database from "better-sqlite3";
import { config, ensureDirs } from "./config.js";
import { logger } from "./logger.js";

ensureDirs();

export const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      title         TEXT NOT NULL DEFAULT '',
      type          TEXT NOT NULL CHECK (type IN ('text','image','video')),
      caption       TEXT NOT NULL DEFAULT '',
      media_path    TEXT,
      media_mime    TEXT,
      media_name    TEXT,
      mode          TEXT NOT NULL CHECK (mode IN ('manual','once','recurring')),
      scheduled_at  TEXT,              -- ISO-8601 UTC, for mode = once
      cron_expr     TEXT,              -- for mode = recurring
      timezone      TEXT NOT NULL DEFAULT 'UTC',
      status        TEXT NOT NULL DEFAULT 'draft', -- draft|scheduled|sent|failed|paused
      enabled       INTEGER NOT NULL DEFAULT 1,
      last_run_at   TEXT,
      last_error    TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- One row per delivery attempt. run_key is unique, which is what makes
    -- deliveries idempotent across server restarts.
    CREATE TABLE IF NOT EXISTS post_runs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id     INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      run_key     TEXT NOT NULL UNIQUE,
      status      TEXT NOT NULL, -- claimed|sent|failed
      error       TEXT,
      message_id  TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_posts_due ON posts(status, mode, scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_runs_post ON post_runs(post_id, created_at DESC);
  `);
  logger.info("database ready");
}

/**
 * Try to claim a delivery. Returns the run id, or null when this exact run
 * was already claimed/sent before (duplicate protection).
 */
export function claimRun(postId, runKey) {
  try {
    const info = db
      .prepare("INSERT INTO post_runs (post_id, run_key, status) VALUES (?, ?, 'claimed')")
      .run(postId, runKey);
    return info.lastInsertRowid;
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) return null;
    throw err;
  }
}

export function finishRun(runId, { status, error = null, messageId = null }) {
  db.prepare(
    "UPDATE post_runs SET status = ?, error = ?, message_id = ?, finished_at = datetime('now') WHERE id = ?",
  ).run(status, error, messageId, runId);
}

/** Any run left in 'claimed' state belongs to a crashed process. */
export function recoverStaleRuns() {
  const info = db
    .prepare(
      `UPDATE post_runs SET status = 'failed', error = 'interrupted by server restart',
       finished_at = datetime('now') WHERE status = 'claimed'`,
    )
    .run();
  if (info.changes) logger.warn({ changes: info.changes }, "recovered interrupted runs");
}
