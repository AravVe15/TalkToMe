# Multi-Stage Production Containerfile for TalkToMe (ADR-13)
# Stage 1: Dependency Installation & Next.js Build
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Install dependencies deterministically
COPY package*.json ./
RUN npm ci

# Copy application source tree
COPY . .

# Build production Next.js bundle
RUN npm run build

# Prune development dependencies to keep final image footprint compact
RUN npm prune --omit=dev

# Stage 2: Hardened Minimal Production Runner
FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV NODE_OPTIONS="--max-old-space-size=384"

# Copy pruned node_modules (retaining pdfjs-dist assets) and build output
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/next.config.ts ./next.config.ts

# Run as non-root unprivileged node user
USER node

EXPOSE 3000

# PID-preserving exec for clean SIGTERM / SIGINT signal forwarding
CMD ["sh", "-c", "exec ./node_modules/.bin/next start -H ${HOSTNAME:-0.0.0.0} -p ${PORT:-3000}"]
