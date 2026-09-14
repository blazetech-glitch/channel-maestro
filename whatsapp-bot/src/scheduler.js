import cron from "node-cron";
import cronParser from "cron-parser";
import { db, claimRun, finishRun } from "./db.js";
import { sendPost } from "./whatsapp.js";
import { config } from "./config.js";
import { logger } from "./logger.js";

const log = logger.child({ module: "scheduler" });

/** postId -> node-cron task */
const tasks = new Map();
let tickTimer = null;

export function validateCron(expr) {
  return cron.validate(expr);
}

export function nextRunFor(post) {
  try {
    if (post.mode === "once") return post.scheduled_at || null;
    if (post.mode === "recurring" && post.cron_expr) {
      const it = cronParser.parseExpression(post.cron_expr, { tz: post.timezone || config.timezone });
      return it.next().toISOString();
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Deliver a post exactly once per runKey. Safe to call twice: the second call
 * is a no-op because the run row is unique.
 */
export async function deliver(post, runKey, { manual = false } = {}) {
  const runId = claimRun(post.id, runKey);
  if (!runId) {
    log.info({ postId: post.id, runKey }, "duplicate delivery skipped");
    return { skipped: true };
  }
  try {
    const messageId = await sendPost(post);
    finishRun(runId, { status: "sent", messageId });
    db.prepare(
      `UPDATE posts SET last_run_at = datetime('now'), last_error = NULL,
       status = CASE WHEN mode = 'recurring' THEN 'scheduled' ELSE 'sent' END,
       updated_at = datetime('now') WHERE id = ?`,
    ).run(post.id);
    log.info({ postId: post.id, manual, messageId }, "post delivered");
    return { ok: true, messageId };
  } catch (err) {
    finishRun(runId, { status: "failed", error: err.message });
    db.prepare(
      `UPDATE posts SET last_error = ?, status = CASE WHEN mode = 'recurring' THEN 'scheduled' ELSE 'failed' END,
       updated_at = datetime('now') WHERE id = ?`,
    ).run(err.message, post.id);
    log.error({ postId: post.id, err: err.message }, "post delivery failed");
    return { ok: false, error: err.message };
  }
}

export function scheduleRecurring(post) {
  unschedule(post.id);
  if (post.mode !== "recurring" || !post.enabled || !post.cron_expr) return;
  if (!cron.validate(post.cron_expr)) {
    log.warn({ postId: post.id, cron: post.cron_expr }, "invalid cron expression, not scheduled");
    return;
  }
  const task = cron.schedule(
    post.cron_expr,
    () => {
      const fresh = db.prepare("SELECT * FROM posts WHERE id = ?").get(post.id);
      if (!fresh || !fresh.enabled) return;
      // Minute-precision run key => a restart inside the same minute cannot double-post.
      const runKey = `cron:${fresh.id}:${new Date().toISOString().slice(0, 16)}`;
      deliver(fresh, runKey).catch((err) => log.error({ err: err.message }, "cron delivery error"));
    },
    { timezone: post.timezone || config.timezone },
  );
  tasks.set(post.id, task);
  log.info({ postId: post.id, cron: post.cron_expr }, "recurring post scheduled");
}

export function unschedule(postId) {
  const task = tasks.get(postId);
  if (task) {
    task.stop();
    tasks.delete(postId);
  }
}

/** One-off posts are picked up by a polling tick, so a restart never loses them. */
async function tick() {
  const due = db
    .prepare(
      `SELECT * FROM posts WHERE mode = 'once' AND enabled = 1 AND status = 'scheduled'
       AND scheduled_at IS NOT NULL AND scheduled_at <= ? ORDER BY scheduled_at ASC LIMIT 5`,
    )
    .all(new Date().toISOString());

  for (const post of due) {
    await deliver(post, `once:${post.id}:${post.scheduled_at}`);
  }
}

export function startScheduler() {
  for (const post of db.prepare("SELECT * FROM posts WHERE mode = 'recurring' AND enabled = 1").all()) {
    scheduleRecurring(post);
  }
  tickTimer = setInterval(() => {
    tick().catch((err) => log.error({ err: err.message }, "scheduler tick failed"));
  }, 15_000);
  tick().catch(() => {});
  log.info("scheduler started");
}

export function stopScheduler() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
  for (const [id] of tasks) unschedule(id);
  log.info("scheduler stopped");
}
