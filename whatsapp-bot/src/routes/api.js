import fs from "node:fs";
import express from "express";
import { z } from "zod";
import { db } from "../db.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { loginLimiter, requireAuth, verifyCredentials } from "../auth.js";
import { upload, mediaKind } from "../upload.js";
import { getStatus } from "../whatsapp.js";
import { deliver, nextRunFor, scheduleRecurring, unschedule, validateCron } from "../scheduler.js";

const log = logger.child({ module: "api" });
export const api = express.Router();

/* ---------------------------------- auth --------------------------------- */

api.post("/login", loginLimiter, (req, res) => {
  const parsed = z
    .object({ username: z.string().min(1).max(120), password: z.string().min(1).max(300) })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Username and password are required" });

  const { username, password } = parsed.data;
  if (!verifyCredentials(username, password)) {
    log.warn({ username }, "failed login attempt");
    return res.status(401).json({ error: "Invalid credentials" });
  }
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: "Could not start session" });
    req.session.user = { username };
    req.session.save(() => res.json({ ok: true, user: { username } }));
  });
});

api.post("/logout", (req, res) => {
  req.session?.destroy(() => res.json({ ok: true }));
});

api.get("/me", (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: "Authentication required" });
  res.json({ user: req.session.user });
});

// Everything below requires an authenticated admin session.
api.use(requireAuth);

/* --------------------------------- status -------------------------------- */

api.get("/status", (req, res) => {
  const status = getStatus();
  const counts = db
    .prepare("SELECT status, COUNT(*) AS n FROM posts GROUP BY status")
    .all()
    .reduce((acc, r) => ({ ...acc, [r.status]: r.n }), {});
  res.json({
    whatsapp: status,
    counts,
    config: { channelJid: config.channelJid || null, timezone: config.timezone, maxUploadMb: config.maxUploadMb },
  });
});

/* ---------------------------------- posts -------------------------------- */

const postSchema = z
  .object({
    title: z.string().max(200).optional().default(""),
    caption: z.string().max(4096).optional().default(""),
    mode: z.enum(["manual", "once", "recurring"]),
    scheduled_at: z.string().datetime({ offset: true }).optional().nullable(),
    cron_expr: z.string().min(5).max(120).optional().nullable(),
    timezone: z.string().max(64).optional().nullable(),
    enabled: z.coerce.boolean().optional().default(true),
  })
  .superRefine((val, ctx) => {
    if (val.mode === "once" && !val.scheduled_at) {
      ctx.addIssue({ code: "custom", path: ["scheduled_at"], message: "Pick a date and time" });
    }
    if (val.mode === "recurring") {
      if (!val.cron_expr) ctx.addIssue({ code: "custom", path: ["cron_expr"], message: "Cron expression required" });
      else if (!validateCron(val.cron_expr))
        ctx.addIssue({ code: "custom", path: ["cron_expr"], message: "Invalid cron expression" });
    }
  });

const shape = (row) => ({ ...row, enabled: Boolean(row.enabled), next_run_at: nextRunFor(row) });

api.get("/posts", (_req, res) => {
  const rows = db.prepare("SELECT * FROM posts ORDER BY created_at DESC").all();
  res.json({ posts: rows.map(shape) });
});

api.get("/posts/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM posts WHERE id = ?").get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: "Post not found" });
  res.json({ post: shape(row) });
});

