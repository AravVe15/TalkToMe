/**
 * Unified Ingestion Contract & Source State Model (ADR-01 / AC-01).
 *
 * Both POST /api/ingest/pdf and POST /api/ingest/youtube return this discriminated
 * union response. Full extracted text is never truncated at ingestion (Option 2B).
 */

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
