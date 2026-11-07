/**
 * Realtime Voice Session, Context Priming & WebRTC Connection Contracts
 * (ADR-04, ADR-05, ADR-06, ADR-10 / AC-04, AC-05, AC-06, AC-10).
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

export type RealtimeConnectionState =
  | "idle"
  | "ingesting"
  | "ready"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

export type RealtimeConversationState =
  | "listening"
  | "user_speaking"
  | "assistant_thinking"
  | "assistant_speaking";

export interface RealtimeConnectionOptions {
  audioElement?: HTMLAudioElement | null;
  onStateChange?: (state: RealtimeConnectionState) => void;
  onConversationStateChange?: (state: RealtimeConversationState) => void;
  onError?: (error: Error | string) => void;
  onEvent?: (event: unknown) => void;
  fetchToken?: () => Promise<{ ephemeralKey: string; model?: string }>;
  reconnectTimeoutMs?: number;
}

export interface RealtimeSessionResources {
  peerConnection?: RTCPeerConnection | null;
  dataChannel?: RTCDataChannel | null;
  localStream?: MediaStream | null;
  audioElement?: HTMLAudioElement | null;
}
