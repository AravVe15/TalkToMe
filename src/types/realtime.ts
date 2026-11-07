/**
 * Realtime Voice Session & Context Priming Contracts (ADR-04, ADR-05, ADR-10 / AC-04, AC-05, AC-10).
 */

export interface RealtimeSessionSuccess {
  ok: true;
  ephemeralKey: string;
  expiresAt: number;
  model: string;
  isContextTruncated?: boolean;
}

export type RealtimeSessionErrorCode =
  | "SERVER_MISCONFIGURED"
  | "INVALID_REQUEST"
  | "UPSTREAM_ERROR"
  | "UPSTREAM_TIMEOUT";

export interface RealtimeSessionError {
  ok: false;
  code: RealtimeSessionErrorCode | string;
  message: string;
  retryable?: boolean;
}

export type RealtimeSessionResult =
  | RealtimeSessionSuccess
  | RealtimeSessionError;

export interface RealtimeSessionRequestBody {
  text?: string;
  title?: string;
  sourceType?: "pdf" | "youtube" | string;
  voice?: string;
}
