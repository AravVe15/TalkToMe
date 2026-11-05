/**
 * Test fixtures and mock data for Ingestion Engine test suites (Slice 1).
 * Derived strictly from requirements.md (AC-01, AC-02, AC-03, AC-12) and decisions.md.
 */

// --- PDF Fixtures ---

/**
 * Minimal valid single-page text-based PDF bytes starting with '%PDF-'.
 * Contains sufficient text (> 20 non-whitespace characters) to pass No-OCR boundary.
 */
export function createValidPdfBuffer(
  textContent: string = "This is a valid extracted text from a test document that contains well over twenty non-whitespace characters for testing."
): Uint8Array {
  // Construct a minimal valid PDF-1.4 binary structure
  const pdfString = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>
endobj
4 0 obj
<< /Length ${textContent.length + 50} >>
stream
BT
/F1 12 Tf
72 712 Td
(${textContent}) Tj
ET
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000206 00000 n 
trailer
<< /Size 5 /Root 1 0 R >>
startxref
300
%%EOF`;
  return new TextEncoder().encode(pdfString);
}

/**
 * Minimal valid multi-page text-based PDF bytes (2 pages).
 */
export function createMultiPagePdfBuffer(
  page1Text: string = "Page one content with sufficient non-whitespace text for testing.",
  page2Text: string = "Page two content also containing sufficient text for multi-page test."
): Uint8Array {
  const pdfString = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R >>
endobj
4 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R >>
endobj
5 0 obj
<< /Length ${page1Text.length + 50} >>
stream
BT
/F1 12 Tf
72 712 Td
(${page1Text}) Tj
ET
endstream
endobj
6 0 obj
<< /Length ${page2Text.length + 50} >>
stream
BT
/F1 12 Tf
72 712 Td
(${page2Text}) Tj
ET
endstream
endobj
xref
0 7
0000000000 65535 f 
trailer
<< /Size 7 /Root 1 0 R >>
startxref
500
%%EOF`;
  return new TextEncoder().encode(pdfString);
}

/**
 * Minimal PDF buffer whose extracted text is blank or < 20 non-whitespace characters (scanned/empty PDF).
 */
export function createScannedOrEmptyPdfBuffer(): Uint8Array {
  const pdfString = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 20 >>
stream
BT
ET
endstream
endobj
xref
0 5
trailer
<< /Size 5 /Root 1 0 R >>
startxref
200
%%EOF`;
  return new TextEncoder().encode(pdfString);
}

/**
 * Corrupted PDF bytes that start with '%PDF-' but contain invalid/unparseable structure.
 */
export function createCorruptedPdfBuffer(): Uint8Array {
  return new TextEncoder().encode("%PDF-1.4\n<< CORRUPTED OBJECT DATA WITHOUT TRAILER %%GARBAGE");
}

/**
 * Truncated PDF stream bytes (unclosed stream without endstream, xref, or trailer).
 */
export function createTruncatedStreamPdfBuffer(): Uint8Array {
  return new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<< /Length 500 >>\nstream\nTruncated stream data with no closing delimiter");
}

/**
 * Zero-page PDF buffer (valid PDF header and catalog, but defining 0 pages).
 */
export function createZeroPagePdfBuffer(): Uint8Array {
  const pdfString = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [] /Count 0 >>
endobj
xref
0 3
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
trailer
<< /Size 3 /Root 1 0 R >>
startxref
120
%%EOF`;
  return new TextEncoder().encode(pdfString);
}

/**
 * Non-PDF bytes (missing %PDF- magic header).
 */
export function createNonPdfBuffer(): Uint8Array {
  return new TextEncoder().encode("This is a plain text file pretending to be a PDF.");
}

/**
 * PNG image bytes with PNG magic header (\x89PNG\r\n\x1a\n).
 */
export function createPngBuffer(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
}

/**
 * Generates an oversized PDF buffer representation exceeding 25 MB (26,214,401 bytes).
 * Uses a small Uint8Array with overridden size property on File to avoid massive memory allocations in tests.
 */
export function createOversizedPdfFile(filename: string = "oversized.pdf"): File {
  const dummyBuffer = new TextEncoder().encode("%PDF-1.4\nOversized test payload");
  const file = new File([dummyBuffer], filename, { type: "application/pdf" });
  Object.defineProperty(file, "size", { value: 26_214_401, configurable: true });
  return file;
}

/**
 * Generates an exact 25 MB boundary PDF file (26,214,400 bytes).
 */
export function createBoundary25MbPdfFile(filename: string = "boundary25mb.pdf"): File {
  const dummyBuffer = new TextEncoder().encode("%PDF-1.4\nBoundary 25MB test payload");
  const file = new File([dummyBuffer], filename, { type: "application/pdf" });
  Object.defineProperty(file, "size", { value: 26_214_400, configurable: true });
  return file;
}

// --- YouTube Fixtures ---

