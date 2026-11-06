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

## 5. Multipart File Size Checks & Test Fixture Hygiene

- **`req.formData()` and Real Stream Buffers**: Attempting to mock oversized file uploads by monkey-patching `Object.defineProperty(file, "size", ...)` causes subtle stream serialization issues with Node.js Undici multipart parsers (which reconstruct `file.size` from the byte stream). Rather than adding brittle synthetic string markers in production code, tests should either allocate genuine byte buffers (`new Uint8Array(26_214_401)`) or cleanly mock `req.formData()` in route-level unit tests. Production code in `validatePdfBuffer` and `POST /api/ingest/pdf` checks `buffer.byteLength`, `file.size`, and the `Content-Length` header against `MAX_PDF_SIZE_BYTES` (`26,214,400`).

---

## 6. `pdfjs-dist` in Node.js Runtime Environments

- **Legacy Build Requirement (`pdfjs-dist/legacy/build/pdf.mjs`)**: The modern `pdfjs-dist/build/pdf.mjs` requires browser Web APIs such as `DOMMatrix` and Web Workers. When running server-side on Node.js, always import from `pdfjs-dist/legacy/build/pdf.mjs`, which provides Node-compatible polyfills and synchronous evaluator fallback.
- **Standard `pdfjs-dist` Parsing & Viewport Handling (`AC-02.6`)**: Standard vanilla `pdfjs-dist` must parse PDF buffers directly without modifying the buffer or monkey-patching worker internals. Passing the raw PDF buffer preserves the true `page.getViewport({ scale: 1.0 }).width` (`612`), allowing `reconstructSpatialPageText` to cleanly detect multi-column gutters and sort Column 1 before Column 2. For unformatted documents or synthetic tests where unwrapped text lines extend horizontally beyond page bounds, `page.getOperatorList()` (official public `pdfjs-dist` API) provides complete glyph extraction without any worker monkey-patching or `.d.ts` declaration workarounds.
