/**
 * Deployment & Health Verification Types (ADR-13 / AC-13).
 */

export type HealthStatus = "ok" | "degraded" | "error";

export interface DeploymentChecks {
  pdfEngine: "ok" | "missing";
  openaiConfigured: boolean;
  youtubeProxyConfigured: boolean;
}

export interface DeploymentLimits {
  maxPdfSizeBytes: number;
  maxRealtimeContextChars: number;
}

export interface DeploymentHealthPayload {
  ok: boolean;
  status: HealthStatus;
  timestamp: string;
  uptimeSeconds: number;
  environment: string;
  checks: DeploymentChecks;
  limits: DeploymentLimits;
  missingAssets?: string[];
}

export interface DeploymentConfig {
  port: number;
  hostname: string;
  pdfBaseDir: string;
  maxPdfSizeBytes: number;
  maxRealtimeContextChars: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}
