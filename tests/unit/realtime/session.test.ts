/**
 * Realtime Session Ephemeral Token Minting Route Unit Test Suite (Slice 2)
 *
 * Verifies acceptance criteria:
 * - AC-04.1: Secret Isolation & missing OPENAI_API_KEY handling (ADR-04)
 * - AC-04.2: Ephemeral token minting parameters (VAD, whisper-1, model, voice) (ADR-04)
 * - AC-04.3: Success payload, ephemeralKey extraction & Cache-Control: no-store (ADR-04)
 * - AC-05.1: Direct context priming for sources <= 48,000 characters (ADR-05)
 * - AC-05.2: 48,000-character context safe cap and truncation flag (ADR-05)
 * - AC-05.3: No-chunking, no-summarization, no-RAG boundary compliance (ADR-05)
 * - AC-10.1: Upstream timeout & poor network handling (ADR-10)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST as realtimeSessionHandler } from "@/app/api/realtime/session/route";
import {
  MAX_REALTIME_CONTEXT_CHARS,
  buildSessionInstructions,
} from "@/lib/realtime/context";
import type {
  RealtimeSessionSuccess,
  RealtimeSessionError,
} from "@/types/realtime";
import {
  MOCK_OPENAI_SESSION_RESPONSE,
  MOCK_OPENAI_CUSTOM_MODEL_RESPONSE,
  MOCK_OPENAI_401_UNAUTHORIZED,
  MOCK_OPENAI_429_RATE_LIMIT,
  MOCK_OPENAI_500_SERVER_ERROR,
  MOCK_OPENAI_400_BAD_PARAM,
  HTML_502_BAD_GATEWAY,
  createExactLengthText,
  createSessionRequest,
} from "../../fixtures/realtime-fixtures";

// Helper to inspect request headers regardless of Headers / plain object representation
function getHeaderValue(
  headers: HeadersInit | undefined,
  targetName: string
): string | null {
  if (!headers) return null;
  if (headers instanceof Headers) {
    return headers.get(targetName);
  }
  if (Array.isArray(headers)) {
    const entry = headers.find(([k]) => k.toLowerCase() === targetName.toLowerCase());
    return entry ? entry[1] : null;
  }
  const key = Object.keys(headers).find(
    (k) => k.toLowerCase() === targetName.toLowerCase()
  );
  return key ? (headers as Record<string, string>)[key] : null;
}

describe("Realtime Session Ephemeral Token Minting Route (AC-04, AC-05, AC-10.1)", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
    process.env.OPENAI_API_KEY = "sk-test-mock-openai-key-slice2";
    delete process.env.OPENAI_REALTIME_MODEL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  describe("AC-04.2 & AC-04.3: Happy Path & Session Minting Contract", () => {
    it("AC-04.3: returns HTTP 200 with ephemeralKey, expiresAt, model, and Cache-Control: no-store on valid PDF request", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(MOCK_OPENAI_SESSION_RESPONSE), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const requestPayload = {
        text: "This is a valid extracted text from an uploaded PDF document.",
        title: "quarterly-report.pdf",
        sourceType: "pdf",
      };
      const req = createSessionRequest(requestPayload);

      const res = await realtimeSessionHandler(req);
      expect(res.status).toBe(200);

      // Verify Cache-Control: no-store per AC-04.3
      const cacheControl = res.headers.get("Cache-Control") || "";
      expect(cacheControl).toMatch(/no-store/i);

      const json = (await res.json()) as RealtimeSessionSuccess;
      expect(json.ok).toBe(true);
      expect(json.ephemeralKey).toBe("ek_mock_client_secret_token_1234567890abcdef");
      expect(json.expiresAt).toBe(1731000600);
      expect(json.model).toBe("gpt-4o-realtime-preview");

      // Verify fetch call to OpenAI
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [upstreamUrl, upstreamInit] = fetchSpy.mock.calls[0];
      expect(upstreamUrl).toBe("https://api.openai.com/v1/realtime/sessions");
      expect(upstreamInit?.method).toBe("POST");

      const authHeader = getHeaderValue(upstreamInit?.headers, "Authorization");
      expect(authHeader).toBe("Bearer sk-test-mock-openai-key-slice2");

      const contentTypeHeader = getHeaderValue(upstreamInit?.headers, "Content-Type");
      expect(contentTypeHeader).toMatch(/application\/json/i);
    });

    it("AC-04.3: returns HTTP 200 with ephemeralKey on valid YouTube transcript request", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(MOCK_OPENAI_SESSION_RESPONSE), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const requestPayload = {
        text: "Transcript speech segments from Steve Jobs Stanford Commencement Address.",
        title: "Steve Jobs 2005 Stanford Speech",
        sourceType: "youtube",
      };
      const req = createSessionRequest(requestPayload);

      const res = await realtimeSessionHandler(req);
      expect(res.status).toBe(200);

      const json = (await res.json()) as RealtimeSessionSuccess;
      expect(json.ok).toBe(true);
      expect(json.ephemeralKey).toBe(MOCK_OPENAI_SESSION_RESPONSE.client_secret.value);
    });

    it("AC-04.2: sends required OpenAI Realtime parameters (model, modalities, voice, transcription, turn_detection)", async () => {
      let sentBody: Record<string, unknown> | null = null;
      vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (_url, init) => {
        sentBody = JSON.parse(init?.body as string);
        return new Response(JSON.stringify(MOCK_OPENAI_SESSION_RESPONSE), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const requestPayload = {
        text: "Document content for parameter verification.",
        title: "sample.pdf",
        sourceType: "pdf",
      };
      const req = createSessionRequest(requestPayload);

      const res = await realtimeSessionHandler(req);
      expect(res.status).toBe(200);

      expect(sentBody).not.toBeNull();
      expect(sentBody!.model).toBe("gpt-4o-mini-realtime-preview");
      expect(sentBody!.modalities).toEqual(["audio", "text"]);
      expect(sentBody!.voice).toBe("alloy");
      expect(sentBody!.input_audio_transcription).toEqual({ model: "whisper-1" });
      expect(sentBody!.turn_detection).toEqual({
        type: "server_vad",
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 500,
        create_response: true,
        interrupt_response: true,
      });

      // Verify instructions contains the source context
      expect(typeof sentBody!.instructions).toBe("string");
      expect(sentBody!.instructions).toContain("sample.pdf");
      expect(sentBody!.instructions).toContain("Document content for parameter verification.");
    });

    it("AC-04.2: respects OPENAI_REALTIME_MODEL environment variable override", async () => {
      process.env.OPENAI_REALTIME_MODEL = "gpt-4o-realtime-preview-2024-12-17";

      let sentModel: string | null = null;
      vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (_url, init) => {
        const parsed = JSON.parse(init?.body as string);
        sentModel = parsed.model;
        return new Response(JSON.stringify(MOCK_OPENAI_CUSTOM_MODEL_RESPONSE), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const req = createSessionRequest({
        text: "Testing model override.",
        title: "test.pdf",
        sourceType: "pdf",
      });

      const res = await realtimeSessionHandler(req);
      expect(res.status).toBe(200);
      expect(sentModel).toBe("gpt-4o-realtime-preview-2024-12-17");

      const json = (await res.json()) as RealtimeSessionSuccess;
      expect(json.model).toBe("gpt-4o-realtime-preview-2024-12-17");
    });

    it("AC-04.2: respects optional custom voice parameter from request body (e.g., 'verse', 'shimmer')", async () => {
      let sentVoice: string | null = null;
      vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (_url, init) => {
        const parsed = JSON.parse(init?.body as string);
        sentVoice = parsed.voice;
        return new Response(JSON.stringify(MOCK_OPENAI_SESSION_RESPONSE), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const req = createSessionRequest({
        text: "Voice option testing.",
        title: "voice-test.pdf",
        sourceType: "pdf",
        voice: "verse",
      });

      const res = await realtimeSessionHandler(req);
      expect(res.status).toBe(200);
      expect(sentVoice).toBe("verse");
    });

    it("AC-04.2: sends Authorization Bearer header using server-side OPENAI_API_KEY", async () => {
      process.env.OPENAI_API_KEY = "sk-special-configured-test-key-999";

      let capturedAuthHeader: string | null = null;
      vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (_url, init) => {
        capturedAuthHeader = getHeaderValue(init?.headers, "Authorization");
        return new Response(JSON.stringify(MOCK_OPENAI_SESSION_RESPONSE), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const req = createSessionRequest({
        text: "Checking auth header forwarding.",
        title: "auth.pdf",
        sourceType: "pdf",
      });

      const res = await realtimeSessionHandler(req);
      expect(res.status).toBe(200);
      expect(capturedAuthHeader).toBe("Bearer sk-special-configured-test-key-999");
    });
  });

  describe("AC-05.1 – AC-05.3: Context Priming & 48,000-Char Safe Cap (ADR-05)", () => {
    it("AC-05.1: text <= 48,000 characters is fully embedded in session.instructions with isContextTruncated = false", async () => {
      const textContent = "Short document content well under the 48,000 limit. ".repeat(20); // ~1,040 chars
      expect(textContent.length).toBeLessThan(MAX_REALTIME_CONTEXT_CHARS);

      let sentInstructions = "";
      vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (_url, init) => {
        const parsed = JSON.parse(init?.body as string);
        sentInstructions = parsed.instructions;
        return new Response(JSON.stringify(MOCK_OPENAI_SESSION_RESPONSE), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const req = createSessionRequest({
        text: textContent,
        title: "under-limit.pdf",
        sourceType: "pdf",
      });

      const res = await realtimeSessionHandler(req);
      expect(res.status).toBe(200);

      const json = (await res.json()) as RealtimeSessionSuccess;
      expect(json.isContextTruncated).toBe(false);

      expect(sentInstructions).toContain(textContent);
      expect(sentInstructions).toContain("under-limit.pdf");
      expect(sentInstructions).toContain("pdf");
    });

    it("AC-05.1 & AC-05.2: boundary of exactly 48,000 characters preserves full text without truncation (isContextTruncated = false)", async () => {
      const exact48kText = createExactLengthText(48_000, "ABCDEFGHIJ");
      expect(exact48kText.length).toBe(48_000);

      let sentInstructions = "";
      vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (_url, init) => {
        const parsed = JSON.parse(init?.body as string);
        sentInstructions = parsed.instructions;
        return new Response(JSON.stringify(MOCK_OPENAI_SESSION_RESPONSE), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const req = createSessionRequest({
        text: exact48kText,
        title: "exact-48k.pdf",
        sourceType: "pdf",
      });

      const res = await realtimeSessionHandler(req);
      expect(res.status).toBe(200);

      const json = (await res.json()) as RealtimeSessionSuccess;
      expect(json.isContextTruncated).toBe(false);

      // Entire 48,000 character string must be present in instructions
      expect(sentInstructions).toContain(exact48kText);
    });

    it("AC-05.2: boundary of 48,001 characters slices context to first 48,000 characters and sets isContextTruncated = true", async () => {
      // 48,000 'A' characters followed by a single 'Z' character at position 48,001
      const offByOneText = "A".repeat(48_000) + "Z";
      expect(offByOneText.length).toBe(48_001);

      let sentInstructions = "";
      vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (_url, init) => {
        const parsed = JSON.parse(init?.body as string);
        sentInstructions = parsed.instructions;
        return new Response(JSON.stringify(MOCK_OPENAI_SESSION_RESPONSE), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const req = createSessionRequest({
        text: offByOneText,
        title: "boundary-48001.pdf",
        sourceType: "pdf",
      });

      const res = await realtimeSessionHandler(req);
      expect(res.status).toBe(200);

      const json = (await res.json()) as RealtimeSessionSuccess;
      expect(json.isContextTruncated).toBe(true);

      // The first 48,000 characters ('A's) must be present in instructions
      expect(sentInstructions).toContain("A".repeat(48_000));
      // The 48,001st character ('Z') must be sliced out of instructions
      expect(sentInstructions).not.toContain("A".repeat(48_000) + "Z");
    });

    it("AC-05.2: large text (e.g., 75,000 characters / ~18,750 tokens) is capped at exactly 48,000 characters", async () => {
      const hugeText = createExactLengthText(75_000, "1234567890");
      expect(hugeText.length).toBe(75_000);

      let sentInstructions = "";
      vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (_url, init) => {
        const parsed = JSON.parse(init?.body as string);
        sentInstructions = parsed.instructions;
        return new Response(JSON.stringify(MOCK_OPENAI_SESSION_RESPONSE), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const req = createSessionRequest({
        text: hugeText,
        title: "huge-book.pdf",
        sourceType: "pdf",
      });

      const res = await realtimeSessionHandler(req);
      expect(res.status).toBe(200);

      const json = (await res.json()) as RealtimeSessionSuccess;
      expect(json.isContextTruncated).toBe(true);

      // First 48,000 characters must be included
      const expectedSlice = hugeText.slice(0, 48_000);
      expect(sentInstructions).toContain(expectedSlice);

      // Characters beyond 48,000 must NOT be included
      const excludedSuffix = hugeText.slice(48_000, 48_100);
      expect(sentInstructions).not.toContain(expectedSlice + excludedSuffix);
    });

    it("AC-05.3: context priming does NOT perform chunking, summarization, or RAG (passes text directly as single continuous block)", async () => {
      const paragraphs = [
        "Paragraph One introduces the thesis and foundational concepts.",
        "Paragraph Two elaborates with secondary data points and evidence.",
        "Paragraph Three synthesizes the conclusion and forward-looking guidance.",
      ].join("\n\n");

      let sentInstructions = "";
      vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (_url, init) => {
        const parsed = JSON.parse(init?.body as string);
        sentInstructions = parsed.instructions;
        return new Response(JSON.stringify(MOCK_OPENAI_SESSION_RESPONSE), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const req = createSessionRequest({
        text: paragraphs,
        title: "essay.pdf",
        sourceType: "pdf",
      });

      const res = await realtimeSessionHandler(req);
      expect(res.status).toBe(200);

      // Verifies raw uninterrupted text structure is embedded directly without chunking
      expect(sentInstructions).toContain(paragraphs);
    });

    it("AC-05.1: instructions contain strict grounding rules (answer from source, speak naturally for voice, state if not found)", async () => {
      let sentInstructions = "";
      vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (_url, init) => {
        const parsed = JSON.parse(init?.body as string);
        sentInstructions = parsed.instructions;
        return new Response(JSON.stringify(MOCK_OPENAI_SESSION_RESPONSE), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const req = createSessionRequest({
        text: "Fact: The Eiffel Tower is 330 meters tall.",
        title: "eiffel.pdf",
        sourceType: "pdf",
      });

      const res = await realtimeSessionHandler(req);
      expect(res.status).toBe(200);

      // Grounding rules assertions
      expect(sentInstructions).toMatch(/source|document|context/i);
      expect(sentInstructions).toMatch(/voice|conversational|concise|natural/i);
      expect(sentInstructions).toMatch(/not covered|cannot find|not mentioned|not provided/i);
    });
  });

  describe("AC-04.1: Secret Isolation & Missing OPENAI_API_KEY", () => {
    it("AC-04.1: returns HTTP 500 with code SERVER_MISCONFIGURED when OPENAI_API_KEY is undefined", async () => {
      delete process.env.OPENAI_API_KEY;
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      const req = createSessionRequest({
        text: "Some valid document text.",
        title: "doc.pdf",
        sourceType: "pdf",
      });

      const res = await realtimeSessionHandler(req);
      expect(res.status).toBe(500);

      const json = (await res.json()) as RealtimeSessionError;
      expect(json.ok).toBe(false);
      expect(json.code).toBe("SERVER_MISCONFIGURED");
      expect(json.message).toMatch(/api\s*key|configured|missing/i);

      // Crucial: no fetch call should have been attempted
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("AC-04.1: returns HTTP 500 with code SERVER_MISCONFIGURED when OPENAI_API_KEY is an empty string", async () => {
      process.env.OPENAI_API_KEY = "";
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      const req = createSessionRequest({
        text: "Some valid document text.",
        title: "doc.pdf",
        sourceType: "pdf",
      });

      const res = await realtimeSessionHandler(req);
      expect(res.status).toBe(500);

      const json = (await res.json()) as RealtimeSessionError;
      expect(json.ok).toBe(false);
      expect(json.code).toBe("SERVER_MISCONFIGURED");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("AC-04.1: returns HTTP 500 with code SERVER_MISCONFIGURED when OPENAI_API_KEY is whitespace only", async () => {
      process.env.OPENAI_API_KEY = "    ";
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      const req = createSessionRequest({
        text: "Some valid document text.",
        title: "doc.pdf",
        sourceType: "pdf",
      });

      const res = await realtimeSessionHandler(req);
      expect(res.status).toBe(500);

      const json = (await res.json()) as RealtimeSessionError;
      expect(json.ok).toBe(false);
      expect(json.code).toBe("SERVER_MISCONFIGURED");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("AC-04.1: never leaks OPENAI_API_KEY value in response body, headers, or error messages (Secret Isolation)", async () => {
      const SECRET_KEY = "sk-super-secret-production-key-99887766";
      process.env.OPENAI_API_KEY = SECRET_KEY;

      // Simulate an upstream 500 error from OpenAI
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(MOCK_OPENAI_500_SERVER_ERROR), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        })
      );

      const req = createSessionRequest({
        text: "Valid content under test.",
        title: "secret-check.pdf",
        sourceType: "pdf",
      });

      const res = await realtimeSessionHandler(req);
      const rawText = await res.text();

      // Ensure secret key never appears in response body
      expect(rawText).not.toContain(SECRET_KEY);

      // Ensure secret key never appears in response headers
      res.headers.forEach((val, key) => {
        expect(key).not.toContain(SECRET_KEY);
        expect(val).not.toContain(SECRET_KEY);
      });
    });
  });

  describe("Upstream OpenAI Failure Modes (4xx / 5xx / Malformed Responses)", () => {
    it("handles upstream HTTP 401 Unauthorized without crashing and returns safe error without leaking key", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(MOCK_OPENAI_401_UNAUTHORIZED), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        })
      );

      const req = createSessionRequest({
        text: "Testing 401 response handling.",
        title: "doc.pdf",
        sourceType: "pdf",
      });

      const res = await realtimeSessionHandler(req);
      expect(res.status).toBeGreaterThanOrEqual(400);

      const json = (await res.json()) as RealtimeSessionError;
      expect(json.ok).toBe(false);
      expect(json.message).toBeDefined();
      expect(json.message).not.toContain("sk-test-mock-openai-key-slice2");
    });

    it("handles upstream HTTP 429 Rate Limit Exceeded and returns retryable error", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(MOCK_OPENAI_429_RATE_LIMIT), {
          status: 429,
          headers: { "Content-Type": "application/json" },
        })
      );

      const req = createSessionRequest({
        text: "Testing 429 rate limit handling.",
        title: "doc.pdf",
        sourceType: "pdf",
      });

      const res = await realtimeSessionHandler(req);
      expect(res.status).toBeGreaterThanOrEqual(400);

      const json = (await res.json()) as RealtimeSessionError;
      expect(json.ok).toBe(false);
      expect(json.retryable).toBe(true);
      expect(json.message).toMatch(/rate\s*limit|busy|quota|slow down/i);
    });

    it("handles upstream HTTP 500 / 503 Internal Server Error and returns retryable error", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(MOCK_OPENAI_500_SERVER_ERROR), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        })
      );

      const req = createSessionRequest({
        text: "Testing 500 server error handling.",
        title: "doc.pdf",
        sourceType: "pdf",
      });

      const res = await realtimeSessionHandler(req);
      expect(res.status).toBeGreaterThanOrEqual(500);

      const json = (await res.json()) as RealtimeSessionError;
      expect(json.ok).toBe(false);
      expect(json.retryable).toBe(true);
    });

    it("handles upstream HTTP 400 Bad Request parameter error gracefully", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(MOCK_OPENAI_400_BAD_PARAM), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        })
      );

      const req = createSessionRequest({
        text: "Testing 400 bad request handling.",
        title: "doc.pdf",
        sourceType: "pdf",
      });

      const res = await realtimeSessionHandler(req);
      expect(res.status).toBeGreaterThanOrEqual(400);

      const json = (await res.json()) as RealtimeSessionError;
      expect(json.ok).toBe(false);
    });

    it("handles upstream non-JSON response (e.g., HTML 502 Bad Gateway page) without unhandled JSON crash", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(HTML_502_BAD_GATEWAY, {
          status: 502,
          headers: { "Content-Type": "text/html" },
        })
      );

      const req = createSessionRequest({
        text: "Testing HTML 502 response handling.",
        title: "doc.pdf",
        sourceType: "pdf",
      });

      // Must resolve cleanly without throwing unhandled SyntaxError from response.json()
      const res = await realtimeSessionHandler(req);
      expect(res.status).toBeGreaterThanOrEqual(500);

      const json = (await res.json()) as RealtimeSessionError;
      expect(json.ok).toBe(false);
      expect(json.retryable).toBe(true);
    });

    it("handles upstream 200 OK response with missing or null client_secret gracefully", async () => {
      const malformedPayload = {
        id: "sess_123",
        model: "gpt-4o-realtime-preview",
        client_secret: null, // Missing secret value
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(malformedPayload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const req = createSessionRequest({
        text: "Testing malformed upstream 200 payload.",
        title: "doc.pdf",
        sourceType: "pdf",
      });

      const res = await realtimeSessionHandler(req);
      expect(res.status).toBeGreaterThanOrEqual(500);

      const json = (await res.json()) as RealtimeSessionError;
      expect(json.ok).toBe(false);
      expect(json.message).toMatch(/ephemeral\s*token|client_secret|upstream/i);
    });
  });

  describe("AC-10.1: Upstream Timeouts & Poor Network Resilience (ADR-10)", () => {
    it("ADR-10.1: handles upstream fetch timeout / AbortError gracefully and returns retryable error (HTTP 504 / 500)", async () => {
      const abortError = new DOMException("The operation was aborted due to timeout", "AbortError");
      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(abortError);

      const req = createSessionRequest({
        text: "Testing network abort timeout.",
        title: "doc.pdf",
        sourceType: "pdf",
      });

      const res = await realtimeSessionHandler(req);
      expect([504, 500, 503]).toContain(res.status);

      const json = (await res.json()) as RealtimeSessionError;
      expect(json.ok).toBe(false);
      expect(json.retryable).toBe(true);
      expect(json.message).toMatch(/timeout|timed out|abort/i);
    });

    it("handles upstream network drop (TypeError: fetch failed / connection refused) with retryable error", async () => {
      const networkError = new TypeError("fetch failed: ECONNREFUSED");
      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(networkError);

      const req = createSessionRequest({
        text: "Testing network disconnection.",
        title: "doc.pdf",
        sourceType: "pdf",
      });

      const res = await realtimeSessionHandler(req);
      expect(res.status).toBeGreaterThanOrEqual(500);

      const json = (await res.json()) as RealtimeSessionError;
      expect(json.ok).toBe(false);
      expect(json.retryable).toBe(true);
    });
  });

  describe("Malformed Client Request Bodies & Empty Text", () => {
    it("returns HTTP 400 with code INVALID_REQUEST when request body contains invalid JSON syntax", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      const req = new Request("http://localhost/api/realtime/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{ malformed json: missing quotes and brackets",
      });

      const res = await realtimeSessionHandler(req);
      expect(res.status).toBe(400);

      const json = (await res.json()) as RealtimeSessionError;
      expect(json.ok).toBe(false);
      expect(json.code).toBe("INVALID_REQUEST");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns HTTP 400 with code INVALID_REQUEST when request body is a non-object JSON primitive (e.g. string)", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const req = createSessionRequest("just a plain string");

      const res = await realtimeSessionHandler(req);
      expect(res.status).toBe(400);

      const json = (await res.json()) as RealtimeSessionError;
      expect(json.ok).toBe(false);
      expect(json.code).toBe("INVALID_REQUEST");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns HTTP 400 with code INVALID_REQUEST when request body is a JSON array", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const req = createSessionRequest([{ text: "Inside an array" }]);

      const res = await realtimeSessionHandler(req);
      expect(res.status).toBe(400);

      const json = (await res.json()) as RealtimeSessionError;
      expect(json.ok).toBe(false);
      expect(json.code).toBe("INVALID_REQUEST");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns HTTP 400 with code INVALID_REQUEST when request body is empty (0 bytes)", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const req = new Request("http://localhost/api/realtime/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "",
      });

      const res = await realtimeSessionHandler(req);
      expect(res.status).toBe(400);

      const json = (await res.json()) as RealtimeSessionError;
      expect(json.ok).toBe(false);
      expect(json.code).toBe("INVALID_REQUEST");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns HTTP 400 with code INVALID_REQUEST when text is an empty string (text: '')", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const req = createSessionRequest({
        text: "",
        title: "empty.pdf",
        sourceType: "pdf",
      });

      const res = await realtimeSessionHandler(req);
      expect(res.status).toBe(400);

      const json = (await res.json()) as RealtimeSessionError;
      expect(json.ok).toBe(false);
      expect(json.code).toBe("INVALID_REQUEST");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns HTTP 400 with code INVALID_REQUEST when text is whitespace only (text: '   \\n\\t  ')", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const req = createSessionRequest({
        text: "   \n\t  \r  ",
        title: "whitespace.pdf",
        sourceType: "pdf",
      });

      const res = await realtimeSessionHandler(req);
      expect(res.status).toBe(400);

      const json = (await res.json()) as RealtimeSessionError;
      expect(json.ok).toBe(false);
      expect(json.code).toBe("INVALID_REQUEST");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns HTTP 400 with code INVALID_REQUEST when text property is missing from request body", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const req = createSessionRequest({
        title: "missing-text.pdf",
        sourceType: "pdf",
      });

      const res = await realtimeSessionHandler(req);
      expect(res.status).toBe(400);

      const json = (await res.json()) as RealtimeSessionError;
      expect(json.ok).toBe(false);
      expect(json.code).toBe("INVALID_REQUEST");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns HTTP 400 with code INVALID_REQUEST when text property is not a string (e.g. number or object)", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const req = createSessionRequest({
        text: 1234567, // Non-string text
        title: "numeric-text.pdf",
        sourceType: "pdf",
      });

      const res = await realtimeSessionHandler(req);
      expect(res.status).toBe(400);

      const json = (await res.json()) as RealtimeSessionError;
      expect(json.ok).toBe(false);
      expect(json.code).toBe("INVALID_REQUEST");
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("AC-05.1 – AC-05.3: Context Builder Unit Isolation (buildSessionInstructions)", () => {
    it("MAX_REALTIME_CONTEXT_CHARS constant is exactly 48,000", () => {
      expect(MAX_REALTIME_CONTEXT_CHARS).toBe(48_000);
    });

    it("buildSessionInstructions: embeds source text, title, and sourceType with grounding rules", () => {
      const result = buildSessionInstructions({
        text: "Sample core facts for prompt formatting.",
        title: "DeepLearning.pdf",
        sourceType: "pdf",
      });

      const instructions = typeof result === "string" ? result : result.instructions;
      expect(instructions).toContain("DeepLearning.pdf");
      expect(instructions).toContain("pdf");
      expect(instructions).toContain("Sample core facts for prompt formatting.");
      expect(instructions).toMatch(/voice|conversational|concise|natural/i);
    });

    it("buildSessionInstructions: leaves text <= 48,000 characters intact and marks isContextTruncated = false", () => {
      const sampleText = "Deterministic text within safe limit.".repeat(50); // ~1,850 chars
      const result = buildSessionInstructions({
        text: sampleText,
        title: "sample.pdf",
        sourceType: "pdf",
      });

      if (typeof result !== "string") {
        expect(result.isContextTruncated).toBe(false);
        expect(result.instructions).toContain(sampleText);
      } else {
        expect(result).toContain(sampleText);
      }
    });

    it("buildSessionInstructions: slices text > 48,000 characters to exactly 48,000 characters and marks isContextTruncated = true", () => {
      const longText = createExactLengthText(60_000, "1234567890");
      const result = buildSessionInstructions({
        text: longText,
        title: "long.pdf",
        sourceType: "pdf",
      });

      const expectedSlice = longText.slice(0, 48_000);
      const excludedSuffix = longText.slice(48_000, 48_050);

      if (typeof result !== "string") {
        expect(result.isContextTruncated).toBe(true);
        expect(result.instructions).toContain(expectedSlice);
        expect(result.instructions).not.toContain(expectedSlice + excludedSuffix);
      } else {
        expect(result).toContain(expectedSlice);
        expect(result).not.toContain(expectedSlice + excludedSuffix);
      }
    });

    it("buildSessionInstructions: provides sensible defaults when title or sourceType are omitted", () => {
      const result = buildSessionInstructions({
        text: "Content with omitted optional metadata.",
      });

      const instructions = typeof result === "string" ? result : result.instructions;
      expect(instructions).toContain("Content with omitted optional metadata.");
      expect(instructions.length).toBeGreaterThan(0);
    });
  });
});
