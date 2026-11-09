/**
 * Production Deployment & Health Verification Logic (ADR-13 / AC-13).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type {
  DeploymentConfig,
  DeploymentHealthPayload,
  ValidationResult,
} from "@/types/deploy";

export const DEFAULT_SERVER_PORT = 3000;
export const DEFAULT_BIND_HOSTNAME = "0.0.0.0";

export const REQUIRED_PDF_ENGINE_ASSETS = [
  "legacy/build/pdf.mjs",
  "legacy/build/pdf.worker.mjs",
  "standard_fonts",
  "cmaps",
] as const;

export function resolveServerPort(
  env?: Record<string, string | undefined>
): number {
  const raw = env !== undefined ? env.PORT : process.env.PORT;
  if (typeof raw !== "string") {
    return DEFAULT_SERVER_PORT;
  }
  const trimmed = raw.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) {
    return DEFAULT_SERVER_PORT;
  }
  const port = parseInt(trimmed, 10);
  if (port < 1 || port > 65535) {
    return DEFAULT_SERVER_PORT;
  }
  return port;
}

export function resolveBindHostname(
  env?: Record<string, string | undefined>
): string {
  const raw = env !== undefined ? env.HOSTNAME : process.env.HOSTNAME;
  if (typeof raw !== "string") {
    return DEFAULT_BIND_HOSTNAME;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return DEFAULT_BIND_HOSTNAME;
  }
  return trimmed;
}

export function checkPdfEngineAssets(baseDir?: string): {
  ok: boolean;
  missingAssets: string[];
} {
  const resolvedBaseDir =
    baseDir ??
    process.env.PDFJS_BASE_DIR ??
    path.join(process.cwd(), "node_modules", "pdfjs-dist");

  const missingAssets: string[] = [];
  for (const asset of REQUIRED_PDF_ENGINE_ASSETS) {
    const fullPath = path.join(resolvedBaseDir, asset);
    if (!fs.existsSync(fullPath)) {
      missingAssets.push(asset);
    }
  }

  return {
    ok: missingAssets.length === 0,
    missingAssets,
  };
}

export function getDeploymentHealth(options?: {
  env?: Record<string, string | undefined>;
  pdfBaseDir?: string;
  uptimeSeconds?: number;
  timestamp?: string;
}): DeploymentHealthPayload {
  const env = options?.env ?? process.env;
  const pdfBaseDir = options?.pdfBaseDir;
  const uptimeSeconds =
    options?.uptimeSeconds !== undefined
      ? options?.uptimeSeconds
      : Math.floor(process.uptime());
  const timestamp = options?.timestamp ?? new Date().toISOString();
  const environment = (env.NODE_ENV && env.NODE_ENV.trim()) || "development";

  const openaiConfigured =
    typeof env.OPENAI_API_KEY === "string" &&
    env.OPENAI_API_KEY.trim().length > 0;

  const youtubeProxyConfigured =
    typeof env.YOUTUBE_PROXY_URL === "string" &&
    env.YOUTUBE_PROXY_URL.trim().length > 0;

  const pdfCheck = checkPdfEngineAssets(pdfBaseDir);

  let status: "ok" | "degraded" | "error";
  let ok: boolean;

  if (!pdfCheck.ok) {
    status = "error";
    ok = false;
  } else if (!openaiConfigured) {
    status = "degraded";
    ok = true;
  } else {
    status = "ok";
    ok = true;
  }

  const payload: DeploymentHealthPayload = {
    ok,
    status,
    timestamp,
    uptimeSeconds,
    environment,
    checks: {
      pdfEngine: pdfCheck.ok ? "ok" : "missing",
      openaiConfigured,
      youtubeProxyConfigured,
    },
    limits: {
      maxPdfSizeBytes: 26_214_400,
      maxRealtimeContextChars: 48_000,
    },
  };

  if (!pdfCheck.ok) {
    payload.missingAssets = pdfCheck.missingAssets;
  }

  return payload;
}

export function getCanonicalDockerfile(): string {
  return `# Multi-Stage Production Containerfile for TalkToMe (ADR-13)
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
CMD ["sh", "-c", "exec ./node_modules/.bin/next start -H \${HOSTNAME:-0.0.0.0} -p \${PORT:-3000}"]
`;
}

export function validateDockerfileSpec(content: string): ValidationResult {
  const errors: string[] = [];

  if (/OPENAI_API_KEY/i.test(content)) {
    errors.push(
      "Dockerfile must not contain hardcoded OPENAI_API_KEY secrets or environment variables."
    );
  }

  if (/COPY\s+.*?\.env/i.test(content) || /ADD\s+.*?\.env/i.test(content)) {
    errors.push("Dockerfile must not copy .env files into container layers.");
  }

  const fromMatches = content.match(/^\s*FROM\s+/gim);
  if (!fromMatches || fromMatches.length < 2 || !/AS\s+builder/i.test(content)) {
    errors.push(
      "Dockerfile must use a multi-stage build architecture with builder and runner stages."
    );
  }

  if (!/USER\s+node\b/.test(content)) {
    errors.push("Dockerfile must specify USER node to drop root privileges.");
  }

  if (!/npm\s+prune\s+--omit=dev/.test(content)) {
    errors.push(
      "Dockerfile must execute npm prune --omit=dev to strip dev dependencies."
    );
  }

  if (!/FROM\s+node:20-bookworm-slim/i.test(content)) {
    errors.push(
      "Dockerfile must standardize on node:20-bookworm-slim base image."
    );
  }

  if (!/npm\s+ci\b/.test(content)) {
    errors.push(
      "Dockerfile must execute npm ci for deterministic dependency installation."
    );
  }

  if (!/npm\s+run\s+build\b/.test(content)) {
    errors.push(
      "Dockerfile must execute npm run build to produce Next.js artifacts."
    );
  }

  if (!/NODE_OPTIONS="--max-old-space-size=384"/.test(content)) {
    errors.push(
      'Dockerfile must configure NODE_OPTIONS="--max-old-space-size=384" for memory bounded execution.'
    );
  }

  if (!/NODE_ENV=production/.test(content)) {
    errors.push("Dockerfile must configure NODE_ENV=production in runner stage.");
  }

  if (!/0\.0\.0\.0/.test(content)) {
    errors.push("Dockerfile must bind to 0.0.0.0 hostname.");
  }

  if (!/\$\{PORT:-3000\}/.test(content)) {
    errors.push("Dockerfile must support dynamic ${PORT:-3000} port binding.");
  }

  if (!/\bexec\b/.test(content)) {
    errors.push("Dockerfile CMD must use exec for clean signal forwarding.");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function getCanonicalDockerignore(): string {
  return `# TalkToMe Container Build Exclusions (ADR-13 / AC-13.4)
.env
.env.*
node_modules
.next
.git
tests
coverage
docs/memory
*.log
`;
}

export function validateDockerignoreSpec(content: string): ValidationResult {
  const errors: string[] = [];

  if (!/\.env/i.test(content)) {
    errors.push(
      ".dockerignore must explicitly exclude .env and .env.* secret files."
    );
  }

  if (!/node_modules/i.test(content)) {
    errors.push(".dockerignore must exclude node_modules directory.");
  }

  if (!/\.next/i.test(content)) {
    errors.push(".dockerignore must exclude .next build cache directory.");
  }

  if (!/\.git/i.test(content)) {
    errors.push(".dockerignore must exclude .git version control directory.");
  }

  if (!/tests/i.test(content)) {
    errors.push(".dockerignore must exclude tests directory.");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function getCanonicalRenderManifest(): string {
  return `services:
  - type: web
    name: talktome
    runtime: docker
    env: docker
    plan: free
    region: oregon
    healthCheckPath: /api/health
    envVars:
      - key: NODE_ENV
        value: production
      - key: OPENAI_API_KEY
        sync: false
      - key: YOUTUBE_PROXY_URL
        sync: false
`;
}

export function getCanonicalRailwayManifest(): string {
  return `{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "healthcheckPath": "/api/health",
    "healthcheckTimeout": 100,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
`;
}
