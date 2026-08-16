# Immitracker Express Entry — single-container image.
#
# Express serves both the API and the built React app, so one container is the
# whole deployment: no CORS, no second service, no second bill.
#
# The container runs as a non-root user so Chromium's sandbox can stay enabled.
# The usual shortcut is PUPPETEER_NO_SANDBOX=1, which works but removes the main
# containment if a renderer is ever compromised — worth avoiding for something
# that faces the internet.

# ---------- 1. build the frontend ----------
FROM node:22-bookworm-slim AS web
WORKDIR /build

COPY web/package*.json web/
RUN cd web && npm ci

# shared/ is imported by the React charts via the @shared alias.
COPY shared/ shared/
COPY web/ web/
RUN cd web && npm run build

# ---------- 2. server dependencies ----------
FROM node:22-bookworm-slim AS deps
WORKDIR /build

# Puppeteer downloads Chromium during install; it needs to land somewhere the
# runtime user can read, so pin the cache to a shared path.
ENV PUPPETEER_CACHE_DIR=/opt/puppeteer

# The slim image has no unzip, and Puppeteer's browser download is a zip — the
# install fails with "no zip archiver is available" without this.
RUN apt-get update && apt-get install -y --no-install-recommends unzip ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY server/package*.json ./
RUN npm ci --omit=dev

# ---------- 3. runtime ----------
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PUPPETEER_CACHE_DIR=/opt/puppeteer \
    PORT=3001

# Chromium's shared-library dependencies. Without these Puppeteer launches and
# immediately dies with an unhelpful "Target closed" — the single most common
# containerised-Puppeteer failure.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 \
      libatspi2.0-0 libcairo2 libcups2 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0 \
      libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 libxdamage1 \
      libxext6 libxfixes3 libxkbcommon0 libxrandr2 xdg-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=deps /build/node_modules ./server/node_modules
COPY --from=deps /opt/puppeteer /opt/puppeteer
COPY server/ ./server/
COPY shared/ ./shared/
COPY --from=web /build/web/dist ./web/dist

# `node` already exists in this image as uid 1000.
RUN mkdir -p /app/server/uploads && chown -R node:node /app /opt/puppeteer
USER node

EXPOSE 3001

# Railway rewrites PORT; the server reads it from the environment.
CMD ["node", "--max-old-space-size=1024", "server/src/index.js"]
