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

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

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
