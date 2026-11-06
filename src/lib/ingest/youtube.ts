/**
 * Server-Side YouTube Transcript Extraction & Cloud IP Block Mitigation (ADR-03 / AC-03).
 */

import type { IngestionErrorCode } from "@/types/ingest";

export type TranscriptFetchResult = {
  text: string;
  language: string;
  title: string;
};

export class YouTubeIngestionError extends Error {
  code: IngestionErrorCode;
  retryable: boolean;

  constructor(code: IngestionErrorCode, message: string, retryable: boolean = false) {
    super(message);
    this.name = "YouTubeIngestionError";
    this.code = code;
    this.retryable = retryable;
  }
}

const VALID_VIDEO_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;

const ALLOWED_YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
]);

/**
 * Extracts the 11-character YouTube videoId from standard watch, short, shorts,
 * embed, live, and mobile URLs. Returns null for any invalid or non-YouTube URL.
 */
export function parseYouTubeVideoId(url: string | null | undefined): string | null {
  if (typeof url !== "string") {
    return null;
  }

  const trimmed = url.trim();
  if (!trimmed) {
    return null;
  }

  const normalizedUrl = trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;

  let parsed: URL;
  try {
    parsed = new URL(normalizedUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!ALLOWED_YOUTUBE_HOSTS.has(hostname)) {
    return null;
  }

  let candidateId: string | null = null;

  if (hostname === "youtu.be") {
    const segments = parsed.pathname.split("/").filter(Boolean);
    candidateId = segments[0] ?? null;
  } else {
    const pathname = parsed.pathname;
    if (pathname === "/watch") {
      candidateId = parsed.searchParams.get("v");
    } else if (
      pathname.startsWith("/shorts/") ||
      pathname.startsWith("/embed/") ||
      pathname.startsWith("/live/") ||
      pathname.startsWith("/v/")
    ) {
      const segments = pathname.split("/").filter(Boolean);
      candidateId = segments[1] ?? null;
    }
  }

  if (!candidateId || !VALID_VIDEO_ID_REGEX.test(candidateId)) {
    return null;
  }

  return candidateId;
}

const NAMED_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#39;": "'",
  "&#039;": "'",
  "&nbsp;": " ",
};

/**
 * Decodes HTML entities (&amp;, &#39;, &quot;, &lt;, &gt;, &apos;, numeric decimal/hex).
 */
export function decodeHtmlEntities(rawText: string): string {
  if (!rawText) {
    return "";
  }

  const decodePass = (input: string): string =>
    input
      .replace(/&(amp|lt|gt|quot|apos|nbsp|#39|#039);/gi, (match) => {
        const lower = match.toLowerCase();
        return NAMED_ENTITIES[lower] ?? match;
      })
      .replace(/&#(\d+);/g, (_match, dec: string) => {
        const codePoint = Number.parseInt(dec, 10);
        return Number.isNaN(codePoint) ? _match : String.fromCodePoint(codePoint);
      })
      .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex: string) => {
        const codePoint = Number.parseInt(hex, 16);
        return Number.isNaN(codePoint) ? _match : String.fromCodePoint(codePoint);
      });

  // Run up to two passes to handle double-encoded entities (e.g. &amp;#39;) in YouTube XML
  return decodePass(decodePass(rawText));
}

/**
 * Strips XML/HTML tags and timestamps, decodes HTML entities, and joins caption segments
 * into clean, single-spaced prose.
 */
