/**
 * GET /api/health Route Handler (ADR-13 / AC-13.1, AC-13.2).
 *
 * Operational health and container readiness probe.
 * Evaluates local filesystem integrity of pdfjs-dist assets and environment configuration
 * without issuing external network calls or leaking secrets.
 */

import { getDeploymentHealth } from "@/lib/deploy/config";

export const runtime = "nodejs";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json",
} as const;

export async function GET(_req?: Request): Promise<Response> {
  const health = getDeploymentHealth();
  const statusCode = health.status === "error" ? 503 : 200;

  return Response.json(health, {
    status: statusCode,
    headers: NO_STORE_HEADERS,
  });
}
