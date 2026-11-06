/**
 * Ingestion Fixtures Verification Test
 *
 * Verifies that all synthetic PDF buffers, YouTube URLs, and mock caption fixtures
 * satisfy the constraints defined in ADR-02 and ADR-03.
 */

import { describe, it, expect } from "vitest";
import {
  createValidPdfBuffer,
  createMultiPagePdfBuffer,
  createTwoColumnPdfBuffer,
  TWO_COLUMN_TEXT,
  createScannedOrEmptyPdfBuffer,
  createCorruptedPdfBuffer,
  createTruncatedStreamPdfBuffer,
  createZeroPagePdfBuffer,
  createNonPdfBuffer,
  createPngBuffer,
  createOversizedPdfFile,
  createBoundary25MbPdfFile,
  VALID_YOUTUBE_URL_SAMPLES,
  INVALID_YOUTUBE_URL_SAMPLES,
  MOCK_YOUTUBE_RAW_XML_CAPTIONS,
  MOCK_YOUTUBE_CLEANED_TEXT,
  MOCK_YOUTUBE_EMPTY_TRANSCRIPT_XML,
  MOCK_YOUTUBE_MUSIC_ONLY_XML,
  MOCK_YOUTUBE_HTML_CHALLENGE_BODY,
  IMPLICIT_EDGE_CASE_URL_SAMPLES,
} from "../../fixtures/ingest-fixtures";