export function cleanTranscriptText(rawXmlOrText: string): string {
  if (!rawXmlOrText) {
    return "";
  }

  // 1. Strip XML declarations and outer/inner XML tags, replacing tag boundaries with spaces
  const withoutXmlTags = rawXmlOrText
    .replace(/<\?xml[^>]*\?>/gi, " ")
    .replace(/<\/?(?:transcript|timedtext|body|head|p|s|text)\b[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ");

  // 2. Decode HTML entities
  const decoded = decodeHtmlEntities(withoutXmlTags);

  // 3. Strip any inline HTML formatting tags that were entity-encoded (e.g. &lt;b&gt;...&lt;/b&gt;)
  const withoutInlineTags = decoded.replace(/<\/?[a-zA-Z][^>]*>/g, "");

  // 4. Collapse whitespace into clean single spaces
  return withoutInlineTags.replace(/\s+/g, " ").trim();
}

const MIN_USABLE_SPEECH_CHARS = 20;

function hasUsableSpeechContent(cleanedText: string): boolean {
  if (!cleanedText) {
    return false;
  }
  // Remove bracketed audio cues (e.g. [Music], [Applause]) and musical symbols
  const speechOnly = cleanedText
    .replace(/\[[^\]]*\]/g, "")
    .replace(/[♪♫♬♩]+/g, "")
    .replace(/\s+/g, "")
    .trim();

  return speechOnly.length >= MIN_USABLE_SPEECH_CHARS;
}

function isBotOrCloudBlockBody(body: string): boolean {
  return /Before you continue to YouTube|complete captcha to continue|Sign in to confirm you’re not a bot|Sign in to confirm you're not a bot|LOGIN_REQUIRED|g-recaptcha|bot detection/i.test(
    body
  );
}

interface CaptionTrackItem {
  baseUrl?: string;
  languageCode?: string;
}

function extractCaptionTracksFromWatchHtml(html: string): {
  tracks: CaptionTrackItem[];
  title: string | null;
} {
  let title: string | null = null;
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  if (titleMatch?.[1]) {
    title = decodeHtmlEntities(titleMatch[1].replace(/\s*-\s*YouTube$/i, "").trim());
  }

  const marker = '"captionTracks":';
  const markerIdx = html.indexOf(marker);
  if (markerIdx === -1) {
    return { tracks: [], title };
  }

  const startIdx = html.indexOf("[", markerIdx + marker.length);
  if (startIdx === -1) {
    return { tracks: [], title };
  }

  let depth = 0;
  let inString = false;
  let escape = false;
  let endIdx = -1;

  for (let i = startIdx; i < html.length; i++) {
    const char = html[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === "\\") {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === "[") {
        depth++;
      } else if (char === "]") {
        depth--;
        if (depth === 0) {
          endIdx = i + 1;
          break;
        }
      }
    }
  }

  if (endIdx === -1) {
    return { tracks: [], title };
  }

  try {
    const jsonStr = html.slice(startIdx, endIdx);
    const parsed: unknown = JSON.parse(jsonStr);
    if (Array.isArray(parsed)) {
      const tracks: CaptionTrackItem[] = parsed.filter(
        (item): item is CaptionTrackItem => typeof item === "object" && item !== null
      );
      return { tracks, title };
    }
  } catch {
    // Fall through if JSON fragment fails to parse
  }

  return { tracks: [], title };
}

/**
 * Fetches and cleans the YouTube transcript for a validated 11-character videoId.
 * Distinguishes between missing/disabled captions (CAPTIONS_UNAVAILABLE) and
 * cloud datacenter IP blocks / bot challenges (YOUTUBE_CLOUD_IP_BLOCKED).
 */
