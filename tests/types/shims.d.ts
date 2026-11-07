/**
 * Ambient type definitions declaring the expected exports from src/ for Slice 1 (Ingestion Engine).
 * Authored strictly according to docs/memory/requirements.md (AC-01, AC-02, AC-03, AC-12)
 * and docs/memory/decisions.md (ADR-01, ADR-02, ADR-03, ADR-12).
 */

declare module "@/types/ingest" {
  export type IngestionSuccess = {
    ok: true;
    sourceType: "pdf" | "youtube";
    title: string;
    text: string;
    charCount: number;
    estimatedTokens: number;
    metadata: {
      pageCount?: number;
      videoId?: string;
      language?: string;
    };
  };

  export type IngestionErrorCode =
    | "INVALID_FILE_TYPE"
    | "FILE_TOO_LARGE"
    | "EMPTY_OR_SCANNED_PDF"
    | "CORRUPTED_OR_ENCRYPTED_PDF"
    | "INVALID_YOUTUBE_URL"
    | "VIDEO_UNAVAILABLE"
    | "CAPTIONS_UNAVAILABLE"
    | "YOUTUBE_CLOUD_IP_BLOCKED"
    | "EXTRACTION_TIMEOUT"
    | "INTERNAL_ERROR";

  export type IngestionError = {
    ok: false;
    code: IngestionErrorCode;
    message: string;
    retryable: boolean;
  };

  export type IngestionResult = IngestionSuccess | IngestionError;
}

declare module "@/lib/ingest/youtube" {
  import type { IngestionErrorCode } from "@/types/ingest";

  export function parseYouTubeVideoId(url: string | null | undefined): string | null;

  export function decodeHtmlEntities(rawText: string): string;

  export function cleanTranscriptText(rawXmlOrText: string): string;

  export type TranscriptFetchResult = {
    text: string;
    language: string;
    title: string;
  };

  export class YouTubeIngestionError extends Error {
    code: IngestionErrorCode;
    retryable: boolean;
    constructor(code: IngestionErrorCode, message: string, retryable?: boolean);
  }

  export function fetchYouTubeTranscript(
    videoId: string,
    options?: { proxyUrl?: string; timeoutMs?: number }
  ): Promise<TranscriptFetchResult>;
}

declare module "@/lib/ingest/pdf" {
  import type { IngestionErrorCode } from "@/types/ingest";

  export const MAX_PDF_SIZE_BYTES = 26_214_400; // 25 MB
  export const MIN_PDF_TEXT_CHARS = 20;

  export type PdfValidationSuccess = { valid: true };
  export type PdfValidationFailure = {
    valid: false;
    code: IngestionErrorCode;
    message: string;
    status: number;
    retryable: boolean;
  };
  export type PdfValidationResult = PdfValidationSuccess | PdfValidationFailure;

  export function validatePdfBuffer(buffer: Uint8Array): PdfValidationResult;

  export class PdfIngestionError extends Error {
    code: IngestionErrorCode;
    status: number;
    retryable: boolean;
    constructor(code: IngestionErrorCode, message: string, status?: number, retryable?: boolean);
  }

  export type PdfExtractionResult = {
    text: string;
    pageCount: number;
  };

  export function extractPdfText(buffer: Uint8Array): Promise<PdfExtractionResult>;
}

declare module "@/lib/ingest/cache" {
  import type { IngestionSuccess } from "@/types/ingest";

  export interface IngestionCacheOptions {
    maxEntries?: number;
    ttlMs?: number;
  }

  export class IngestionCache<T = IngestionSuccess> {
    constructor(options?: IngestionCacheOptions);
    get(key: string): T | undefined;
    set(key: string, value: T): void;
    has(key: string): boolean;
    delete(key: string): boolean;
    clear(): void;
    get size(): number;
  }

  export const ingestionCache: IngestionCache<IngestionSuccess>;

  export function computeSha256(buffer: Uint8Array): Promise<string>;
}

declare module "@/app/api/ingest/youtube/route" {
  export function POST(req: Request): Promise<Response>;
}

declare module "@/app/api/ingest/pdf/route" {
  export function POST(req: Request): Promise<Response>;
}

declare module "@/types/realtime" {
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

  export type RealtimeSessionResult = RealtimeSessionSuccess | RealtimeSessionError;

  export interface RealtimeSessionRequestBody {
    text?: string;
    title?: string;
    sourceType?: "pdf" | "youtube" | string;
    voice?: string;
  }

  export type TranscriptRole = "user" | "assistant";
  export type TranscriptStatus = "transcribing" | "streaming" | "completed" | "interrupted";

  export interface TranscriptItem {
    id: string;
    role: TranscriptRole;
    text: string;
    status: TranscriptStatus;
    createdAt?: number;
    updatedAt?: number;
  }
}

declare module "@/lib/realtime/context" {
  export const MAX_REALTIME_CONTEXT_CHARS: number;

  export interface PreparedContext {
    instructions: string;
    isContextTruncated: boolean;
    charCount: number;
  }

  export function buildSessionInstructions(params: {
    text: string;
    title?: string;
    sourceType?: "pdf" | "youtube" | string;
  }): PreparedContext | string;
}

declare module "@/app/api/realtime/session/route" {
  export const runtime: string;
  export function POST(req: Request): Promise<Response>;
}

declare module "@/lib/realtime/connection" {
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

  export function cleanupSession(resources: RealtimeSessionResources): void;

  export class RealtimeConnectionManager {
    state: RealtimeConnectionState;
    conversationState: RealtimeConversationState;
    peerConnection: RTCPeerConnection | null;
    dataChannel: RTCDataChannel | null;
    localStream: MediaStream | null;
    audioElement: HTMLAudioElement | null;

    constructor(options?: RealtimeConnectionOptions);
    connect(params?: { ephemeralKey?: string; model?: string }): Promise<void>;
    disconnect(): void;
    cleanup(): void;
    sendEvent(event: unknown): boolean;
    setState(state: RealtimeConnectionState): void;
    setConversationState(state: RealtimeConversationState): void;
    canStartVoiceChat(): boolean;
  }

  export { RealtimeConnectionManager as RealtimeConnection };
}

declare module "@/lib/realtime/transcript" {
  import type { TranscriptItem, TranscriptRole, TranscriptStatus } from "@/types/realtime";
  import type { RealtimeConversationState } from "@/lib/realtime/connection";

  export type { TranscriptItem, TranscriptRole, TranscriptStatus };

  export interface TranscriptManagerOptions {
    onTranscriptChange?: (items: TranscriptItem[]) => void;
    onConversationStateChange?: (state: RealtimeConversationState) => void;
    initialItems?: TranscriptItem[];
  }

  export class TranscriptManager {
    items: TranscriptItem[];
    conversationState: RealtimeConversationState;

    constructor(options?: TranscriptManagerOptions);

    handleEvent(event: unknown | string): void;
    getItems(): TranscriptItem[];
    clear(): void;
  }

  export function reduceTranscriptEvent(
    items: TranscriptItem[],
    event: unknown
  ): TranscriptItem[];
}
