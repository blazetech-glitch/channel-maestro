FROM node:20-bookworm-slim

# better-sqlite3 needs a toolchain when no prebuilt binary matches.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .

ENV NODE_ENV=production
ENV PORT=3000
# Mount a volume here to keep the database, uploads and WhatsApp session.
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["node", "src/server.js"]
