/**
 * PDF Ingestion Unit Test Suite (Slice 1)
 *
 * Verifies acceptance criteria:
 * - AC-01.1 & AC-01.2: Unified Ingestion Contract (ADR-01)
 * - AC-02.1: 25 MB upload limit enforcement (HTTP 413 FILE_TOO_LARGE) (ADR-02)
 * - AC-02.2: File presence, MIME, empty file, and %PDF- magic header validation (HTTP 400 INVALID_FILE_TYPE) (ADR-02)
 * - AC-02.3: Non-negotiable No-OCR boundary (< 20 non-whitespace characters) (HTTP 422 EMPTY_OR_SCANNED_PDF) (ADR-02)
 * - AC-02.4: Corrupted or password-protected PDF handling (HTTP 422 CORRUPTED_OR_ENCRYPTED_PDF) (ADR-02)
 * - AC-02.5: Multi-page text concatenation in reading order with pageCount (ADR-02)
 * - AC-02.6: Spatial coordinate-aware extraction (column gutter detection, vertical void collapsing) (ADR-02)
 * - AC-12.1: In-memory caching on identical PDF SHA-256 buffer hash (ADR-12)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  MAX_PDF_SIZE_BYTES,
  MIN_PDF_TEXT_CHARS,
  validatePdfBuffer,
  extractPdfText,
  PdfIngestionError,
} from "@/lib/ingest/pdf";
import { POST as pdfHandler } from "@/app/api/ingest/pdf/route";
import { ingestionCache } from "@/lib/ingest/cache";
import type { IngestionSuccess, IngestionError } from "@/types/ingest";
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
} from "../../fixtures/ingest-fixtures";

describe("PDF Ingestion Engine (AC-01, AC-02, AC-12)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    ingestionCache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    ingestionCache.clear();
  });

  describe("AC-02.1 & AC-02.2: Buffer & Header Validation (validatePdfBuffer)", () => {
    it("accepts a buffer starting with '%PDF-' and size <= 25 MB", () => {
      const validBuffer = createValidPdfBuffer();
      const result = validatePdfBuffer(validBuffer);
      expect(result.valid).toBe(true);
    });

    it("AC-02.2: rejects empty (0-byte) buffer with INVALID_FILE_TYPE", () => {
      const emptyBuffer = new Uint8Array(0);
      const result = validatePdfBuffer(emptyBuffer);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.code).toBe("INVALID_FILE_TYPE");
        expect(result.status).toBe(400);
      }
    });

    it("AC-02.2: rejects non-PDF buffer lacking '%PDF-' magic header with INVALID_FILE_TYPE", () => {
      const plainTextBuffer = createNonPdfBuffer();
      const result = validatePdfBuffer(plainTextBuffer);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.code).toBe("INVALID_FILE_TYPE");
        expect(result.status).toBe(400);
      }
    });

    it("AC-02.2: rejects PNG image binary lacking '%PDF-' header with INVALID_FILE_TYPE", () => {
      const pngBuffer = createPngBuffer();
      const result = validatePdfBuffer(pngBuffer);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.code).toBe("INVALID_FILE_TYPE");
        expect(result.status).toBe(400);
      }
    });

    it("AC-02.1: rejects buffer exceeding 25 MB (26,214,400 bytes) with FILE_TOO_LARGE", () => {
      // Create a Uint8Array representing oversized data
      const oversizedBuffer = new Uint8Array(MAX_PDF_SIZE_BYTES + 1);
      // Give it %PDF- header so magic-byte check passes first
      const header = new TextEncoder().encode("%PDF-1.4\n");
      oversizedBuffer.set(header, 0);

      const result = validatePdfBuffer(oversizedBuffer);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.code).toBe("FILE_TOO_LARGE");
        expect(result.status).toBe(413);
        expect(result.retryable).toBe(true);
      }
    });

    it("AC-02.1: accepts exact boundary 25 MB (26,214,400 bytes) buffer", () => {
      const boundaryBuffer = new Uint8Array(MAX_PDF_SIZE_BYTES);
      const header = new TextEncoder().encode("%PDF-1.4\n");
      boundaryBuffer.set(header, 0);

      const result = validatePdfBuffer(boundaryBuffer);
      expect(result.valid).toBe(true);
    });
  });

  describe("AC-02.3 – AC-02.6: PDF Extraction Logic (extractPdfText)", () => {
    it("AC-02.5: extracts text across multi-page PDF in logical reading order and returns pageCount", async () => {
      const p1 = "First page content with comprehensive text.";
      const p2 = "Second page content following logically.";
      const multiPageBuffer = createMultiPagePdfBuffer(p1, p2);

      const result = await extractPdfText(multiPageBuffer);
      expect(result.pageCount).toBe(2);
      expect(result.text).toContain(p1);
      expect(result.text).toContain(p2);
      // Ensure page 1 text appears before page 2 text
      const p1Idx = result.text.indexOf(p1);
      const p2Idx = result.text.indexOf(p2);
      expect(p1Idx).toBeLessThan(p2Idx);
    });

    it("AC-02.3: throws EMPTY_OR_SCANNED_PDF when extracted text has < 20 non-whitespace characters", async () => {
      const scannedBuffer = createScannedOrEmptyPdfBuffer();

      await expect(extractPdfText(scannedBuffer)).rejects.toThrowError(
        expect.objectContaining({
          code: "EMPTY_OR_SCANNED_PDF",
          status: 422,
          retryable: true,
        })
      );
    });

    it("AC-02.4: throws CORRUPTED_OR_ENCRYPTED_PDF when PDF structure is corrupted or unparseable", async () => {
      const corruptedBuffer = createCorruptedPdfBuffer();

      await expect(extractPdfText(corruptedBuffer)).rejects.toThrowError(
        expect.objectContaining({
          code: "CORRUPTED_OR_ENCRYPTED_PDF",
          status: 422,
        })
      );
    });

    describe("Implicit Boundary: PDF Stream Anomalies & Zero-Page Documents", () => {
      it("throws CORRUPTED_OR_ENCRYPTED_PDF when PDF stream is truncated mid-stream without delimiters", async () => {
        const truncatedBuffer = createTruncatedStreamPdfBuffer();

        await expect(extractPdfText(truncatedBuffer)).rejects.toThrowError(
          expect.objectContaining({
            code: "CORRUPTED_OR_ENCRYPTED_PDF",
            status: 422,
          })
        );
      });

      it("rejects zero-page PDF (/Count 0) with EMPTY_OR_SCANNED_PDF or CORRUPTED_OR_ENCRYPTED_PDF", async () => {
        const zeroPageBuffer = createZeroPagePdfBuffer();

        await expect(extractPdfText(zeroPageBuffer)).rejects.toThrowError(
          expect.objectContaining({
            status: 422,
          })
        );
      });
    });

    it("AC-02.6: reconstructs logical column reading order in multi-column layout without horizontal interleaving", async () => {
      // Genuine two-column PDF (page width 612, height 792) with Column 1 at x=72 and Column 2 at x=320 (strictly within 612-wide page).
      // Raw stream order is intentionally interleaved:
      // (Row 1 Col 1 -> Row 1 Col 2 -> Row 2 Col 1 -> Row 2 Col 2 -> Row 3 Col 1 -> Row 3 Col 2).
      // Spatial coordinate-aware extraction must reconstruct logical reading order such that
      // ALL text in Column 1 appears in the extracted output before ANY text in Column 2.
      const twoColBuffer = createTwoColumnPdfBuffer();
      const result = await extractPdfText(twoColBuffer);

      // Verify that all Column 1 lines appear in the extracted output
      for (const line of TWO_COLUMN_TEXT.col1) {
        expect(result.text).toContain(line);
      }

      // Verify that all Column 2 lines appear in the extracted output
      for (const line of TWO_COLUMN_TEXT.col2) {
        expect(result.text).toContain(line);
      }

      // Compute index positions of all Column 1 and Column 2 lines
      const col1Indices = TWO_COLUMN_TEXT.col1.map((line) => result.text.indexOf(line));
      const col2Indices = TWO_COLUMN_TEXT.col2.map((line) => result.text.indexOf(line));

      const maxCol1Index = Math.max(...col1Indices);
      const minCol2Index = Math.min(...col2Indices);

      // Assert that ALL text in Column 1 appears in the extracted output before ANY text in Column 2
      expect(maxCol1Index).toBeLessThan(minCol2Index);

      // Also verify top-to-bottom reading order within each column
      expect(col1Indices[0]).toBeLessThan(col1Indices[1]);
      expect(col1Indices[1]).toBeLessThan(col1Indices[2]);
      expect(col2Indices[0]).toBeLessThan(col2Indices[1]);
      expect(col2Indices[1]).toBeLessThan(col2Indices[2]);
    });

    it("AC-02.6: collapses large vertical voids from embedded images into clean paragraph breaks (\\n\\n)", async () => {
      const textWithVoid = "Top paragraph before image figure.\n\n\n\n\n\n\n\n\nBottom paragraph after image figure.";
      const buffer = createValidPdfBuffer(textWithVoid);

      const result = await extractPdfText(buffer);
      // Should not contain 3 or more consecutive newlines
      expect(result.text).not.toMatch(/\n{3,}/);
    });
  });

  describe("API Route Handler: POST /api/ingest/pdf", () => {
    function createFormDataRequest(file?: File | null): Request {
      const formData = new FormData();
      if (file) {
        formData.append("file", file);
      }
      return new Request("http://localhost/api/ingest/pdf", {
        method: "POST",
        body: formData,
      });
    }

    it("AC-02.2: returns HTTP 400 with INVALID_FILE_TYPE when no file is uploaded in formData", async () => {
      const req = createFormDataRequest(null);
      const res = await pdfHandler(req);
      expect(res.status).toBe(400);

      const json = (await res.json()) as IngestionError;
      expect(json.ok).toBe(false);
      expect(json.code).toBe("INVALID_FILE_TYPE");
      expect(json.retryable).toBe(false);
    });

    it("AC-02.2: returns HTTP 400 with INVALID_FILE_TYPE when uploaded file is empty (0 bytes)", async () => {
      const emptyFile = new File([], "empty.pdf", { type: "application/pdf" });
      const req = createFormDataRequest(emptyFile);

      const res = await pdfHandler(req);
      expect(res.status).toBe(400);

      const json = (await res.json()) as IngestionError;
      expect(json.ok).toBe(false);
      expect(json.code).toBe("INVALID_FILE_TYPE");
    });

    it("AC-02.2: returns HTTP 400 with INVALID_FILE_TYPE when uploaded file has non-PDF MIME type", async () => {
      const txtFile = new File([new TextEncoder().encode("Hello text")], "notes.txt", {
        type: "text/plain",
      });
      const req = createFormDataRequest(txtFile);

      const res = await pdfHandler(req);
      expect(res.status).toBe(400);

      const json = (await res.json()) as IngestionError;
      expect(json.ok).toBe(false);
      expect(json.code).toBe("INVALID_FILE_TYPE");
    });

    it("AC-02.2: returns HTTP 400 with INVALID_FILE_TYPE when file has .pdf extension but lacks %PDF- magic bytes", async () => {
      const fakePdfFile = new File([createNonPdfBuffer()], "fake.pdf", {
        type: "application/pdf",
      });
      const req = createFormDataRequest(fakePdfFile);

      const res = await pdfHandler(req);
      expect(res.status).toBe(400);

      const json = (await res.json()) as IngestionError;
      expect(json.ok).toBe(false);
      expect(json.code).toBe("INVALID_FILE_TYPE");
    });

    describe("Implicit Negative Paths: Multipart Envelope & Field Anomalies", () => {
      it("returns HTTP 400 with INVALID_FILE_TYPE when file is uploaded under wrong field key ('document' instead of 'file')", async () => {
        const formData = new FormData();
        const validFile = new File([createValidPdfBuffer()], "doc.pdf", { type: "application/pdf" });
        formData.append("document", validFile); // Wrong field name

        const req = new Request("http://localhost/api/ingest/pdf", {
          method: "POST",
          body: formData,
        });

        const res = await pdfHandler(req);
        expect(res.status).toBe(400);

        const json = (await res.json()) as IngestionError;
        expect(json.ok).toBe(false);
        expect(json.code).toBe("INVALID_FILE_TYPE");
      });

      it("returns HTTP 400 with INVALID_FILE_TYPE when request body is non-multipart (e.g., application/json or empty) without throwing unhandled rejection", async () => {
        const req = new Request("http://localhost/api/ingest/pdf", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file: "base64..." }),
        });

        const res = await pdfHandler(req);
        expect(res.status).toBe(400);

        const json = (await res.json()) as IngestionError;
        expect(json.ok).toBe(false);
        expect(json.code).toBe("INVALID_FILE_TYPE");
      });
    });

    it("AC-02.1: returns HTTP 413 with FILE_TOO_LARGE and retryable: true when file exceeds 25 MB", async () => {
      const oversizedFile = createOversizedPdfFile();
      const req = createFormDataRequest(oversizedFile);

      // Properly mock req.formData() returning the genuine oversized file (size: 26,214,401 bytes)
      // so production code can perform a real file.size / buffer length check without special-casing
      const mockFormData = new FormData();
      mockFormData.append("file", oversizedFile);
      vi.spyOn(req, "formData").mockResolvedValue(mockFormData);

      const res = await pdfHandler(req);
      expect(res.status).toBe(413);

      const json = (await res.json()) as IngestionError;
      expect(json.ok).toBe(false);
      expect(json.code).toBe("FILE_TOO_LARGE");
      expect(json.retryable).toBe(true);
      expect(json.message).toMatch(/25\s*MB/i);
    });

    it("AC-02.3: returns HTTP 422 with EMPTY_OR_SCANNED_PDF when extracted text has < 20 non-whitespace characters", async () => {
      const scannedBuffer = createScannedOrEmptyPdfBuffer();
      const scannedFile = new File([scannedBuffer], "scanned.pdf", { type: "application/pdf" });
      const req = createFormDataRequest(scannedFile);

      const res = await pdfHandler(req);
      expect(res.status).toBe(422);

      const json = (await res.json()) as IngestionError;
      expect(json.ok).toBe(false);
      expect(json.code).toBe("EMPTY_OR_SCANNED_PDF");
      expect(json.retryable).toBe(true);
      expect(json.message).toMatch(/OCR is not supported/i);
    });

    it("AC-02.4: returns HTTP 422 with CORRUPTED_OR_ENCRYPTED_PDF when PDF parsing throws an exception", async () => {
      const corruptedBuffer = createCorruptedPdfBuffer();
      const corruptedFile = new File([corruptedBuffer], "corrupted.pdf", {
        type: "application/pdf",
      });
      const req = createFormDataRequest(corruptedFile);

      const res = await pdfHandler(req);
      expect(res.status).toBe(422);

      const json = (await res.json()) as IngestionError;
      expect(json.ok).toBe(false);
      expect(json.code).toBe("CORRUPTED_OR_ENCRYPTED_PDF");
    });

    it("AC-01.1 & AC-02.5: returns HTTP 200 with IngestionSuccess on valid multi-page PDF upload", async () => {
      const validBuffer = createValidPdfBuffer("This is a valid extracted document with plenty of text characters.");
      const validFile = new File([validBuffer], "document.pdf", { type: "application/pdf" });
      const req = createFormDataRequest(validFile);

      const res = await pdfHandler(req);
      expect(res.status).toBe(200);

      const json = (await res.json()) as IngestionSuccess;
      expect(json.ok).toBe(true);
      expect(json.sourceType).toBe("pdf");
      expect(json.title).toBe("document.pdf");
      expect(typeof json.text).toBe("string");
      expect(json.text.length).toBeGreaterThanOrEqual(MIN_PDF_TEXT_CHARS);
      expect(json.charCount).toBe(json.text.length);
      expect(json.estimatedTokens).toBe(Math.ceil(json.text.length / 4));
      expect(json.metadata.pageCount).toBeGreaterThanOrEqual(1);
    });

    it("AC-12.1: returns cached result on repeat upload of identical PDF (matching SHA-256 hash)", async () => {
      const validBuffer = createValidPdfBuffer("Deterministic content for SHA-256 repeat upload cache verification.");
      const file1 = new File([validBuffer], "sample.pdf", { type: "application/pdf" });
      const file2 = new File([validBuffer], "sample_copy.pdf", { type: "application/pdf" });

      const res1 = await pdfHandler(createFormDataRequest(file1));
      expect(res1.status).toBe(200);
      const json1 = (await res1.json()) as IngestionSuccess;

      const res2 = await pdfHandler(createFormDataRequest(file2));
      expect(res2.status).toBe(200);
      const json2 = (await res2.json()) as IngestionSuccess;

      expect(json2.text).toBe(json1.text);
      expect(json2.charCount).toBe(json1.charCount);
    });

    it("never truncates extracted text at ingestion even when text.length > 48,000 (Option 2B)", async () => {
      // Simulate an extracted text from a 100-page PDF with > 48,000 chars
      const hugeText = "Large document paragraph for full-text preview verification. ".repeat(1200); // ~73,000 chars
      const hugeBuffer = createValidPdfBuffer(hugeText);
      const hugeFile = new File([hugeBuffer], "huge-document.pdf", { type: "application/pdf" });

      const res = await pdfHandler(createFormDataRequest(hugeFile));
      expect(res.status).toBe(200);

      const json = (await res.json()) as IngestionSuccess;
      expect(json.ok).toBe(true);
      expect(json.charCount).toBeGreaterThan(48_000);
      expect(json.text.length).toBe(json.charCount); // Full untruncated text returned at ingestion!
    });
  });
});
