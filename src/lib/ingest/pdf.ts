/**
 * Server-Side Spatial PDF Extraction & Non-Negotiable No-OCR Boundary (ADR-02 / AC-02).
 *
 * Implements:
 * - Strict 25 MB size boundary and %PDF- magic header validation (AC-02.1, AC-02.2)
 * - Spatial coordinate-aware text extraction via pdfjs-dist with multi-column vertical gutter detection
 *   (reading Column 1 top-to-bottom before Column 2) and vertical void collapsing (AC-02.5, AC-02.6)
 * - Non-negotiable No-OCR enforcement (< 20 non-whitespace chars -> EMPTY_OR_SCANNED_PDF) (AC-02.3)
 * - Corrupted, truncated, and encrypted PDF detection (AC-02.4)
 */

import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
// @ts-expect-error - pdfjs-dist does not bundle TypeScript declaration for pdf.worker.mjs
import * as pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import type { IngestionErrorCode } from "@/types/ingest";

// Ensure pdfjs-dist fake worker is configured for Node.js server environments
if (typeof globalThis !== "undefined") {
  const g = globalThis as unknown as { pdfjsWorker?: unknown };
  if (!g.pdfjsWorker) {
    g.pdfjsWorker = pdfjsWorker;
  }
}
if (pdfjsLib.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "pdfjs-dist/legacy/build/pdf.worker.mjs";
}

/**
 * Resolves absolute filesystem paths to pdfjs-dist standard fonts and cmaps directories
 * with trailing slashes, required for Node.js server environments.
 */
function getStandardFontAndCMapUrls(): {
  standardFontDataUrl?: string;
  cMapUrl?: string;
} {
  try {
    let baseDir: string | undefined;

    try {
      const req = createRequire(path.join(process.cwd(), "package.json"));
      const pkgPath = req.resolve("pdfjs-dist/package.json");
      baseDir = path.dirname(pkgPath);
    } catch {
      try {
        const req = createRequire(import.meta.url);
        const pkgPath = req.resolve("pdfjs-dist/package.json");
        baseDir = path.dirname(pkgPath);
      } catch {
        const fallback = path.join(process.cwd(), "node_modules", "pdfjs-dist");
        if (fs.existsSync(fallback)) {
          baseDir = fallback;
        }
      }
    }

    if (baseDir) {
      const fontsDir = path.join(baseDir, "standard_fonts").split(path.sep).join("/") + "/";
      const cmapsDir = path.join(baseDir, "cmaps").split(path.sep).join("/") + "/";
      return {
        standardFontDataUrl: fontsDir,
        cMapUrl: cmapsDir,
      };
    }
  } catch {
    // Gracefully ignore if asset paths cannot be located
  }
  return {};
}

export const MAX_PDF_SIZE_BYTES = 26_214_400; // 25 MB (25 * 1024 * 1024)
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

export class PdfIngestionError extends Error {
  code: IngestionErrorCode;
  status: number;
  retryable: boolean;

