/**
 * Slice 5 / ADR-13 & AC-13 Test Suite: Production Containerization, Health Verification & Public Cloud Deployment
 *
 * Verifies acceptance criteria:
 * - AC-13.1: Health & Readiness Endpoint (`GET /api/health` and `getDeploymentHealth()`)
 * - AC-13.2: Strict Secret Redaction in Health & Diagnostics (Canary secret protection)
 * - AC-13.3: Container Port & Hostname Binding (`resolveServerPort` and `resolveBindHostname`)
 * - AC-13.4: Multi-Stage Container Specification & Build Isolation (`validateDockerfileSpec`,
 *            `validateDockerignoreSpec`, canonical Dockerfile/dockerignore/Render/Railway manifests)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  DEFAULT_SERVER_PORT,
  DEFAULT_BIND_HOSTNAME,
  REQUIRED_PDF_ENGINE_ASSETS,
  resolveServerPort,
  resolveBindHostname,
  checkPdfEngineAssets,
  getDeploymentHealth,
  getCanonicalDockerfile,
  validateDockerfileSpec,
  getCanonicalDockerignore,
  validateDockerignoreSpec,
  getCanonicalRenderManifest,
  getCanonicalRailwayManifest,
} from "@/lib/deploy/config";
import { GET, runtime } from "@/app/api/health/route";
import type { DeploymentHealthPayload } from "@/types/deploy";

function createMockPdfBaseDir(options?: { omit?: string[] }): {
  dir: string;
  cleanup: () => void;
} {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdfjs-dist-mock-"));
  const omit = new Set(options?.omit ?? []);

  // 1. legacy/build/pdf.mjs
  fs.mkdirSync(path.join(tmpDir, "legacy", "build"), { recursive: true });
  if (!omit.has("legacy/build/pdf.mjs")) {
    fs.writeFileSync(
      path.join(tmpDir, "legacy", "build", "pdf.mjs"),
      "// mock pdf.mjs"
    );
  }

  // 2. legacy/build/pdf.worker.mjs
  if (!omit.has("legacy/build/pdf.worker.mjs")) {
    fs.writeFileSync(
      path.join(tmpDir, "legacy", "build", "pdf.worker.mjs"),
      "// mock pdf.worker.mjs"
    );
  }

  // 3. standard_fonts
  if (!omit.has("standard_fonts")) {
    fs.mkdirSync(path.join(tmpDir, "standard_fonts"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "standard_fonts", "FoxiMono.pfb"),
      "mock font data"
    );
  }

  // 4. cmaps
  if (!omit.has("cmaps")) {
    fs.mkdirSync(path.join(tmpDir, "cmaps"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "cmaps", "Adobe-CNS1-0.bcmap"),
      "mock cmap data"
    );
  }

  return {
    dir: tmpDir,
    cleanup: () => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

describe("ADR-13 & AC-13: Production Containerization & Deployment Health", () => {
  let mockPdfDir: { dir: string; cleanup: () => void } | null = null;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (mockPdfDir) {
      mockPdfDir.cleanup();
      mockPdfDir = null;
    }
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe("AC-13.1: Health & Readiness Endpoint (GET /api/health & getDeploymentHealth)", () => {
    it("exports runtime = 'nodejs' on GET /api/health route", () => {
      expect(runtime).toBe("nodejs");
    });

    it("verifies REQUIRED_PDF_ENGINE_ASSETS contains the 4 essential pdfjs-dist assets", () => {
      expect(REQUIRED_PDF_ENGINE_ASSETS).toContain("legacy/build/pdf.mjs");
      expect(REQUIRED_PDF_ENGINE_ASSETS).toContain("legacy/build/pdf.worker.mjs");
      expect(REQUIRED_PDF_ENGINE_ASSETS).toContain("standard_fonts");
      expect(REQUIRED_PDF_ENGINE_ASSETS).toContain("cmaps");
    });

    it("AC-13.1: checkPdfEngineAssets returns ok: true when all 4 assets exist on disk", () => {
      mockPdfDir = createMockPdfBaseDir();
      const result = checkPdfEngineAssets(mockPdfDir.dir);

      expect(result.ok).toBe(true);
      expect(result.missingAssets).toEqual([]);
    });

    it("AC-13.1: checkPdfEngineAssets detects missing individual assets", () => {
      const assetsToTest = [
        "legacy/build/pdf.mjs",
        "legacy/build/pdf.worker.mjs",
        "standard_fonts",
        "cmaps",
      ];

      for (const asset of assetsToTest) {
        const isolatedMock = createMockPdfBaseDir({ omit: [asset] });
        try {
          const result = checkPdfEngineAssets(isolatedMock.dir);
          expect(result.ok).toBe(false);
          expect(result.missingAssets).toContain(asset);
        } finally {
          isolatedMock.cleanup();
        }
      }
    });

    it("AC-13.1: getDeploymentHealth returns status: 'ok' when OPENAI_API_KEY is configured and PDF engine assets are intact", () => {
      mockPdfDir = createMockPdfBaseDir();

      const health = getDeploymentHealth({
        env: { OPENAI_API_KEY: "sk-proj-test-sample-key" },
        pdfBaseDir: mockPdfDir.dir,
        uptimeSeconds: 120,
        timestamp: "2026-11-08T12:00:00.000Z",
      });

      expect(health.ok).toBe(true);
      expect(health.status).toBe("ok");
      expect(health.checks.pdfEngine).toBe("ok");
      expect(health.checks.openaiConfigured).toBe(true);
      expect(health.checks.youtubeProxyConfigured).toBe(false);
      expect(health.limits.maxPdfSizeBytes).toBe(26_214_400);
      expect(health.limits.maxRealtimeContextChars).toBe(48_000);
      expect(health.uptimeSeconds).toBe(120);
      expect(health.timestamp).toBe("2026-11-08T12:00:00.000Z");
      expect(health.missingAssets).toBeUndefined();
    });

    it("AC-13.1: getDeploymentHealth returns status: 'degraded' (HTTP 200) when OPENAI_API_KEY is missing or whitespace", () => {
      mockPdfDir = createMockPdfBaseDir();

      // Test with completely unset OPENAI_API_KEY
      const healthUnset = getDeploymentHealth({
        env: {},
        pdfBaseDir: mockPdfDir.dir,
      });
      expect(healthUnset.ok).toBe(true);
      expect(healthUnset.status).toBe("degraded");
      expect(healthUnset.checks.pdfEngine).toBe("ok");
      expect(healthUnset.checks.openaiConfigured).toBe(false);

      // Test with whitespace-only OPENAI_API_KEY
      const healthWhitespace = getDeploymentHealth({
        env: { OPENAI_API_KEY: "   \t  \n  " },
        pdfBaseDir: mockPdfDir.dir,
      });
      expect(healthWhitespace.ok).toBe(true);
      expect(healthWhitespace.status).toBe("degraded");
      expect(healthWhitespace.checks.openaiConfigured).toBe(false);
    });

    it("AC-13.1: getDeploymentHealth returns status: 'error' and missingAssets when any PDF engine asset is missing", () => {
      mockPdfDir = createMockPdfBaseDir({
        omit: ["legacy/build/pdf.worker.mjs", "cmaps"],
      });

      const health = getDeploymentHealth({
        env: { OPENAI_API_KEY: "sk-proj-test-sample-key" },
        pdfBaseDir: mockPdfDir.dir,
      });

      expect(health.ok).toBe(false);
      expect(health.status).toBe("error");
      expect(health.checks.pdfEngine).toBe("missing");
      expect(health.missingAssets).toEqual(
        expect.arrayContaining(["legacy/build/pdf.worker.mjs", "cmaps"])
      );
    });

    it("AC-13.1: GET /api/health returns HTTP 200 with status: 'ok' and Cache-Control: no-store when fully healthy", async () => {
      mockPdfDir = createMockPdfBaseDir();
      process.env.OPENAI_API_KEY = "sk-proj-live-test-key";
      process.env.PDFJS_BASE_DIR = mockPdfDir.dir;

      const response = await GET();
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");

      const body: DeploymentHealthPayload = await response.json();
      expect(body.ok).toBe(true);
      expect(body.status).toBe("ok");
      expect(body.checks.pdfEngine).toBe("ok");
      expect(body.checks.openaiConfigured).toBe(true);
      expect(body.limits.maxPdfSizeBytes).toBe(26_214_400);
      expect(body.limits.maxRealtimeContextChars).toBe(48_000);
    });

    it("AC-13.1: GET /api/health returns HTTP 200 with status: 'degraded' when OPENAI_API_KEY is not set", async () => {
      mockPdfDir = createMockPdfBaseDir();
      delete process.env.OPENAI_API_KEY;
      process.env.PDFJS_BASE_DIR = mockPdfDir.dir;

      const response = await GET();
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");

      const body: DeploymentHealthPayload = await response.json();
      expect(body.ok).toBe(true);
      expect(body.status).toBe("degraded");
      expect(body.checks.openaiConfigured).toBe(false);
      expect(body.checks.pdfEngine).toBe("ok");
    });

    it("AC-13.1: GET /api/health returns HTTP 503 with status: 'error' when required pdfjs-dist assets are missing", async () => {
      mockPdfDir = createMockPdfBaseDir({
        omit: ["legacy/build/pdf.mjs"],
      });
      process.env.OPENAI_API_KEY = "sk-proj-live-test-key";
      process.env.PDFJS_BASE_DIR = mockPdfDir.dir;

      const response = await GET();
      expect(response.status).toBe(503);
      expect(response.headers.get("Cache-Control")).toBe("no-store");

      const body: DeploymentHealthPayload = await response.json();
      expect(body.ok).toBe(false);
      expect(body.status).toBe("error");
      expect(body.checks.pdfEngine).toBe("missing");
      expect(body.missingAssets).toContain("legacy/build/pdf.mjs");
    });
  });

  describe("AC-13.2: Strict Secret Redaction in Health & Diagnostics", () => {
    it("AC-13.2: getDeploymentHealth strictly redacts raw secrets and credentials from JSON output", () => {
      mockPdfDir = createMockPdfBaseDir();

      const canarySecretKey = "sk-proj-canary-secret-99999-never-leak-this";
      const canaryProxySecret = "http://admin:superSecretPass123@proxy.example.com:8080";

      const health = getDeploymentHealth({
        env: {
          OPENAI_API_KEY: canarySecretKey,
          YOUTUBE_PROXY_URL: canaryProxySecret,
        },
        pdfBaseDir: mockPdfDir.dir,
      });

      const serialized = JSON.stringify(health);

      // 1. Canary OpenAI API Key must never appear as value, substring, or prefix
      expect(serialized).not.toContain(canarySecretKey);
      expect(serialized).not.toContain("canary-secret-99999");
      expect(serialized).not.toContain("never-leak-this");

      // 2. Canary YouTube Proxy credentials and URL must never appear
      expect(serialized).not.toContain(canaryProxySecret);
      expect(serialized).not.toContain("superSecretPass123");
      expect(serialized).not.toContain("proxy.example.com");

      // 3. Checks must expose strictly boolean flags
      expect(health.checks.openaiConfigured).toBe(true);
      expect(health.checks.youtubeProxyConfigured).toBe(true);
      expect(typeof health.checks.openaiConfigured).toBe("boolean");
      expect(typeof health.checks.youtubeProxyConfigured).toBe("boolean");
    });

    it("AC-13.2: GET /api/health never leaks canary credentials across response body or HTTP headers", async () => {
      mockPdfDir = createMockPdfBaseDir();

      const canarySecretKey = "sk-proj-canary-secret-99999";
      const canaryProxyUrl = "http://user:pass@proxy.example.com:8080";

      process.env.OPENAI_API_KEY = canarySecretKey;
      process.env.YOUTUBE_PROXY_URL = canaryProxyUrl;
      process.env.PDFJS_BASE_DIR = mockPdfDir.dir;

      const response = await GET();
      const rawBody = await response.text();

      // Verify response body
      expect(rawBody).not.toContain(canarySecretKey);
      expect(rawBody).not.toContain("canary-secret-99999");
      expect(rawBody).not.toContain(canaryProxyUrl);
      expect(rawBody).not.toContain("user:pass");
      expect(rawBody).not.toContain("proxy.example.com");

      // Verify response headers
      response.headers.forEach((headerValue, headerName) => {
        expect(headerName.toLowerCase()).not.toContain("canary");
        expect(headerValue).not.toContain(canarySecretKey);
        expect(headerValue).not.toContain("canary-secret-99999");
        expect(headerValue).not.toContain(canaryProxyUrl);
        expect(headerValue).not.toContain("user:pass");
      });
    });
  });

  describe("AC-13.3: Container Port & Hostname Binding (resolveServerPort & resolveBindHostname)", () => {
    it("AC-13.3: resolveServerPort parses dynamic integer ports injected by cloud container hosts", () => {
      expect(resolveServerPort({ PORT: "10000" })).toBe(10000); // Render default
      expect(resolveServerPort({ PORT: "8080" })).toBe(8080);   // Railway / Cloud default
      expect(resolveServerPort({ PORT: "5000" })).toBe(5000);
      expect(resolveServerPort({ PORT: "1" })).toBe(1);
      expect(resolveServerPort({ PORT: "65535" })).toBe(65535);
    });

    it("AC-13.3: resolveServerPort falls back to DEFAULT_SERVER_PORT (3000) on invalid or missing PORT", () => {
      expect(DEFAULT_SERVER_PORT).toBe(3000);

      // Unset or empty
      expect(resolveServerPort({})).toBe(3000);
      expect(resolveServerPort({ PORT: "" })).toBe(3000);
      expect(resolveServerPort({ PORT: "   " })).toBe(3000);

      // Zero or negative
      expect(resolveServerPort({ PORT: "0" })).toBe(3000);
      expect(resolveServerPort({ PORT: "-1" })).toBe(3000);
      expect(resolveServerPort({ PORT: "-8080" })).toBe(3000);

      // Out of range (> 65535)
      expect(resolveServerPort({ PORT: "70000" })).toBe(3000);
      expect(resolveServerPort({ PORT: "65536" })).toBe(3000);
      expect(resolveServerPort({ PORT: "999999" })).toBe(3000);

      // Non-numeric or float
      expect(resolveServerPort({ PORT: "abc" })).toBe(3000);
      expect(resolveServerPort({ PORT: "3000abc" })).toBe(3000);
      expect(resolveServerPort({ PORT: "3000.5" })).toBe(3000);
      expect(resolveServerPort({ PORT: "null" })).toBe(3000);
      expect(resolveServerPort({ PORT: "undefined" })).toBe(3000);
    });

    it("AC-13.3: resolveBindHostname defaults to '0.0.0.0' for container ingress routing", () => {
      expect(DEFAULT_BIND_HOSTNAME).toBe("0.0.0.0");

      expect(resolveBindHostname({})).toBe("0.0.0.0");
      expect(resolveBindHostname({ HOSTNAME: "" })).toBe("0.0.0.0");
      expect(resolveBindHostname({ HOSTNAME: "   " })).toBe("0.0.0.0");
      expect(resolveBindHostname({ HOSTNAME: "0.0.0.0" })).toBe("0.0.0.0");
      expect(resolveBindHostname({ HOSTNAME: "  0.0.0.0  " })).toBe("0.0.0.0");
    });

    it("AC-13.3: resolveBindHostname honors custom hostname overrides", () => {
      expect(resolveBindHostname({ HOSTNAME: "127.0.0.1" })).toBe("127.0.0.1");
      expect(resolveBindHostname({ HOSTNAME: "localhost" })).toBe("localhost");
      expect(resolveBindHostname({ HOSTNAME: "::" })).toBe("::");
    });
  });

  describe("AC-13.4: Multi-Stage Container Specification & Build Isolation", () => {
    it("AC-13.4: getCanonicalDockerfile returns a valid multi-stage Dockerfile satisfying validateDockerfileSpec", () => {
      const dockerfile = getCanonicalDockerfile();
      expect(typeof dockerfile).toBe("string");
      expect(dockerfile.length).toBeGreaterThan(100);

      const validation = validateDockerfileSpec(dockerfile);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toEqual([]);

      // Verify mandatory architectural directives
      expect(dockerfile).toContain("FROM node:20-bookworm-slim");
      expect(dockerfile).toContain("npm ci");
      expect(dockerfile).toContain("npm run build");
      expect(dockerfile).toContain("npm prune --omit=dev");
      expect(dockerfile).toContain('NODE_OPTIONS="--max-old-space-size=384"');
      expect(dockerfile).toContain("NODE_ENV=production");
      expect(dockerfile).toContain("USER node");
      expect(dockerfile).toContain("0.0.0.0");
      expect(dockerfile).toContain("${PORT:-3000}");
      expect(dockerfile).toContain("exec");
    });

    it("AC-13.4: validateDockerfileSpec rejects insecure or malformed Dockerfiles", () => {
      // 1. Rejects hardcoded OPENAI_API_KEY
      const leakKey = `
FROM node:20-bookworm-slim AS builder
ENV OPENAI_API_KEY=sk-proj-hardcoded-secret-key
RUN npm ci && npm run build
`;
      const resKey = validateDockerfileSpec(leakKey);
      expect(resKey.valid).toBe(false);
      expect(resKey.errors.some((e) => /OPENAI_API_KEY/i.test(e))).toBe(true);

      // 2. Rejects copying local .env into image
      const copyEnv = `
FROM node:20-bookworm-slim
COPY .env .
USER node
CMD ["npm", "start"]
`;
      const resEnv = validateDockerfileSpec(copyEnv);
      expect(resEnv.valid).toBe(false);
      expect(resEnv.errors.some((e) => /\.env/i.test(e))).toBe(true);

      // 3. Rejects missing multi-stage build
      const singleStage = `
FROM node:20-bookworm-slim
WORKDIR /app
COPY . .
RUN npm install && npm run build
USER node
CMD ["npm", "start"]
`;
      const resStage = validateDockerfileSpec(singleStage);
      expect(resStage.valid).toBe(false);
      expect(resStage.errors.some((e) => /multi-stage/i.test(e))).toBe(true);

      // 4. Rejects running as root (missing USER node)
      const rootUser = `
FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:20-bookworm-slim AS runner
WORKDIR /app
COPY --from=builder /app ./
ENV NODE_OPTIONS="--max-old-space-size=384"
CMD ["npm", "start"]
`;
      const resRoot = validateDockerfileSpec(rootUser);
      expect(resRoot.valid).toBe(false);
      expect(resRoot.errors.some((e) => /USER node/i.test(e))).toBe(true);

      // 5. Rejects missing npm prune --omit=dev
      const noPrune = `
FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
COPY --from=builder /app ./
USER node
ENV NODE_OPTIONS="--max-old-space-size=384"
CMD ["npm", "start"]
`;
      const resPrune = validateDockerfileSpec(noPrune);
      expect(resPrune.valid).toBe(false);
      expect(resPrune.errors.some((e) => /prune/i.test(e))).toBe(true);
    });

    it("AC-13.4: getCanonicalDockerignore returns specification satisfying validateDockerignoreSpec", () => {
      const dockerignore = getCanonicalDockerignore();
      expect(typeof dockerignore).toBe("string");

      const validation = validateDockerignoreSpec(dockerignore);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toEqual([]);

      // Verify mandatory exclusions
      expect(dockerignore).toMatch(/\.env(\*|\.|\b)/);
      expect(dockerignore).toContain("node_modules");
      expect(dockerignore).toContain(".next");
      expect(dockerignore).toContain(".git");
      expect(dockerignore).toContain("tests");
    });

    it("AC-13.4: validateDockerignoreSpec rejects dockerignore files missing critical secret or artifact exclusions", () => {
      // Missing .env exclusion
      const missingEnv = `
node_modules
.next
.git
`;
      const resEnv = validateDockerignoreSpec(missingEnv);
      expect(resEnv.valid).toBe(false);
      expect(resEnv.errors.some((e) => /\.env/i.test(e))).toBe(true);

      // Missing node_modules exclusion
      const missingModules = `
.env
.env.*
.next
.git
`;
      const resModules = validateDockerignoreSpec(missingModules);
      expect(resModules.valid).toBe(false);
      expect(resModules.errors.some((e) => /node_modules/i.test(e))).toBe(true);

      // Missing .next exclusion
      const missingNext = `
.env
.env.*
node_modules
.git
`;
      const resNext = validateDockerignoreSpec(missingNext);
      expect(resNext.valid).toBe(false);
      expect(resNext.errors.some((e) => /\.next/i.test(e))).toBe(true);
    });

    it("AC-13.4: getCanonicalRenderManifest and getCanonicalRailwayManifest reference /api/health probe", () => {
      const renderYaml = getCanonicalRenderManifest();
      expect(typeof renderYaml).toBe("string");
      expect(renderYaml).toContain("healthCheckPath: /api/health");
      expect(renderYaml).toMatch(/env:\s*docker/i);

      const railwayJson = getCanonicalRailwayManifest();
      expect(typeof railwayJson).toBe("string");
      expect(railwayJson).toContain("/api/health");
    });
  });
});
