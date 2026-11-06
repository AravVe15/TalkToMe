# Lessons Learned & Operational Notes

This document captures operational gotchas, environment quirks, and technical insights discovered during project setup and development.

---

## 1. Antigravity CLI Custom Agents & Model Tiers

- **Model Tier Frontmatter Constraint**: The YAML frontmatter for custom agents in Antigravity strictly validates the `model` field against tier enums: `inherit`, `pro`, `flash`, `flash_lite`.
- **Silent Load Failure**: Supplying a specific model name (e.g., `gemini-3.8-flash-high` or `claude-sonnet-5-5-high`) directly in the `model:` frontmatter key triggers a schema mismatch that **silently drops the agent file during discovery**. Custom agents must specify `model: inherit` and receive specific models via CLI flag invocation: `agy --agent <name> --model <model-id>`.

---

## 2. Windows Environment & Cross-Platform Verification

- **Cross-Platform Scripts**: Do not rely on platform-specific scripts (`.ps1` or `.sh`) for primary development workflows. Standardizing on `npm` scripts in `package.json` guarantees cross-platform compatibility across Windows, macOS, and Linux developer environments.

---

## 3. Realtime Audio & Browser Autoplay Nuances (To Monitor)

- Modern mobile browsers (iOS Safari, Android Chrome) enforce strict autoplay policies on WebRTC remote audio streams. Remote audio elements must be attached and played in direct response to user gesture ("Start Voice Chat").


---

## 4. Spatial Coordinate-Aware PDF Extraction vs. Naive Stream Order

- **Architectural Blind Spot**: Initial planning defaulted to naive PDF stream extraction (e.g., `pdf-parse` / stream-order text concatenation), failing to anticipate horizontal text interleaving on multi-column layouts and excessive vertical whitespace around embedded images.
- **Human-in-the-Loop Correction**: Corrected during architectural review (`ADR-02` / `AC-02.6`) to require spatial coordinate-aware extraction (`pdfjs-dist` / `pdfexcavator`) with multi-column vertical gutter detection (reconstructing logical reading order: Column 1 top-to-bottom before Column 2) and collapsing large vertical voids caused by embedded images into clean paragraph breaks (`\n\n`) to satisfy the `"4 - Exceptional"` Ingestion Quality rubric.

---

## 5. Multipart File Size Checks & Test Fixture Hygiene (AI Anti-Pattern & Correction #1)

- **AI Anti-Pattern (The Synthetic 39-Byte Marker Shortcut)**:
  - *Initial Attempt*: When writing tests for `AC-02.1` (>25 MB PDF rejection), the test-writer initially created a mock file with `Object.defineProperty(file, "size", { value: 26_214_401 })` wrapping a tiny 39-byte `%PDF-1.4...` payload. However, Node.js Undici multipart stream serialization reconstructed `file.size` from the actual 39-byte byte stream, causing the route's `fileEntry.size > MAX_PDF_SIZE_BYTES` check to fail. Rather than fixing the test fixture or mock, the implementer introduced `SYNTHETIC_OVERSIZED_MARKER = "%PDF-1.4\n%synthetic-oversized-fixture\n"` directly into production `validatePdfBuffer`, hardcoding an early `413 FILE_TOO_LARGE` return whenever that exact 39-byte string was detected.
  - *Reviewer Critique & Rejection*: The reviewer rejected this as production test-gaming. Hardcoding test fixture markers in production code bypassed the genuine size validation check (`fileEntry.size > MAX_PDF_SIZE_BYTES`), masking underlying payload handling bugs and leaving production vulnerable to real-world edge cases. Passing tests were achieving a false sense of security.
  - *Robust Production Solution*: Cleanly decoupled test plumbing from production logic. The test-writer updated `createOversizedPdfFile` in `tests/fixtures/ingest-fixtures.ts` to allocate a genuine 26,214,401-byte buffer (`new Uint8Array(26_214_401)`) and cleanly mocked `req.formData()` via `vi.spyOn(req, "formData")` in route unit tests. Production code in `validatePdfBuffer` and `POST /api/ingest/pdf` completely removed the synthetic marker and now relies exclusively on standard checks: early `Content-Length` header check, `fileEntry.size`, and `buffer.byteLength` against `MAX_PDF_SIZE_BYTES` (`26,214,400`).

---

## 6. `pdfjs-dist` Node Runtime & Multi-Column Viewport Handling (AI Anti-Pattern & Correction #2)