  constructor(
    code: IngestionErrorCode,
    message: string,
    status: number = 422,
    retryable: boolean = false
  ) {
    super(message);
    this.name = "PdfIngestionError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export type PdfExtractionResult = {
  text: string;
  pageCount: number;
};

export interface SpatialTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const PDF_MAGIC_BYTES = [0x25, 0x50, 0x44, 0x46, 0x2d] as const; // "%PDF-"

/**
 * Validates that a buffer is non-empty, starts with the '%PDF-' magic header,
 * and does not exceed the 25 MB upload limit.
 */
export function validatePdfBuffer(buffer: Uint8Array): PdfValidationResult {
  if (!buffer || !(buffer instanceof Uint8Array) || buffer.byteLength === 0) {
    return {
      valid: false,
      code: "INVALID_FILE_TYPE",
      message: "Uploaded PDF file is empty or missing. Please select a valid PDF document.",
      status: 400,
      retryable: false,
    };
  }

  if (buffer.byteLength < PDF_MAGIC_BYTES.length) {
    return {
      valid: false,
      code: "INVALID_FILE_TYPE",
      message: "Invalid file format: file does not begin with the %PDF- header.",
      status: 400,
      retryable: false,
    };
  }

  for (let i = 0; i < PDF_MAGIC_BYTES.length; i++) {
    if (buffer[i] !== PDF_MAGIC_BYTES[i]) {
      return {
        valid: false,
        code: "INVALID_FILE_TYPE",
        message: "Invalid file format: missing %PDF- magic header.",
        status: 400,
        retryable: false,
      };
    }
  }

  if (buffer.byteLength > MAX_PDF_SIZE_BYTES) {
    return {
      valid: false,
      code: "FILE_TOO_LARGE",
      message: "PDF file exceeds the maximum allowed size of 25 MB.",
      status: 413,
      retryable: true,
    };
  }

  return { valid: true };
}

/**
 * Reconstructs logical reading order for items within a single column:
 * - Sorts items top-to-bottom (descending Y in PDF coordinate space) and left-to-right
 * - Merges items occupying the same line into a unified string
 * - Collapses large vertical voids (from images/figures) into clean paragraph breaks (\n\n)
 *   while guaranteeing that no runs of 3+ consecutive newlines are emitted.
 */
function formatSingleColumnItems(items: SpatialTextItem[]): string {
  if (items.length === 0) {
    return "";
  }

  const sorted = [...items].sort((a, b) => {
    const lineTol = Math.max(a.height, b.height) * 0.5;
    if (Math.abs(a.y - b.y) <= lineTol) {
      return a.x - b.x;
    }
    return b.y - a.y;
  });

  const lines: { y: number; height: number; text: string }[] = [];
  for (const item of sorted) {
    const trimmed = item.text.trim();
    if (!trimmed) continue;

    const last = lines[lines.length - 1];
    const lineTol = last ? Math.max(last.height, item.height) * 0.5 : 0;
    if (last && Math.abs(last.y - item.y) <= lineTol) {
      last.text = `${last.text} ${trimmed}`.replace(/\s+/g, " ");
    } else {
      lines.push({ y: item.y, height: item.height, text: trimmed });
    }
  }

  if (lines.length === 0) {
    return "";
  }

  let text = lines[0].text;
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1];
    const curr = lines[i];
    const verticalGap = prev.y - curr.y;
    const voidThreshold = Math.max(prev.height, curr.height) * 2.2;
    if (verticalGap > voidThreshold) {
      text += `\n\n${curr.text}`;
    } else {
      text += `\n${curr.text}`;
    }
  }

  return text.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Reconstructs logical human reading order on a page from spatial text items (AC-02.6):
 * - Detects multi-column vertical gutters and reads Column 1 top-to-bottom before Column 2
 * - Collapses large vertical voids caused by embedded images into clean paragraph breaks (\n\n)
 */
