# WhatsApp Channel Auto-Post Bot

Schedule and auto-publish text, image and video posts to a **WhatsApp Channel**
(newsletter) from a small admin dashboard. Node.js + Baileys + SQLite.

> Uses only normal WhatsApp functionality: it posts to a channel **you own**,
> from **your own** linked device, with a minimum gap between sends. No mass
> messaging, no scraping, no bypasses. Respect WhatsApp's Terms of Service.

## Features

- Post text, images and videos to one channel
- Three modes per post: manual, one-off scheduled, recurring (cron)
- Web dashboard: create, edit, delete, pause, **Post Now**, live status, history
- SQLite storage (`better-sqlite3`), WAL enabled
- Admin login (bcrypt hash, http-only session cookie, login rate limit); every
  `/api` route except login is protected
- Session credentials stored server-side in `WA_AUTH_DIR`, never sent to the
  browser and redacted from logs
- Automatic reconnect with exponential backoff; fresh QR after a logout
- Duplicate-safe: every delivery has a unique run key, so restarts and
  double-triggers cannot re-post the same scheduled slot
- Structured logging (pino), input validation (zod), graceful shutdown

## Requirements

- Node.js 20+
- A WhatsApp account that is an **admin of the channel**
- A host with a persistent disk (the session and database must survive restarts)

## Install

```bash
cd whatsapp-bot
npm install
cp .env.example .env
npm run hash -- "your-admin-password"   # paste result into ADMIN_PASSWORD_HASH
npm run db:init
npm start
```

Open http://localhost:3000 and sign in with `ADMIN_USERNAME` + your password.

## Link WhatsApp

1. Start the server and sign in to the dashboard.
2. The **Connection** card shows a QR code.
3. On your phone: WhatsApp → Settings → **Linked devices** → **Link a device** → scan.
4. The badge turns `open`. Credentials are written to `WA_AUTH_DIR` and reused
   on every later start — you only scan once.

## Find your CHANNEL_JID

A channel JID looks like `120363XXXXXXXXXXXX@newsletter`.

- WhatsApp Web: open the channel; the id appears in the URL / channel invite link
  (`https://whatsapp.com/channel/<invite-code>`), or
- run this once in a Node REPL while linked:

```js
// with the bot running, easiest path: log your channels
// (add temporarily to src/server.js after connection opens)
const list = await sock.newsletterFetchSubscribed?.();
console.log(list);
```

Put the value in `.env` as `CHANNEL_JID=...@newsletter` and restart. The
dashboard shows the configured channel so you can confirm it.

## Scheduling

- **Manual** — only sends when you press *Post now*.
- **Once** — pick a date/time; a 15-second tick delivers it, so a restart just
  before the slot still sends it (once).
- **Recurring** — standard 5-field cron, e.g. `0 9 * * *` (daily 09:00),
  `*/30 * * * *` (every 30 min), `0 12 * * 1` (Mondays noon). Timezone is per
  post, defaulting to `TIMEZONE`.

## Uploads

Allowed: `image/jpeg`, `image/png`, `image/webp`, `video/mp4`, `video/quicktime`,
`video/webm`. Limit: `MAX_UPLOAD_MB` (default 32 MB), one file per post. Files
are stored with generated names in `UPLOAD_DIR`, never served publicly.

## API (session-cookie protected)

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/login` / `/api/logout` | admin session |
| GET | `/api/status` | connection, QR, counts |
| GET/POST | `/api/posts` | list / create (multipart) |
| GET/PUT/DELETE | `/api/posts/:id` | read / update / delete |
| POST | `/api/posts/:id/send-now` | manual publish |
| GET | `/api/history` | delivery log |
| GET | `/healthz` | health probe (public) |

## Deployment

Any host that runs a **long-lived Node process with a persistent disk** works.
Serverless/edge platforms do not — the WhatsApp socket must stay open.

**Render** — `render.yaml` is included (web service + 1 GB disk). Set
`ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `CHANNEL_JID` in the dashboard;
`SESSION_SECRET` is generated. Deploy, then scan the QR from the dashboard.

**Heroku** — easiest way: the one-click button below. Heroku opens a form that
asks for every required setting (admin username, admin password hash, channel
JID); `SESSION_SECRET` is generated for you. Fill it in and deploy.

```markdown
[![Deploy](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy?template=https://github.com/YOUR_USERNAME/YOUR_REPO/tree/main/whatsapp-bot)
```

> Replace `YOUR_USERNAME/YOUR_REPO` with your GitHub repo after pushing.

Manual deploy with the CLI:

```bash
heroku create my-wa-bot
heroku config:set SESSION_SECRET=... ADMIN_USERNAME=admin ADMIN_PASSWORD_HASH='...' CHANNEL_JID='...@newsletter'
git subtree push --prefix whatsapp-bot heroku main
```

Heroku's filesystem is ephemeral: the SQLite DB, uploads and WhatsApp session
live in `/tmp` by default and are wiped on every restart (you re-scan the QR).
For full persistence use the Heroku File Storage add-on or deploy on Render /
a VPS, which keep a persistent disk.

**Docker / VPS / game panels (Pterodactyl, aaPanel, etc.)**

```bash
docker build -t wa-channel-bot ./whatsapp-bot
docker run -d --name wa-bot -p 3000:3000 --env-file whatsapp-bot/.env \
  -v $PWD/wa-data:/app/data wa-channel-bot
```

On a plain VPS use pm2 or systemd:

```bash
npm install -g pm2
pm2 start src/server.js --name wa-bot && pm2 save
```

Always run the dashboard behind HTTPS (reverse proxy) and set
`SECURE_COOKIES=true`.

## Configuration

See `.env.example` — `PORT`, `CHANNEL_JID`, `ADMIN_USERNAME`,
`ADMIN_PASSWORD` / `ADMIN_PASSWORD_HASH`, `SESSION_SECRET`, `WA_AUTH_DIR`,
`DB_PATH`, `UPLOAD_DIR`, `MAX_UPLOAD_MB`, `MIN_SEND_INTERVAL_MS`, `TIMEZONE`.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Startup exits with config errors | Set `SESSION_SECRET` and an admin password |
| Badge stuck on `connecting` | Scan the QR; check outbound network access |
| `logged out — re-scan the QR code` | The device was unlinked in WhatsApp; scan again |
| `WhatsApp is not connected` on Post Now | Wait for the badge to read `open` |
| `CHANNEL_JID is not configured` | Add the `...@newsletter` id and restart |
| `better-sqlite3` build error | Install build tools (`python3 make g++`) or use the Dockerfile |

## Verified locally

Install, database setup, admin login, protected API (401 without a session),
dashboard, post creation, one-off delivery at its slot and recurring cron
delivery every minute were all exercised end-to-end. The Baileys socket
connected to WhatsApp and issued a QR code. Deliveries recorded
`WhatsApp is not connected` because no phone had scanned that QR — after you
scan once, the same runs post to your channel.
