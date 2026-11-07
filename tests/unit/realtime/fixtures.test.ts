/**
 * Realtime Fixture Verification Tests (Slice 2)
 *
 * Verifies that mock payloads and fixture generators behave predictably
 * and meet the boundary conditions required by AC-04 and AC-05.
 */

import { describe, it, expect } from "vitest";
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

describe("Realtime Fixtures & Helper Generators (Slice 2)", () => {
  describe("createExactLengthText", () => {
    it("generates an empty string when length is 0 or negative", () => {
      expect(createExactLengthText(0)).toBe("");
      expect(createExactLengthText(-5)).toBe("");
    });

    it("generates exact string length for arbitrary positive values", () => {
      const text100 = createExactLengthText(100);
      expect(text100.length).toBe(100);

      const text48k = createExactLengthText(48_000, "ABCDEFGHIJ");
      expect(text48k.length).toBe(48_000);
      expect(text48k.startsWith("ABCDEFGHIJ")).toBe(true);

      const text48001 = createExactLengthText(48_001, "XYZ");
      expect(text48001.length).toBe(48_001);
    });

    it("handles non-divisible length patterns without character truncation issues", () => {
      const text7 = createExactLengthText(7, "ABC");
      expect(text7).toBe("ABCABCA");
      expect(text7.length).toBe(7);
    });
  });

  describe("createSessionRequest", () => {
    it("creates a Request with POST method and application/json Content-Type", async () => {
      const req = createSessionRequest({ text: "Hello", title: "doc.pdf" });
      expect(req.method).toBe("POST");
      expect(req.headers.get("Content-Type")).toBe("application/json");

      const body = await req.json();
      expect(body.text).toBe("Hello");
      expect(body.title).toBe("doc.pdf");
    });

    it("passes raw strings directly into body without double-encoding", async () => {
      const rawBody = "{ malformed: json }";
      const req = createSessionRequest(rawBody);
      const text = await req.text();
      expect(text).toBe(rawBody);
    });
  });

  describe("Mock Payload Shapes", () => {
    it("MOCK_OPENAI_SESSION_RESPONSE conforms to OpenAI Realtime session schema", () => {
      expect(MOCK_OPENAI_SESSION_RESPONSE.id).toBeDefined();
      expect(MOCK_OPENAI_SESSION_RESPONSE.model).toBe("gpt-4o-realtime-preview");
      expect(MOCK_OPENAI_SESSION_RESPONSE.modalities).toEqual(["audio", "text"]);
      expect(MOCK_OPENAI_SESSION_RESPONSE.voice).toBe("alloy");
      expect(MOCK_OPENAI_SESSION_RESPONSE.input_audio_transcription.model).toBe("whisper-1");
      expect(MOCK_OPENAI_SESSION_RESPONSE.turn_detection.type).toBe("server_vad");
      expect(MOCK_OPENAI_SESSION_RESPONSE.turn_detection.interrupt_response).toBe(true);
      expect(MOCK_OPENAI_SESSION_RESPONSE.client_secret.value).toBeDefined();
      expect(MOCK_OPENAI_SESSION_RESPONSE.client_secret.expires_at).toBeGreaterThan(0);
    });

    it("MOCK_OPENAI_CUSTOM_MODEL_RESPONSE contains custom model identifier", () => {
      expect(MOCK_OPENAI_CUSTOM_MODEL_RESPONSE.model).toBe("gpt-4o-realtime-preview-2024-12-17");
      expect(MOCK_OPENAI_CUSTOM_MODEL_RESPONSE.client_secret.value).toBeDefined();
    });

    it("MOCK_OPENAI error fixtures conform to OpenAI error schemas", () => {
      expect(MOCK_OPENAI_401_UNAUTHORIZED.error.code).toBe("invalid_api_key");
      expect(MOCK_OPENAI_429_RATE_LIMIT.error.code).toBe("rate_limit_exceeded");
      expect(MOCK_OPENAI_500_SERVER_ERROR.error.type).toBe("server_error");
      expect(MOCK_OPENAI_400_BAD_PARAM.error.code).toBe("unknown_parameter");
      expect(HTML_502_BAD_GATEWAY).toContain("502 Bad Gateway");
    });
  });
});
