# Channel Maestro

Build a complete, working WhatsApp Channel Auto-Post Bot using Node.js and a suitable WhatsApp Web library such as Baileys.

Requirements

Auto-post text, images, and videos to a WhatsApp Channel.

Support scheduled and recurring posts using a reliable scheduler.

Provide a simple web dashboard to create, edit, delete, schedule, and view post history.

Store posts and schedules in a lightweight database such as SQLite.

Secure admin authentication and protect all API routes.

Store WhatsApp session credentials securely in environment/server storage; never expose them in the frontend or logs.

Automatically reconnect after temporary connection failures.

Add proper error handling, logging, validation, and graceful shutdown.

Prevent duplicate posts when the server restarts.

Make the bot configurable through .env, including CHANNEL_JID, PORT, and admin settings.

Include upload support with safe file-size/type validation.

Include a manual Post Now button for admins.

Make it deployable and run on panels render heroku and so on

Safety

Use only legitimate WhatsApp functionality and respect WhatsApp's terms and rate limits. Do not implement spam, mass messaging, scraping, credential theft, session hijacking, or bypasses of WhatsApp security.

Deliverables

Generate the complete project structure, all source code, package.json, .env.example, database setup, README, installation commands, and deployment instructions.

The final project must run without missing files or placeholder functions. Test the main workflow and explain exactly how to configure the WhatsApp Channel and start the bot.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/70545025-8ba2-4a94-af57-85d8ac9a7c3c).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
