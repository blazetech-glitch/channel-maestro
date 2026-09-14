import fs from "node:fs";
import { Boom } from "@hapi/boom";
import QRCode from "qrcode";
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import { config } from "./config.js";
import { logger, waLogger } from "./logger.js";

const log = logger.child({ module: "whatsapp" });

const state = {
  sock: null,
  connection: "close", // close | connecting | open
  qrDataUrl: null,
  me: null,
  lastError: null,
  reconnectAttempts: 0,
  stopping: false,
  lastSentAt: 0,
};

let starting = null;

export function getStatus() {
  return {
    connection: state.connection,
    hasQr: Boolean(state.qrDataUrl),
    qrDataUrl: state.qrDataUrl,
    me: state.me,
    lastError: state.lastError,
    channelJid: config.channelJid || null,
    reconnectAttempts: state.reconnectAttempts,
  };
}

export async function startWhatsApp() {
  if (starting) return starting;
  starting = connect().finally(() => {
    starting = null;
  });
  return starting;
}

async function connect() {
  state.connection = "connecting";
  const { state: authState, saveCreds } = await useMultiFileAuthState(config.waAuthDir);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));

  const sock = makeWASocket({
    auth: authState,
    version,
    logger: waLogger,
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    browser: ["ChannelAutoPost", "Chrome", "1.0.0"],
  });
  state.sock = sock;

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      // QR is only ever surfaced to the authenticated admin dashboard.
      state.qrDataUrl = await QRCode.toDataURL(qr);
      log.info("new QR code ready — scan it from the dashboard");
    }

    if (connection === "open") {
      state.connection = "open";
      state.qrDataUrl = null;
      state.lastError = null;
      state.reconnectAttempts = 0;
      state.me = sock.user ? { id: sock.user.id, name: sock.user.name || null } : null;
      log.info({ user: state.me?.name }, "connected to WhatsApp");
    }

    if (connection === "connecting") state.connection = "connecting";

    if (connection === "close") {
      state.connection = "close";
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      state.lastError = loggedOut ? "logged out — re-scan the QR code" : `disconnected (${statusCode ?? "unknown"})`;

      if (state.stopping) return;
      if (loggedOut) {
        // Credentials are no longer valid: clear them so a fresh QR is issued.
        fs.rmSync(config.waAuthDir, { recursive: true, force: true });
        fs.mkdirSync(config.waAuthDir, { recursive: true });
      }
      state.reconnectAttempts += 1;
      const delay = Math.min(60_000, 2_000 * 2 ** Math.min(state.reconnectAttempts - 1, 5));
      log.warn({ statusCode, delay }, "connection closed, reconnecting");
      setTimeout(() => {
        startWhatsApp().catch((err) => log.error({ err: err.message }, "reconnect failed"));
      }, delay);
    }
  });

  return sock;
}

export async function stopWhatsApp() {
  state.stopping = true;
  try {
    await state.sock?.end?.(undefined);
  } catch {
    /* ignore */
  }
  state.sock = null;
  state.connection = "close";
}

async function rateLimitGate() {
  const wait = config.minSendIntervalMs - (Date.now() - state.lastSentAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  state.lastSentAt = Date.now();
}

/**
 * Send one post to the configured WhatsApp Channel.
 * @param {{type:string, caption:string, media_path?:string|null, media_mime?:string|null}} post
 */
export async function sendPost(post) {
  if (!config.channelJid) throw new Error("CHANNEL_JID is not configured");
  if (state.connection !== "open" || !state.sock) throw new Error("WhatsApp is not connected");

  let content;
  if (post.type === "text") {
    if (!post.caption?.trim()) throw new Error("text posts need a message body");
    content = { text: post.caption };
  } else {
    if (!post.media_path || !fs.existsSync(post.media_path)) throw new Error("media file is missing on disk");
    const buffer = fs.readFileSync(post.media_path);
    content =
      post.type === "image"
        ? { image: buffer, caption: post.caption || undefined, mimetype: post.media_mime || "image/jpeg" }
        : { video: buffer, caption: post.caption || undefined, mimetype: post.media_mime || "video/mp4" };
  }

  await rateLimitGate();
  const res = await state.sock.sendMessage(config.channelJid, content);
  return res?.key?.id || null;
}
