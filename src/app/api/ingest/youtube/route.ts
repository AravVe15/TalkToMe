/**
 * POST /api/ingest/youtube Route Handler (ADR-01, ADR-03, ADR-12).
 */

import {
  parseYouTubeVideoId,
  fetchYouTubeTranscript,
  YouTubeIngestionError,
} from "@/lib/ingest/youtube";
import { ingestionCache } from "@/lib/ingest/cache";
import type { IngestionError, IngestionErrorCode, IngestionSuccess } from "@/types/ingest";

export const runtime = "nodejs";

function mapErrorCodeToStatus(code: IngestionErrorCode): number {
  switch (code) {
    case "INVALID_YOUTUBE_URL":
    case "INVALID_FILE_TYPE":
      return 400;
    case "FILE_TOO_LARGE":
      return 413;
    case "CAPTIONS_UNAVAILABLE":
    case "VIDEO_UNAVAILABLE":
    case "EMPTY_OR_SCANNED_PDF":
    case "CORRUPTED_OR_ENCRYPTED_PDF":
      return 422;
    case "YOUTUBE_CLOUD_IP_BLOCKED":
      return 503;
    case "EXTRACTION_TIMEOUT":
      return 504;
    default:
      return 500;
  }
}

export async function POST(req: Request): Promise<Response> {
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return Response.json(
      {
        ok: false,
        code: "INVALID_YOUTUBE_URL",
        message: "Unable to read request body. Please provide a valid YouTube URL.",
        retryable: false,
      } satisfies IngestionError,
      { status: 400 }
    );
  }

  if (!rawBody || !rawBody.trim()) {
    return Response.json(
      {
        ok: false,
        code: "INVALID_YOUTUBE_URL",
        message: "Request body is empty. Please provide a valid YouTube URL.",
        retryable: false,
      } satisfies IngestionError,
      { status: 400 }
    );
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return Response.json(
      {
        ok: false,
        code: "INVALID_YOUTUBE_URL",
        message: "Malformed JSON request body. Please provide a valid YouTube URL.",
        retryable: false,
      } satisfies IngestionError,
      { status: 400 }
    );
  }

  if (
    typeof parsedBody !== "object" ||
    parsedBody === null ||
    !("url" in parsedBody) ||
    typeof (parsedBody as { url: unknown }).url !== "string"
  ) {
    return Response.json(
      {
        ok: false,
        code: "INVALID_YOUTUBE_URL",
        message: "Missing or non-string 'url' field in request body.",
        retryable: false,
      } satisfies IngestionError,
      { status: 400 }
    );
  }

  const url = (parsedBody as { url: string }).url;
  const videoId = parseYouTubeVideoId(url);
  if (!videoId) {
    return Response.json(
      {
        ok: false,
        code: "INVALID_YOUTUBE_URL",
        message: "Invalid YouTube URL. Please provide a valid youtube.com or youtu.be video link.",
        retryable: false,
      } satisfies IngestionError,
      { status: 400 }
    );
  }

  const cacheKey = `youtube:${videoId}`;
  const cached = ingestionCache.get(cacheKey);
  if (cached) {
    return Response.json(cached, { status: 200 });
  }

  try {
    const transcript = await fetchYouTubeTranscript(videoId, {
      proxyUrl: process.env.YOUTUBE_PROXY_URL,
      timeoutMs: 30_000,
    });

    const text = transcript.text;
    const charCount = text.length;
    const payload: IngestionSuccess = {
      ok: true,
      sourceType: "youtube",
      title: transcript.title || `YouTube Video (${videoId})`,
      text,
      charCount,
      estimatedTokens: Math.ceil(charCount / 4),
      metadata: {
        videoId,
        language: transcript.language || "en",
      },
    };

    ingestionCache.set(cacheKey, payload);
    return Response.json(payload, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof YouTubeIngestionError) {
      const status = mapErrorCodeToStatus(err.code);
      return Response.json(
        {
          ok: false,
          code: err.code,
          message: err.message,
          retryable: err.retryable,
        } satisfies IngestionError,
        { status }
      );
    }

    return Response.json(
      {
        ok: false,
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred during YouTube transcript ingestion.",
        retryable: true,
      } satisfies IngestionError,
      { status: 500 }
    );
  }
}