api.post("/posts", upload.single("media"), (req, res) => {
  const parsed = postSchema.safeParse(req.body);
  if (!parsed.success) {
    if (req.file) fs.rmSync(req.file.path, { force: true });
    return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
  }
  const data = parsed.data;
  const type = req.file ? mediaKind(req.file.mimetype) : "text";
  if (!type) return res.status(400).json({ error: "Unsupported media type" });
  if (type === "text" && !data.caption.trim()) {
    return res.status(400).json({ error: "A text post needs a message" });
  }

  const status = data.mode === "manual" ? "draft" : data.enabled ? "scheduled" : "paused";
  const info = db
    .prepare(
      `INSERT INTO posts (title, type, caption, media_path, media_mime, media_name, mode, scheduled_at,
        cron_expr, timezone, status, enabled)
       VALUES (@title, @type, @caption, @media_path, @media_mime, @media_name, @mode, @scheduled_at,
        @cron_expr, @timezone, @status, @enabled)`,
    )
    .run({
      title: data.title || (data.caption || "Untitled").slice(0, 60),
      type,
      caption: data.caption,
      media_path: req.file?.path ?? null,
      media_mime: req.file?.mimetype ?? null,
      media_name: req.file?.originalname ?? null,
      mode: data.mode,
      scheduled_at: data.mode === "once" ? new Date(data.scheduled_at).toISOString() : null,
      cron_expr: data.mode === "recurring" ? data.cron_expr : null,
      timezone: data.timezone || config.timezone,
      status,
      enabled: data.enabled ? 1 : 0,
    });

  const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(info.lastInsertRowid);
  scheduleRecurring(post);
  res.status(201).json({ post: shape(post) });
});

api.put("/posts/:id", upload.single("media"), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM posts WHERE id = ?").get(id);
  if (!existing) {
    if (req.file) fs.rmSync(req.file.path, { force: true });
    return res.status(404).json({ error: "Post not found" });
  }
  const parsed = postSchema.safeParse(req.body);
  if (!parsed.success) {
    if (req.file) fs.rmSync(req.file.path, { force: true });
    return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
  }
  const data = parsed.data;
  const type = req.file ? mediaKind(req.file.mimetype) : existing.type;
  if (req.file && existing.media_path) fs.rmSync(existing.media_path, { force: true });

  db.prepare(
    `UPDATE posts SET title = @title, type = @type, caption = @caption,
       media_path = @media_path, media_mime = @media_mime, media_name = @media_name,
       mode = @mode, scheduled_at = @scheduled_at, cron_expr = @cron_expr, timezone = @timezone,
       enabled = @enabled, status = @status, updated_at = datetime('now') WHERE id = @id`,
  ).run({
    id,
    title: data.title || existing.title,
    type,
    caption: data.caption,
    media_path: req.file?.path ?? existing.media_path,
    media_mime: req.file?.mimetype ?? existing.media_mime,
    media_name: req.file?.originalname ?? existing.media_name,
    mode: data.mode,
    scheduled_at: data.mode === "once" ? new Date(data.scheduled_at).toISOString() : null,
    cron_expr: data.mode === "recurring" ? data.cron_expr : null,
    timezone: data.timezone || existing.timezone,
    enabled: data.enabled ? 1 : 0,
    status: data.mode === "manual" ? "draft" : data.enabled ? "scheduled" : "paused",
  });

  const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(id);
  scheduleRecurring(post);
  res.json({ post: shape(post) });
});

api.delete("/posts/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM posts WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "Post not found" });
  unschedule(id);
  db.prepare("DELETE FROM posts WHERE id = ?").run(id);
  if (existing.media_path) fs.rmSync(existing.media_path, { force: true });
  res.json({ ok: true });
});

api.post("/posts/:id/send-now", async (req, res, next) => {
  try {
    const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(Number(req.params.id));
    if (!post) return res.status(404).json({ error: "Post not found" });
    const result = await deliver(post, `manual:${post.id}:${Date.now()}`, { manual: true });
    if (result.ok) return res.json({ ok: true, messageId: result.messageId });
    res.status(502).json({ error: result.error || "Delivery failed" });
  } catch (err) {
    next(err);
  }
});

/* --------------------------------- history ------------------------------- */

api.get("/history", (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const rows = db
    .prepare(
      `SELECT r.id, r.post_id, r.status, r.error, r.message_id, r.created_at, r.finished_at,
              p.title, p.type
       FROM post_runs r LEFT JOIN posts p ON p.id = r.post_id
       ORDER BY r.id DESC LIMIT ?`,
    )
    .all(limit);
  res.json({ history: rows });
});