export const VALID_YOUTUBE_URL_SAMPLES = [
  { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", expectedId: "dQw4w9WgXcQ", desc: "standard watch URL" },
  { url: "http://youtube.com/watch?v=dQw4w9WgXcQ", expectedId: "dQw4w9WgXcQ", desc: "http without www" },
  { url: "https://youtu.be/dQw4w9WgXcQ", expectedId: "dQw4w9WgXcQ", desc: "youtu.be short URL" },
  { url: "https://youtu.be/dQw4w9WgXcQ?t=42", expectedId: "dQw4w9WgXcQ", desc: "youtu.be with timestamp query" },
  { url: "https://www.youtube.com/shorts/dQw4w9WgXcQ", expectedId: "dQw4w9WgXcQ", desc: "youtube shorts URL" },
  { url: "https://www.youtube.com/embed/dQw4w9WgXcQ", expectedId: "dQw4w9WgXcQ", desc: "youtube embed URL" },
  { url: "https://www.youtube.com/live/dQw4w9WgXcQ", expectedId: "dQw4w9WgXcQ", desc: "youtube live URL" },
  { url: "https://m.youtube.com/watch?v=dQw4w9WgXcQ", expectedId: "dQw4w9WgXcQ", desc: "mobile m.youtube.com URL" },
  { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123456&index=1&t=10s", expectedId: "dQw4w9WgXcQ", desc: "watch URL with list, index and timestamp" },
  { url: "  https://www.youtube.com/watch?v=dQw4w9WgXcQ  ", expectedId: "dQw4w9WgXcQ", desc: "URL with leading and trailing whitespace" },
];

export const INVALID_YOUTUBE_URL_SAMPLES = [
  { url: "", desc: "empty string" },
  { url: "   ", desc: "whitespace string" },
  { url: "not-a-url", desc: "random non-URL string" },
  { url: "https://vimeo.com/123456789", desc: "non-YouTube domain (Vimeo)" },
  { url: "https://example.com/watch?v=dQw4w9WgXcQ", desc: "fake domain with watch path" },
  { url: "https://www.youtube.com/watch?v=", desc: "youtube watch with empty v param" },
  { url: "https://www.youtube.com/watch?v=short", desc: "video ID shorter than 11 characters" },
  { url: "https://www.youtube.com/watch?v=toolongvideoid123", desc: "video ID longer than 11 characters" },
  { url: "https://www.youtube.com/watch?v=invalid@char!", desc: "video ID with invalid symbols" },
  { url: "https://youtu.be/", desc: "youtu.be with missing ID" },
  { url: "https://www.youtube.com/channel/UC123456789", desc: "channel URL instead of video URL" },
];

/**
 * Mock raw XML captions returned by YouTube transcript endpoints with HTML entities.
 */
export const MOCK_YOUTUBE_RAW_XML_CAPTIONS = `<?xml version="1.0" encoding="utf-8" ?>
<transcript>
  <text start="0.0" dur="2.5">Hello &amp; welcome to the &quot;TalkToMe&quot; presentation.</text>
  <text start="2.5" dur="3.0">It&#39;s an AI-powered voice assistant for documents and videos.</text>
  <text start="5.5" dur="2.0">We&apos;re going to test &lt;b&gt;natural conversation&lt;/b&gt;.</text>
</transcript>`;

export const MOCK_YOUTUBE_CLEANED_TEXT = 
  'Hello & welcome to the "TalkToMe" presentation. It\'s an AI-powered voice assistant for documents and videos. We\'re going to test natural conversation.';

/**
 * Mock empty transcript XML returned with HTTP 200 (zero caption elements).
 */
export const MOCK_YOUTUBE_EMPTY_TRANSCRIPT_XML = `<?xml version="1.0" encoding="utf-8" ?>
<transcript>
</transcript>`;

/**
 * Mock transcript containing exclusively audio cues, music notes, and non-speech symbols.
 */
export const MOCK_YOUTUBE_MUSIC_ONLY_XML = `<?xml version="1.0" encoding="utf-8" ?>
<transcript>
  <text start="0.0" dur="2.0">[Music]</text>
  <text start="2.0" dur="2.0">♪♪♪</text>
  <text start="4.0" dur="2.0">[Applause]</text>
</transcript>`;

/**
 * Mock HTML challenge/bot-check page returned with HTTP 200 instead of XML.
 */
export const MOCK_YOUTUBE_HTML_CHALLENGE_BODY = `<!DOCTYPE html>
<html>
<head><title>Before you continue to YouTube</title></head>
<body><h1>Sign in or complete captcha to continue</h1></body>
</html>`;

export const IMPLICIT_EDGE_CASE_URL_SAMPLES = [
  { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&v=extraId1234", expectedId: "dQw4w9WgXcQ", desc: "parameter pollution with multiple v params" },
  { url: "https://www.youtube.com/shorts/", expectedId: null, desc: "empty shorts route without ID" },
  { url: "https://www.youtube.com/embed/", expectedId: null, desc: "empty embed route without ID" },
  { url: "https://www.youtube.com/live/", expectedId: null, desc: "empty live route without ID" },
  { url: "https://www.youtube.com/watch?v=dQw4w9WgXc%20", expectedId: null, desc: "URL-encoded whitespace inside video ID" },
  { url: "//www.youtube.com/watch?v=dQw4w9WgXcQ", expectedId: "dQw4w9WgXcQ", desc: "protocol-relative URL" },
];