export function reconstructSpatialPageText(
  items: SpatialTextItem[],
  pageWidth: number = 612
): string {
  if (items.length === 0) {
    return "";
  }

  const validItems = items.filter((it) => it.text.trim().length > 0);
  if (validItems.length === 0) {
    return "";
  }

  const midX = pageWidth / 2;
  const gutterLeft = pageWidth * 0.4;
  const gutterRight = pageWidth * 0.6;

  const fullWidthItems: SpatialTextItem[] = [];
  const leftColItems: SpatialTextItem[] = [];
  const rightColItems: SpatialTextItem[] = [];

  for (const item of validItems) {
    const itemRight = item.x + item.width;
    const spansGutter = item.x < gutterLeft && itemRight > gutterRight;
    const isVeryWide = item.width > pageWidth * 0.65;

    if (spansGutter || isVeryWide) {
      fullWidthItems.push(item);
    } else if (item.x + item.width / 2 < midX) {
      leftColItems.push(item);
    } else {
      rightColItems.push(item);
    }
  }

  const isTwoColumn = leftColItems.length >= 2 && rightColItems.length >= 2;

  if (!isTwoColumn) {
    return formatSingleColumnItems(validItems);
  }

  const maxY = Math.max(...[...leftColItems, ...rightColItems].map((it) => it.y));
  const minY = Math.min(...[...leftColItems, ...rightColItems].map((it) => it.y));

  const topHeaders = fullWidthItems.filter((it) => it.y > maxY);
  const bottomFooters = fullWidthItems.filter((it) => it.y < minY);
  const midFullWidth = fullWidthItems.filter((it) => it.y <= maxY && it.y >= minY);

  const sections: string[] = [];
  if (topHeaders.length > 0) sections.push(formatSingleColumnItems(topHeaders));
  sections.push(formatSingleColumnItems(leftColItems));
  if (midFullWidth.length > 0) sections.push(formatSingleColumnItems(midFullWidth));
  sections.push(formatSingleColumnItems(rightColItems));
  if (bottomFooters.length > 0) sections.push(formatSingleColumnItems(bottomFooters));

  return sections.filter(Boolean).join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

type PageOperatorList = Awaited<ReturnType<pdfjsLib.PDFPageProxy["getOperatorList"]>>;

/**
 * Extracts raw glyph text from standard PDF.js operator lists when long unwrapped text
 * lines extend beyond the page width and are clipped by pdfjs-dist's internal viewBox filter.
 */
function extractTextFromOperatorList(opList: PageOperatorList): string {
  const parts: string[] = [];
  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i];
    if (
      fn === pdfjsLib.OPS.showText ||
      fn === pdfjsLib.OPS.showSpacedText ||
      fn === pdfjsLib.OPS.nextLineShowText ||
      fn === pdfjsLib.OPS.nextLineSetSpacingShowText
    ) {
      if (fn === pdfjsLib.OPS.nextLineShowText || fn === pdfjsLib.OPS.nextLineSetSpacingShowText) {
        parts.push("\n");
      }
      const glyphs = args[0];
      if (Array.isArray(glyphs)) {
        for (const g of glyphs) {
          if (
            typeof g === "object" &&
            g !== null &&
            "unicode" in g &&
            typeof (g as { unicode: unknown }).unicode === "string"
          ) {
            parts.push((g as { unicode: string }).unicode);
          } else if (typeof g === "string") {
            parts.push(g);
          }
        }
      }
    }
  }
  return parts.join("").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Extracts text and pageCount from a validated PDF buffer using pdfjs-dist spatial
 * coordinate-aware extraction and enforcing the non-negotiable No-OCR boundary.
 */
