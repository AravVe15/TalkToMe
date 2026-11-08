/**
 * Realtime Voice Session, Context Priming, WebRTC Connection & Transcript Contracts
 * (ADR-04, ADR-05, ADR-06, ADR-08, ADR-10 / AC-04, AC-05, AC-06, AC-08, AC-10).
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

export type TranscriptRole = "user" | "assistant";

export type TranscriptStatus =
  | "transcribing"
  | "streaming"
  | "completed"
  | "interrupted";

export interface TranscriptItem {
  id: string;
  role: TranscriptRole;
  text: string;
  status: TranscriptStatus;
  createdAt?: number;
  updatedAt?: number;
}

export type MicStatus = "available" | "unavailable";

export interface RealtimeControlsOptions {
  peerConnection?: RTCPeerConnection | null;
  dataChannel?: RTCDataChannel | null;
  localAudioTrack?: MediaStreamTrack | null;
  audioElement?: HTMLAudioElement | null;
  transcriptManager?: unknown | null;
  onMicStatusChange?: (status: MicStatus) => void;
  onMuteChange?: (isMuted: boolean) => void;
  onTextFallbackChange?: (isFallback: boolean) => void;
  onConversationStateChange?: (state: RealtimeConversationState) => void;
  sendEvent?: (event: unknown) => boolean;
}