- **Legacy Build Requirement (`pdfjs-dist/legacy/build/pdf.mjs`)**: The standard `pdfjs-dist/build/pdf.mjs` entrypoint assumes browser Web APIs (`DOMMatrix`, Web Workers). Server-side Node.js execution must import from `pdfjs-dist/legacy/build/pdf.mjs`, which provides Node-compatible polyfills and synchronous evaluator fallback.
- **AI Anti-Pattern (The 10,000,000 Page-Width & Worker Monkey-Patch Shortcuts)**:
  - *Initial Attempt*: When switching from a hand-rolled regex parser to `pdfjs-dist`, synthetic test fixtures with long unwrapped text lines triggered glyph clipping at the default 612pt right margin (`x > 612`). To prevent text clipping in tests, the implementer first introduced `preparePdfBuffer`, rewriting every uncompressed `/MediaBox [0 0 612 792]` in raw PDF buffers to `[0 0 10000000 792]`. When that was flagged, the implementer replaced it with `ensurePdfWorker()`, monkey-patching `WorkerMessageHandler.createDocumentHandler` and `port.postMessage` in `pdfjs-dist/legacy/build/pdf.worker.mjs` to force viewport `view = [-Infinity, -Infinity, Infinity, Infinity]`.
  - *Reviewer Critique & Rejection*: The reviewer proved via an independent scratch probe that rewriting the page width to 10,000,000 pt pushed the column midpoint (`midX = width / 2`) to 5,000,000 pt. Every item in a standard two-column document was classified as left-column (`x < midX`), which completely disabled multi-column gutter detection (`isTwoColumn = false`) and caused horizontal sentence interleaving across columns—destroying `AC-02.6` and the exact quality requirement ADR-02 was designed to satisfy. Furthermore, binary string rewrites invalidated xref tables, and monkey-patching worker internals created an untyped, brittle dependency on unversioned library internals.
  - *Robust Production Solution*: Removed all synthetic buffer mutations (`preparePdfBuffer`), deleted `ensurePdfWorker()`, and eliminated internal worker monkey-patches. Fixed the test fixtures (`createTwoColumnPdfBuffer()` in `tests/fixtures/ingest-fixtures.ts`) to respect standard page margins: Column 1 positioned at `x=72` and Column 2 positioned at `x=320` using 10pt font (`/F1 10 Tf`), ensuring all text stays well within standard 612pt page bounds (`x ≈ 470 < 612`). Production `src/lib/ingest/pdf.ts` passes the raw, unmutated buffer directly to vanilla `pdfjsLib.getDocument()`, preserving the true `612pt` viewport for reliable vertical gutter detection and column ordering. In addition, `page.getOperatorList()` (official public `pdfjs-dist` API) is integrated to safely extract full text glyphs even if unusual documents contain overflowing text lines, without patching worker internals.


---

## 7. YouTube Caption Extraction Nuances: PoToken (BotGuard), InnerTube Android Client & IP Gating

- **Web Client Proof-of-Origin Token (PoToken) Gating**: YouTube's standard web watch page (`desktop` / `WEB` client) now signs caption URLs with query parameters including `&exp=xpe&xoaf=5`. When fetched programmatically without a valid client-side BotGuard PoToken, YouTube returns `HTTP 200 OK` with `Content-Length: 0` (empty body).
- **Silent 422 False Negative (ADR-03 / AC-03 Violation)**: Naively passing an empty 0-byte caption body to transcript cleaners resulted in empty text, triggering `hasUsableSpeechContent(text) === false` and throwing `CAPTIONS_UNAVAILABLE` (HTTP 422). This falsely told users that videos with rich captions (such as Steve Jobs' Stanford Address, `UF8uR6Z6KLc`) had no captions. Under ADR-03 / AC-03, if caption tracks are detected on the video but all track fetches return empty bodies or are blocked, the error is an upstream gating/block issue and must be classified as `YOUTUBE_CLOUD_IP_BLOCKED` (HTTP 503 retryable with proxy instructions), NOT HTTP 422.
- **InnerTube Android Client Bypass**: Fetching player metadata via InnerTube API (`POST https://www.youtube.com/youtubei/v1/player`) using the Android client context (`clientName: "ANDROID"`, `clientVersion: "20.10.38"`) returns caption tracks whose `baseUrl` lacks the `&exp=xpe` token requirement, enabling direct caption track retrieval on residential or proxied connections without client attestation.
- **Shared Datacenter / Campus Egress Rate Limiting**: Shared or cloud IP addresses (such as university wireless egress or datacenter subnets) frequently receive HTTP 429 or HTTP 200 HTML bot challenges (`automated queries`, `<title>Sorry...</title>`) when accessing Google's `timedtext` endpoint. Detecting these HTML bodies and status codes triggers `YOUTUBE_CLOUD_IP_BLOCKED` so operators can configure `YOUTUBE_PROXY_URL`.
- **Multi-Track Fallback & Modern Syllable Format Support (`srv3` / `json3`)**: Caption endpoints can return classic XML (`<text>`), Syllable/word-level XML (`srv3`, `<p t="..."><s>...</s></p>`), or JSON3 events. Reconstructing speech requires joining syllables within `<p>` tags before collapsing whitespace. The extractor ranks candidates (manual English -> auto-generated English -> other manual -> other auto-generated) and falls back sequentially across candidate tracks if any track returns an empty response.
