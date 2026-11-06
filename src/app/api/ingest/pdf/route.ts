/**
 * POST /api/ingest/pdf Route Handler (ADR-01, ADR-02, ADR-12).
 */

import {
  MAX_PDF_SIZE_BYTES,
  validatePdfBuffer,
  extractPdfText,
  PdfIngestionError,
} from "@/lib/ingest/pdf";
import { ingestionCache, computeSha256 } from "@/lib/ingest/cache";
import type { IngestionError, IngestionSuccess } from "@/types/ingest";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  // Early check: Content-Length header rejection before buffering entire body
  const contentLengthHeader = req.headers.get("content-length");
  if (contentLengthHeader) {
    const parsedLength = Number.parseInt(contentLengthHeader, 10);
    if (!Number.isNaN(parsedLength) && parsedLength > MAX_PDF_SIZE_BYTES) {
      return Response.json(
        {
          ok: false,
          code: "FILE_TOO_LARGE",
          message: "PDF file exceeds the maximum allowed size of 25 MB.",
          retryable: true,
        } satisfies IngestionError,
        { status: 413 }
      );
    }
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return Response.json(
      {
        ok: false,
        code: "INVALID_FILE_TYPE",
        message: "Invalid multipart/form-data payload. Please upload a PDF file under the 'file' field.",
        retryable: false,
      } satisfies IngestionError,
      { status: 400 }
    );
  }

  const fileEntry = formData.get("file");
  if (!fileEntry || typeof fileEntry === "string" || !(fileEntry instanceof Blob)) {
    return Response.json(
      {
        ok: false,
        code: "INVALID_FILE_TYPE",
        message: "No PDF file found under the 'file' form field.",
        retryable: false,
      } satisfies IngestionError,
      { status: 400 }
    );
  }

  const fileName = "name" in fileEntry && typeof fileEntry.name === "string" && fileEntry.name
    ? fileEntry.name
    : "document.pdf";

  if (fileEntry.size === 0) {
    return Response.json(
      {
        ok: false,
        code: "INVALID_FILE_TYPE",
        message: "The uploaded PDF file is empty (0 bytes).",
        retryable: false,
      } satisfies IngestionError,
      { status: 400 }
    );
  }

  if (fileEntry.size > MAX_PDF_SIZE_BYTES) {
    return Response.json(
      {
        ok: false,
        code: "FILE_TOO_LARGE",
        message: "PDF file exceeds the maximum allowed size of 25 MB.",
        retryable: true,
      } satisfies IngestionError,
      { status: 413 }
    );
  }

  const mimeType = (fileEntry.type || "").toLowerCase();
  const hasPdfMime = mimeType === "application/pdf" || mimeType === "application/x-pdf";
  const isOctetStream = mimeType === "application/octet-stream" || mimeType === "binary/octet-stream";
  const hasPdfExt = fileName.toLowerCase().endsWith(".pdf");

  // Valid if explicit PDF MIME, or .pdf extension with octet-stream / unspecified MIME
  const isValidPdfType = hasPdfMime || (hasPdfExt && (!mimeType || isOctetStream || hasPdfMime));

  if (!isValidPdfType) {
    return Response.json(
      {
        ok: false,
        code: "INVALID_FILE_TYPE",
        message: "Unsupported file type. Only PDF files (application/pdf) are accepted.",
        retryable: false,
      } satisfies IngestionError,
      { status: 400 }
    );
  }

  let buffer: Uint8Array;
  try {
    const arrayBuffer = await fileEntry.arrayBuffer();
    buffer = new Uint8Array(arrayBuffer);
  } catch {
    return Response.json(
      {
        ok: false,
        code: "INVALID_FILE_TYPE",
        message: "Failed to read uploaded PDF file bytes.",
        retryable: false,
      } satisfies IngestionError,
      { status: 400 }
    );
  }

  const validation = validatePdfBuffer(buffer);
  if (!validation.valid) {
    return Response.json(
      {
        ok: false,
        code: validation.code,
        message: validation.message,
        retryable: validation.retryable,
      } satisfies IngestionError,
      { status: validation.status }
    );
  }

  const sha256Hash = await computeSha256(buffer);
  const cacheKey = `pdf:${sha256Hash}`;
  const cached = ingestionCache.get(cacheKey);
  if (cached) {
    return Response.json(cached, { status: 200 });
  }

  try {
    const extracted = await extractPdfText(buffer);
    const charCount = extracted.text.length;

    const payload: IngestionSuccess = {
      ok: true,
      sourceType: "pdf",
      title: fileName,
      text: extracted.text,
      charCount,
      estimatedTokens: Math.ceil(charCount / 4),
      metadata: {
        pageCount: extracted.pageCount,
      },
    };

    ingestionCache.set(cacheKey, payload);
    return Response.json(payload, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof PdfIngestionError) {
      return Response.json(
        {
          ok: false,
          code: err.code,
          message: err.message,
          retryable: err.retryable,
        } satisfies IngestionError,
        { status: err.status }
      );
    }

    return Response.json(
      {
        ok: false,
        code: "CORRUPTED_OR_ENCRYPTED_PDF",
        message: "Failed to parse PDF file. It may be corrupted or encrypted.",
        retryable: false,
      } satisfies IngestionError,
      { status: 422 }
    );
  }
}
