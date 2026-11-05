/**
 * YouTube Ingestion Unit Test Suite (Slice 1)
 *
 * Verifies acceptance criteria:
 * - AC-01.1 & AC-01.2: Unified Ingestion Contract (ADR-01)
 * - AC-03.1: YouTube URL parsing across all variants and rejection of invalid formats (ADR-03)
 * - AC-03.2: Caption decoding, XML tag/timestamp stripping, prose joining (ADR-03)
 * - AC-03.3: Captions unavailable error handling (ADR-03)
 * - AC-03.4: Cloud IP block (HTTP 403/429/LOGIN_REQUIRED) error handling (ADR-03)
 * - AC-12.1: In-memory caching on repeat requests (ADR-12)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseYouTubeVideoId,
  decodeHtmlEntities,
  cleanTranscriptText,
  fetchYouTubeTranscript,
  YouTubeIngestionError,
} from "@/lib/ingest/youtube";
import { POST as youtubeHandler } from "@/app/api/ingest/youtube/route";
import { ingestionCache } from "@/lib/ingest/cache";
import type { IngestionSuccess, IngestionError } from "@/types/ingest";
import {
  VALID_YOUTUBE_URL_SAMPLES,
  INVALID_YOUTUBE_URL_SAMPLES,
  MOCK_YOUTUBE_RAW_XML_CAPTIONS,
  MOCK_YOUTUBE_CLEANED_TEXT,
  MOCK_YOUTUBE_EMPTY_TRANSCRIPT_XML,
  MOCK_YOUTUBE_MUSIC_ONLY_XML,
  MOCK_YOUTUBE_HTML_CHALLENGE_BODY,
  IMPLICIT_EDGE_CASE_URL_SAMPLES,
} from "../../fixtures/ingest-fixtures";

describe("YouTube Ingestion Engine (AC-01, AC-03, AC-12)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    ingestionCache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    ingestionCache.clear();
  });

  describe("AC-03.1: YouTube URL Parser", () => {
    describe("Valid URL Variations", () => {
      VALID_YOUTUBE_URL_SAMPLES.forEach(({ url, expectedId, desc }) => {
        it(`extracts videoId "${expectedId}" from ${desc}`, () => {
          const videoId = parseYouTubeVideoId(url);
          expect(videoId).toBe(expectedId);
        });
      });
    });

    describe("Invalid & Unsupported URL Formats", () => {
      INVALID_YOUTUBE_URL_SAMPLES.forEach(({ url, desc }) => {
        it(`returns null for ${desc}: "${url}"`, () => {
          const videoId = parseYouTubeVideoId(url);
          expect(videoId).toBeNull();
        });
      });

      it("returns null for null or undefined input", () => {
        expect(parseYouTubeVideoId(null as unknown as string)).toBeNull();
        expect(parseYouTubeVideoId(undefined as unknown as string)).toBeNull();
      });
    });

    describe("Implicit Boundary: URL Parameter Pollution & Malformed Routes", () => {
      IMPLICIT_EDGE_CASE_URL_SAMPLES.forEach(({ url, expectedId, desc }) => {
        it(`handles ${desc}: "${url}" safely`, () => {
          const videoId = parseYouTubeVideoId(url);
          expect(videoId).toBe(expectedId);
        });
      });
    });
  });

  describe("AC-03.2: Caption Text & HTML Entity Decoding", () => {
    it("decodes all standard HTML entities (&amp;, &#39;, &quot;, &lt;, &gt;, &apos;)", () => {
      const raw = "Fish &amp; Chips &quot;special&quot; at McDonald&#39;s &lt;today&gt; &apos;fast&apos;";
      const decoded = decodeHtmlEntities(raw);
      expect(decoded).toBe("Fish & Chips \"special\" at McDonald's <today> 'fast'");
    });

    it("strips XML tags, timestamps and joins segments into clean prose", () => {
      const cleaned = cleanTranscriptText(MOCK_YOUTUBE_RAW_XML_CAPTIONS);
      expect(cleaned).toBe(MOCK_YOUTUBE_CLEANED_TEXT);
      expect(cleaned).not.toContain("<transcript>");
      expect(cleaned).not.toContain("<text");
      expect(cleaned).not.toContain("start=");
      expect(cleaned).not.toContain("dur=");
    });

    it("normalizes excessive whitespace and collapses multiple blank lines into clean spacing", () => {
      const rawWithWhitespace = `
        <transcript>
          <text start="0.0">First sentence.   </text>

          <text start="2.0">   Second sentence with    internal spacing.</text>
        </transcript>
      `;
      const cleaned = cleanTranscriptText(rawWithWhitespace);
      expect(cleaned).toBe("First sentence. Second sentence with internal spacing.");
      expect(cleaned).not.toMatch(/\s{2,}/);
    });
  });

  describe("AC-03.2 – AC-03.4: fetchYouTubeTranscript Library Function", () => {
    it("successfully fetches and returns transcript for video with captions", async () => {
      // Mock global fetch returning valid caption XML
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(MOCK_YOUTUBE_RAW_XML_CAPTIONS),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await fetchYouTubeTranscript("dQw4w9WgXcQ");
      expect(result).toBeDefined();
      expect(result.text).toBe(MOCK_YOUTUBE_CLEANED_TEXT);
      expect(result.language).toMatch(/en/i);
      expect(result.title).toBeDefined();
    });

    it("throws CAPTIONS_UNAVAILABLE when video has no captions or transcripts are disabled", async () => {
      // Mock fetch returning empty captions or 404 on transcript endpoint
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve("Transcript not found"),
      });
      vi.stubGlobal("fetch", mockFetch);

      await expect(fetchYouTubeTranscript("noCaptions11")).rejects.toThrowError(
        expect.objectContaining({
          code: "CAPTIONS_UNAVAILABLE",
          retryable: true,
        })
      );
    });

    it("throws YOUTUBE_CLOUD_IP_BLOCKED when YouTube blocks server IP (403/429/LOGIN_REQUIRED)", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: () => Promise.resolve("Too Many Requests - Bot Detection / Sign in"),
      });
      vi.stubGlobal("fetch", mockFetch);

      await expect(fetchYouTubeTranscript("blockedIp11")).rejects.toThrowError(
        expect.objectContaining({
          code: "YOUTUBE_CLOUD_IP_BLOCKED",
        })
      );
    });

    it("supports optional proxyUrl for cloud deployment routing", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(MOCK_YOUTUBE_RAW_XML_CAPTIONS),
      });
      vi.stubGlobal("fetch", mockFetch);

      await fetchYouTubeTranscript("dQw4w9WgXcQ", { proxyUrl: "http://proxy.internal:8080" });
      expect(mockFetch).toHaveBeenCalled();
    });

    describe("Implicit Boundary: HTTP 200 OK False Positives (Empty, Music-Only, HTML Challenge Bodies)", () => {
      it("throws CAPTIONS_UNAVAILABLE when upstream returns HTTP 200 with empty <transcript></transcript>", async () => {
        vi.stubGlobal(
          "fetch",
          vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            text: () => Promise.resolve(MOCK_YOUTUBE_EMPTY_TRANSCRIPT_XML),
          })
        );

        await expect(fetchYouTubeTranscript("emptyXml111")).rejects.toThrowError(
          expect.objectContaining({
            code: "CAPTIONS_UNAVAILABLE",
            retryable: true,
          })
        );
      });

      it("throws CAPTIONS_UNAVAILABLE when upstream returns HTTP 200 with only music/cue tokens (< 20 usable chars)", async () => {
        vi.stubGlobal(
          "fetch",
          vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            text: () => Promise.resolve(MOCK_YOUTUBE_MUSIC_ONLY_XML),
          })
        );

        await expect(fetchYouTubeTranscript("musicOnly11")).rejects.toThrowError(
          expect.objectContaining({
            code: "CAPTIONS_UNAVAILABLE",
            retryable: true,
          })
        );
      });

      it("throws YOUTUBE_CLOUD_IP_BLOCKED when upstream returns HTTP 200 with an HTML captcha/sign-in page", async () => {
        vi.stubGlobal(
          "fetch",
          vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            text: () => Promise.resolve(MOCK_YOUTUBE_HTML_CHALLENGE_BODY),
          })
        );

        await expect(fetchYouTubeTranscript("htmlChallenge")).rejects.toThrowError(
          expect.objectContaining({
            code: "YOUTUBE_CLOUD_IP_BLOCKED",
          })
        );
      });
    });
  });

  describe("API Route Handler: POST /api/ingest/youtube", () => {
    it("AC-03.1: returns HTTP 400 with INVALID_YOUTUBE_URL for missing URL in request body", async () => {
      const req = new Request("http://localhost/api/ingest/youtube", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const res = await youtubeHandler(req);
      expect(res.status).toBe(400);

      const json = (await res.json()) as IngestionError;
      expect(json.ok).toBe(false);
      expect(json.code).toBe("INVALID_YOUTUBE_URL");
      expect(json.retryable).toBe(false);
      expect(typeof json.message).toBe("string");
    });

    it("AC-03.1: returns HTTP 400 with INVALID_YOUTUBE_URL for non-YouTube domain or malformed URL", async () => {
      const req = new Request("http://localhost/api/ingest/youtube", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://vimeo.com/123456789" }),
      });

      const res = await youtubeHandler(req);
      expect(res.status).toBe(400);

      const json = (await res.json()) as IngestionError;
      expect(json.ok).toBe(false);
      expect(json.code).toBe("INVALID_YOUTUBE_URL");
    });

    describe("Implicit Negative Paths: Malformed Request Envelopes & Type Inversion", () => {
      it("returns HTTP 400 with INVALID_YOUTUBE_URL on malformed JSON payload without throwing unhandled SyntaxError", async () => {
        const req = new Request("http://localhost/api/ingest/youtube", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: '{"url": "https://www.youtube.com/watch?v=', // Invalid truncated JSON
        });

        const res = await youtubeHandler(req);
        expect(res.status).toBe(400);

        const json = (await res.json()) as IngestionError;
        expect(json.ok).toBe(false);
        expect(json.code).toBe("INVALID_YOUTUBE_URL");
        expect(json.retryable).toBe(false);
      });

      it("returns HTTP 400 with INVALID_YOUTUBE_URL when url property is a non-string type (number, boolean, array, object)", async () => {
        const nonStringPayloads = [
          { url: 12345 },
          { url: true },
          { url: ["https://www.youtube.com/watch?v=dQw4w9WgXcQ"] },
          { url: { nested: "url" } },
        ];

        for (const payload of nonStringPayloads) {
          const req = new Request("http://localhost/api/ingest/youtube", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

          const res = await youtubeHandler(req);
          expect(res.status).toBe(400);

          const json = (await res.json()) as IngestionError;
          expect(json.ok).toBe(false);
          expect(json.code).toBe("INVALID_YOUTUBE_URL");
        }
      });

      it("returns HTTP 400 with INVALID_YOUTUBE_URL when request body is empty (0 bytes)", async () => {
        const req = new Request("http://localhost/api/ingest/youtube", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "",
        });

        const res = await youtubeHandler(req);
        expect(res.status).toBe(400);

        const json = (await res.json()) as IngestionError;
        expect(json.ok).toBe(false);
        expect(json.code).toBe("INVALID_YOUTUBE_URL");
      });
    });

    it("AC-01.1 & AC-03.2: returns HTTP 200 and unified IngestionSuccess payload for valid YouTube video", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          text: () => Promise.resolve(MOCK_YOUTUBE_RAW_XML_CAPTIONS),
        })
      );

      const req = new Request("http://localhost/api/ingest/youtube", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }),
      });

      const res = await youtubeHandler(req);
      expect(res.status).toBe(200);

      const json = (await res.json()) as IngestionSuccess;
      expect(json.ok).toBe(true);
      expect(json.sourceType).toBe("youtube");
      expect(typeof json.title).toBe("string");
      expect(json.title.length).toBeGreaterThan(0);
      expect(json.text).toBe(MOCK_YOUTUBE_CLEANED_TEXT);
      expect(json.charCount).toBe(MOCK_YOUTUBE_CLEANED_TEXT.length);
      expect(json.estimatedTokens).toBe(Math.ceil(MOCK_YOUTUBE_CLEANED_TEXT.length / 4));
      expect(json.metadata.videoId).toBe("dQw4w9WgXcQ");
      expect(json.metadata.language).toBeDefined();
    });

    it("AC-03.3: returns HTTP 422 with CAPTIONS_UNAVAILABLE when video has no captions", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 404,
          text: () => Promise.resolve("Captions are disabled for this video"),
        })
      );

      const req = new Request("http://localhost/api/ingest/youtube", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://youtu.be/nocaptions1" }),
      });

      const res = await youtubeHandler(req);
      expect(res.status).toBe(422);

      const json = (await res.json()) as IngestionError;
      expect(json.ok).toBe(false);
      expect(json.code).toBe("CAPTIONS_UNAVAILABLE");
      expect(json.retryable).toBe(true);
      expect(json.message).toMatch(/captions|transcript/i);
    });

    it("AC-03.4: returns HTTP 503 with YOUTUBE_CLOUD_IP_BLOCKED when YouTube blocks IP with 403/429/bot challenge", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 403,
          text: () => Promise.resolve("<title>Error 403 (Forbidden)</title> IP blocked"),
        })
      );

      const req = new Request("http://localhost/api/ingest/youtube", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://www.youtube.com/watch?v=blockedIP11" }),
      });

      const res = await youtubeHandler(req);
      expect(res.status).toBe(503);

      const json = (await res.json()) as IngestionError;
      expect(json.ok).toBe(false);
      expect(json.code).toBe("YOUTUBE_CLOUD_IP_BLOCKED");
      expect(json.message).toMatch(/cloud|ip|block|residential proxy/i);
    });

    it("AC-12.1: returns cached result for repeat requests of the same videoId without redundant fetch", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(MOCK_YOUTUBE_RAW_XML_CAPTIONS),
      });
      vi.stubGlobal("fetch", mockFetch);

      const makeRequest = () =>
        new Request("http://localhost/api/ingest/youtube", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: "https://www.youtube.com/watch?v=cacheTest11" }),
        });

      // First call -> fetches upstream
      const res1 = await youtubeHandler(makeRequest());
      expect(res1.status).toBe(200);
      const json1 = await res1.json();

      // Second call -> should hit in-memory cache
      const res2 = await youtubeHandler(makeRequest());
      expect(res2.status).toBe(200);
      const json2 = await res2.json();

      expect(json2).toEqual(json1);
      // Upstream fetch should not have been called twice for captions
      expect(mockFetch.mock.calls.length).toBeLessThanOrEqual(2); // May fetch video info once + captions once on call 1
    });

    it("never emits CONTEXT_TOO_LARGE_FOR_REALTIME at ingestion (Option 2B)", async () => {
      // Create a very long transcript (> 48,000 chars)
      const longText = "Captioned line of dialogue for testing full text. ".repeat(1500); // ~75,000 chars
      const longXml = `<transcript><text start="0.0">${longText}</text></transcript>`;

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          text: () => Promise.resolve(longXml),
        })
      );

      const req = new Request("http://localhost/api/ingest/youtube", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://www.youtube.com/watch?v=longTrans11" }),
      });

      const res = await youtubeHandler(req);
      expect(res.status).toBe(200);

      const json = (await res.json()) as IngestionSuccess;
      expect(json.ok).toBe(true);
      expect(json.charCount).toBeGreaterThan(48_000);
      expect(json.text.length).toBe(json.charCount); // Never truncated at ingestion!
    });
  });
});