export async function fetchYouTubeTranscript(
  videoId: string,
  options?: { proxyUrl?: string; timeoutMs?: number }
): Promise<TranscriptFetchResult> {
  if (!videoId || typeof videoId !== "string" || !videoId.trim()) {
    throw new YouTubeIngestionError(
      "INVALID_YOUTUBE_URL",
      "Invalid YouTube video ID.",
      false
    );
  }

  const timeoutMs = options?.timeoutMs ?? 30_000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const targetUrl = options?.proxyUrl
    ? `${options.proxyUrl.replace(/\/$/, "")}/${watchUrl}`
    : watchUrl;

  try {
    const res = await fetch(targetUrl, {
      method: "GET",
      headers: {
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      },
      signal: controller.signal,
    });

    const bodyText = await res.text();

    if (!res.ok) {
      if (res.status === 403 || res.status === 429 || isBotOrCloudBlockBody(bodyText)) {
        throw new YouTubeIngestionError(
          "YOUTUBE_CLOUD_IP_BLOCKED",
          `YouTube blocked the request from this cloud IP address (HTTP ${res.status}). Configure a residential proxy via YOUTUBE_PROXY_URL or run locally.`,
          true
        );
      }

      throw new YouTubeIngestionError(
        "CAPTIONS_UNAVAILABLE",
        "Captions or transcript are unavailable or disabled for this YouTube video.",
        true
      );
    }

    // Case 1: Direct XML transcript response (<transcript> or <timedtext>)
    if (bodyText.includes("<transcript") || bodyText.includes("<timedtext")) {
      const cleaned = cleanTranscriptText(bodyText);
      if (!hasUsableSpeechContent(cleaned)) {
        throw new YouTubeIngestionError(
          "CAPTIONS_UNAVAILABLE",
          "Captions or transcript are empty or contain no usable spoken text for this video.",
          true
        );
      }

      return {
        text: cleaned,
        language: "en",
        title: `YouTube Video (${videoId})`,
      };
    }

    // Case 2: HTML challenge / bot block returned with HTTP 200
    if (isBotOrCloudBlockBody(bodyText) && !bodyText.includes('"captionTracks"')) {
      throw new YouTubeIngestionError(
        "YOUTUBE_CLOUD_IP_BLOCKED",
        "YouTube blocked the server cloud IP with a sign-in or captcha challenge. Configure a residential proxy via YOUTUBE_PROXY_URL or run locally.",
        true
      );
    }

    // Case 3: Standard YouTube watch HTML containing player captionTracks
    const { tracks, title } = extractCaptionTracksFromWatchHtml(bodyText);
    if (tracks.length === 0) {
      throw new YouTubeIngestionError(
        "CAPTIONS_UNAVAILABLE",
        "No captions or transcripts are available for this YouTube video.",
        true
      );
    }

    const selectedTrack =
      tracks.find((t) => t.languageCode === "en" || t.languageCode?.startsWith("en")) ?? tracks[0];

    if (!selectedTrack?.baseUrl) {
      throw new YouTubeIngestionError(
        "CAPTIONS_UNAVAILABLE",
        "Captions track URL is missing for this YouTube video.",
        true
      );
    }

    // SSRF hardening: verify caption track URL host belongs to youtube.com
    let parsedCaptionUrl: URL;
    try {
      parsedCaptionUrl = new URL(selectedTrack.baseUrl);
    } catch {
      throw new YouTubeIngestionError(
        "CAPTIONS_UNAVAILABLE",
        "Invalid caption track URL for this YouTube video.",
        true
      );
    }

    const captionHost = parsedCaptionUrl.hostname.toLowerCase();
    if (!captionHost.endsWith(".youtube.com") && captionHost !== "youtube.com") {
      throw new YouTubeIngestionError(
        "CAPTIONS_UNAVAILABLE",
        "Untrusted caption track URL host for this YouTube video.",
        true
      );
    }

    const captionTargetUrl = options?.proxyUrl
      ? `${options.proxyUrl.replace(/\/$/, "")}/${selectedTrack.baseUrl}`
      : selectedTrack.baseUrl;

    const captionRes = await fetch(captionTargetUrl, {
      method: "GET",
      headers: {
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
    });

    const captionXml = await captionRes.text();
    if (!captionRes.ok) {
      if (captionRes.status === 403 || captionRes.status === 429) {
        throw new YouTubeIngestionError(
          "YOUTUBE_CLOUD_IP_BLOCKED",
          `YouTube blocked caption retrieval from this cloud IP (HTTP ${captionRes.status}). Configure a residential proxy via YOUTUBE_PROXY_URL.`,
          true
        );
      }
      throw new YouTubeIngestionError(
        "CAPTIONS_UNAVAILABLE",
        "Failed to retrieve captions track for this YouTube video.",
        true
      );
    }

    const cleaned = cleanTranscriptText(captionXml);
    if (!hasUsableSpeechContent(cleaned)) {
      throw new YouTubeIngestionError(
        "CAPTIONS_UNAVAILABLE",
        "Captions or transcript contain no usable spoken text for this YouTube video.",
        true
      );
    }

    return {
      text: cleaned,
      language: selectedTrack.languageCode ?? "en",
      title: title || `YouTube Video (${videoId})`,
    };
  } catch (err: unknown) {
    if (err instanceof YouTubeIngestionError) {
      throw err;
    }
    if (err instanceof Error && err.name === "AbortError") {
      throw new YouTubeIngestionError(
        "EXTRACTION_TIMEOUT",
        "YouTube transcript extraction timed out. Please try again.",
        true
      );
    }
    throw new YouTubeIngestionError(
      "INTERNAL_ERROR",
      "An unexpected error occurred while fetching the YouTube transcript.",
      true
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
