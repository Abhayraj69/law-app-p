# SLF Document Vault — production container image.
#
# The app fails fast at boot if Postgres/ClamAV/KMS aren't reachable (see
# server/server.js's start()) — that's intentional (an orchestrator should
# restart it, not silently run degraded), so `docker run` with none of
# those reachable will exit non-zero immediately, by design.
FROM node:20-slim

WORKDIR /app

# Install dependencies first so this layer is cached unless package*.json
# actually changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Vendor the Tesseract English language data at build time rather than
# letting tesseract.js download it from a public CDN on first OCR at
# runtime — that download fails outright on a network with restricted
# outbound access, and re-downloads after every restart in a container
# whose filesystem is otherwise discarded. node:20-slim has no curl by
# default, so install it in the same layer.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && mkdir -p /app/vendor/tessdata \
 && curl -fsSL -o /app/vendor/tessdata/eng.traineddata \
      https://raw.githubusercontent.com/tesseract-ocr/tessdata/main/eng.traineddata \
 && apt-get purge -y curl \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3000
ENV TESSERACT_LANG_PATH=/app/vendor/tessdata
ENV TESSERACT_CACHE_PATH=/tmp/tesseract
EXPOSE 3000

# The node:20-slim image already ships an unprivileged `node` user (uid
# 1000). Any RCE in the PDF/Office/image parsing this app does then runs
# unprivileged instead of as root. Any volume mounted at STORAGE_ROOT must
# be writable by uid 1000 — see docs/RUNBOOK.md.
RUN mkdir -p /var/lib/slf/uploads /tmp/tesseract \
 && chown -R node:node /var/lib/slf /tmp/tesseract /app
USER node

# ── Required at runtime (see .env.example for the full reference) ─────────
# Either DATABASE_URL, or the discrete PGHOST/PGDATABASE (+ typically
# PGUSER/PGPASSWORD/PGPORT) vars.
#   DATABASE_URL=postgresql://user:pass@host:5432/slf_vault
# JWT signing secret (min 32 chars):
#   JWT_SECRET=...
# AI provider selection + key:
#   AI_PROVIDER=anthropic
#   AI_PROVIDER_API_KEY=...
# Malware scanning — required unless NODE_ENV=development:
#   CLAMAV_HOST=...
#   CLAMAV_PORT=3310
# Message encryption at rest — required unless NODE_ENV=development:
#   KMS_KEY_ARN=arn:aws:kms:...
#
# None of these are baked into the image — pass them at `docker run` time
# (--env-file, -e, or your orchestrator's secret mechanism).

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 3000) + '/api/v1/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server/server.js"]