export async function extractPdfText(buffer: Uint8Array): Promise<PdfExtractionResult> {
  const validation = validatePdfBuffer(buffer);
  if (!validation.valid) {
    throw new PdfIngestionError(
      validation.code,
      validation.message,
      validation.status,
      validation.retryable
    );
  }

  // Reject truncated PDFs that lack an %%EOF marker or have an unclosed stream.
  // Search within the final 8 KB (or entire buffer) to accommodate incremental updates and trailing whitespace.
  const tailOffset = Math.max(0, buffer.byteLength - 8192);
  const tailText = new TextDecoder("latin1").decode(buffer.subarray(tailOffset));
  if (!tailText.includes("%%EOF")) {
    throw new PdfIngestionError(
      "CORRUPTED_OR_ENCRYPTED_PDF",
      "The PDF file is truncated or missing its EOF marker.",
      422,
      false
    );
  }

  let doc: pdfjsLib.PDFDocumentProxy | undefined;

  try {
    // Clone buffer bytes into a fresh Uint8Array so pdfjs-dist worker transfer does not
    // mutate or detach the caller's underlying ArrayBuffer.
    const bufferCopy = new Uint8Array(buffer.byteLength);
    bufferCopy.set(buffer);

    const assetUrls = getStandardFontAndCMapUrls();
    const loadingTask = pdfjsLib.getDocument({
      data: bufferCopy,
      useSystemFonts: true,
      disableFontFace: true,
      verbosity: 0,
      cMapPacked: true,
      ...(assetUrls.standardFontDataUrl ? { standardFontDataUrl: assetUrls.standardFontDataUrl } : {}),
      ...(assetUrls.cMapUrl ? { cMapUrl: assetUrls.cMapUrl } : {}),
    });
    doc = await loadingTask.promise;
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const errName = err instanceof Error ? err.name : "";

    if (errName === "PasswordException" || /password|encrypt/i.test(errMsg)) {
      throw new PdfIngestionError(
        "CORRUPTED_OR_ENCRYPTED_PDF",
        "This PDF is password-protected or encrypted and cannot be extracted.",
        422,
        false
      );
    }

    throw new PdfIngestionError(
      "CORRUPTED_OR_ENCRYPTED_PDF",
      "The PDF file is corrupted or contains an invalid structure.",
      422,
      false
    );
  }

  try {
    if (!doc || doc.numPages === 0) {
      throw new PdfIngestionError(
        "EMPTY_OR_SCANNED_PDF",
        "This PDF contains 0 pages and no extractable text. OCR is not supported; please upload a text-based PDF.",
        422,
        true
      );
    }

    const pageTexts: string[] = [];

    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      let page: pdfjsLib.PDFPageProxy;
      try {
        page = await doc.getPage(pageNum);
      } catch {
        throw new PdfIngestionError(
          "CORRUPTED_OR_ENCRYPTED_PDF",
          `Failed to load page ${pageNum}. The PDF structure may be corrupted.`,
          422,
          false
        );
      }

      const viewport = page.getViewport({ scale: 1.0 });
      let textContent: Awaited<ReturnType<pdfjsLib.PDFPageProxy["getTextContent"]>>;
      try {
        textContent = await page.getTextContent();
      } catch {
        throw new PdfIngestionError(
          "CORRUPTED_OR_ENCRYPTED_PDF",
          `Failed to extract text from page ${pageNum}.`,
          422,
          false
        );
      }

      const spatialItems: SpatialTextItem[] = [];

      for (const item of textContent.items) {
        if ("str" in item && typeof item.str === "string") {
          spatialItems.push({
            text: item.str,
            x: item.transform[4],
            y: item.transform[5],
            width: item.width,
            height: Math.abs(item.transform[3]) || item.height || 12,
          });
        }
      }

      let pageText = reconstructSpatialPageText(spatialItems, viewport.width);

      // In case long unwrapped text lines extend past page boundaries and are clipped by
      // pdfjs-dist's internal viewBox filter, recover complete text from the operator list
      // only when the operator list contains significantly more substantive text.
      try {
        const opList = await page.getOperatorList();
        const opText = extractTextFromOperatorList(opList);
        const pageNonWs = pageText.replace(/\s+/g, "").length;
        const opNonWs = opText.replace(/\s+/g, "").length;
        if (opNonWs > Math.max(pageNonWs * 1.5, pageNonWs + 200)) {
          pageText = opText;
        }
      } catch {
        // Gracefully ignore operator list decoding failures
      }

      if (pageText.length > 0) {
        pageTexts.push(pageText);
      }
    }

    const fullText = pageTexts
      .join("\n\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    const nonWhitespaceCount = fullText.replace(/\s+/g, "").length;
    if (nonWhitespaceCount < MIN_PDF_TEXT_CHARS) {
      throw new PdfIngestionError(
        "EMPTY_OR_SCANNED_PDF",
        "This PDF contains no extractable text (it may be a scanned image). OCR is not supported; please upload a text-based PDF.",
        422,
        true
      );
    }

    return {
      text: fullText,
      pageCount: doc.numPages,
    };
  } finally {
    if (doc) {
      try {
        await doc.destroy();
      } catch {
        // Ignore destruction errors
      }
    }
  }
}