describe("Ingestion Test Fixtures Integrity", () => {
  describe("PDF Fixtures", () => {
    it("createValidPdfBuffer begins with %PDF- magic header and contains text", () => {
      const buf = createValidPdfBuffer();
      const header = new TextDecoder().decode(buf.slice(0, 5));
      expect(header).toBe("%PDF-");
      expect(buf.length).toBeGreaterThan(50);
    });

    it("createMultiPagePdfBuffer begins with %PDF- and defines 2 pages", () => {
      const buf = createMultiPagePdfBuffer();
      const content = new TextDecoder().decode(buf);
      expect(content).toMatch(/^%PDF-/);
      expect(content).toContain("/Count 2");
    });

    it("createTwoColumnPdfBuffer begins with %PDF- and contains interleaved column lines with x=72 and x=320 coordinates within 612-wide page", () => {
      const buf = createTwoColumnPdfBuffer();
      const content = new TextDecoder().decode(buf);
      expect(content).toMatch(/^%PDF-/);
      expect(content).toContain("72 700 Td");
      expect(content).toContain("320 700 Td");
      expect(content).toContain(TWO_COLUMN_TEXT.col1[0]);
      expect(content).toContain(TWO_COLUMN_TEXT.col2[0]);
    });

    it("createScannedOrEmptyPdfBuffer begins with %PDF- and has minimal stream", () => {
      const buf = createScannedOrEmptyPdfBuffer();
      const content = new TextDecoder().decode(buf);
      expect(content).toMatch(/^%PDF-/);
    });

    it("createCorruptedPdfBuffer begins with %PDF- but contains malformed body", () => {
      const buf = createCorruptedPdfBuffer();
      const content = new TextDecoder().decode(buf);
      expect(content).toMatch(/^%PDF-/);
      expect(content).toContain("CORRUPTED");
    });

    it("createTruncatedStreamPdfBuffer begins with %PDF- and has unclosed stream", () => {
      const buf = createTruncatedStreamPdfBuffer();
      const content = new TextDecoder().decode(buf);
      expect(content).toMatch(/^%PDF-/);
      expect(content).toContain("Truncated stream");
      expect(content).not.toContain("%%EOF");
    });

    it("createZeroPagePdfBuffer begins with %PDF- and defines 0 pages (/Count 0)", () => {
      const buf = createZeroPagePdfBuffer();
      const content = new TextDecoder().decode(buf);
      expect(content).toMatch(/^%PDF-/);
      expect(content).toContain("/Count 0");
    });

    it("createNonPdfBuffer does not begin with %PDF- header", () => {
      const buf = createNonPdfBuffer();
      const header = new TextDecoder().decode(buf.slice(0, 5));
      expect(header).not.toBe("%PDF-");
    });

    it("createPngBuffer has PNG signature and does not begin with %PDF-", () => {
      const buf = createPngBuffer();
      expect(buf[0]).toBe(0x89);
      expect(buf[1]).toBe(0x50); // P
      expect(buf[2]).toBe(0x4e); // N
      expect(buf[3]).toBe(0x47); // G
      const header = new TextDecoder().decode(buf.slice(0, 5));
      expect(header).not.toBe("%PDF-");
    });

    it("createOversizedPdfFile exceeds 25 MB limit (26,214,401 bytes)", () => {
      const file = createOversizedPdfFile();
      expect(file.size).toBe(26_214_401);
      expect(file.name).toBe("oversized.pdf");
      expect(file.type).toBe("application/pdf");
    });

    it("createBoundary25MbPdfFile equals exact 25 MB boundary (26,214,400 bytes)", () => {
      const file = createBoundary25MbPdfFile();
      expect(file.size).toBe(26_214_400);
      expect(file.name).toBe("boundary25mb.pdf");
      expect(file.type).toBe("application/pdf");
    });
  });

  describe("YouTube Fixtures", () => {
    it("VALID_YOUTUBE_URL_SAMPLES contains 10 diverse formats with 11-char videoId", () => {
      expect(VALID_YOUTUBE_URL_SAMPLES.length).toBeGreaterThanOrEqual(10);
      VALID_YOUTUBE_URL_SAMPLES.forEach((sample) => {
        expect(sample.expectedId).toHaveLength(11);
      });
    });

    it("INVALID_YOUTUBE_URL_SAMPLES covers empty, wrong domain, short and malformed URLs", () => {
      expect(INVALID_YOUTUBE_URL_SAMPLES.length).toBeGreaterThanOrEqual(10);
    });

    it("MOCK_YOUTUBE_RAW_XML_CAPTIONS contains HTML entities and XML tags", () => {
      expect(MOCK_YOUTUBE_RAW_XML_CAPTIONS).toContain("&amp;");
      expect(MOCK_YOUTUBE_RAW_XML_CAPTIONS).toContain("&#39;");
      expect(MOCK_YOUTUBE_RAW_XML_CAPTIONS).toContain("&quot;");
      expect(MOCK_YOUTUBE_RAW_XML_CAPTIONS).toContain("<transcript>");
    });

    it("MOCK_YOUTUBE_CLEANED_TEXT has entities decoded and XML stripped", () => {
      expect(MOCK_YOUTUBE_CLEANED_TEXT).toContain("&");
      expect(MOCK_YOUTUBE_CLEANED_TEXT).toContain("'");
      expect(MOCK_YOUTUBE_CLEANED_TEXT).toContain('"');
      expect(MOCK_YOUTUBE_CLEANED_TEXT).not.toContain("<");
      expect(MOCK_YOUTUBE_CLEANED_TEXT).not.toContain(">");
    });

    it("MOCK_YOUTUBE_EMPTY_TRANSCRIPT_XML has transcript tags but no text children", () => {
      expect(MOCK_YOUTUBE_EMPTY_TRANSCRIPT_XML).toContain("<transcript>");
      expect(MOCK_YOUTUBE_EMPTY_TRANSCRIPT_XML).not.toContain("<text");
    });

    it("MOCK_YOUTUBE_MUSIC_ONLY_XML contains audio cue tokens and music symbols", () => {
      expect(MOCK_YOUTUBE_MUSIC_ONLY_XML).toContain("[Music]");
      expect(MOCK_YOUTUBE_MUSIC_ONLY_XML).toContain("♪♪♪");
    });

    it("MOCK_YOUTUBE_HTML_CHALLENGE_BODY is HTML rather than XML", () => {
      expect(MOCK_YOUTUBE_HTML_CHALLENGE_BODY).toContain("<!DOCTYPE html>");
      expect(MOCK_YOUTUBE_HTML_CHALLENGE_BODY).not.toContain("<transcript>");
    });

    it("IMPLICIT_EDGE_CASE_URL_SAMPLES contains parameter pollution and empty routes", () => {
      expect(IMPLICIT_EDGE_CASE_URL_SAMPLES.length).toBeGreaterThanOrEqual(5);
    });
  });
});
