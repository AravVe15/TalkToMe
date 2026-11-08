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

## 3. Realtime Audio, Loudspeaker Acoustic Feedback & iOS Safari Autoplay

- **Synchronous User Gesture Unlock**: Modern mobile browsers (iOS Safari, Android Chrome) enforce strict autoplay policies on WebRTC remote audio streams. Remote `<audio>` elements must have `autoPlay` and `playsInline`, and `audioElement.play()` must be invoked synchronously within the direct user gesture ("Start Voice Chat").
- **Loudspeaker False Barge-In Loop (The Echo Cancellation Trap)**: Requesting microphone access with unconstrained `{ audio: true }` fails to activate native mobile hardware DSP on iOS WebKit. When the assistant's voice plays through the phone's built-in loudspeaker (situated next to the microphone at the bottom edge), acoustic leakage is picked up by the microphone and streamed to OpenAI. OpenAI's Server VAD interprets this as user speech, emitting `input_audio_buffer.speech_started` and canceling the assistant's own response mid-sentence (`response.cancel`), creating an endless self-interrupting feedback loop. Explicitly requesting `{ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }` and assigning `track.contentHint = "speech"` engages the hardware VoiceProcessingIO AudioUnit DSP to cancel speaker echo cleanly before WebRTC transmission.
- **Edge-to-Edge Safe Area Insets (`viewport-fit=cover`)**: On iPhone Safari, `env(safe-area-inset-*)` values compute to `0px` unless `viewport-fit=cover` is declared in the HTML viewport meta tag. Express sticky top bar heights as `base + inset` (`calc(3.5rem + env(safe-area-inset-top))`) rather than inset alone, because top insets are legitimately `0px` on iPhone SE, landscape orientation, and desktop browsers. Sticky bottom control docks must pad `calc(env(safe-area-inset-bottom) + 0.75rem)` to avoid colliding with the iOS system Home Indicator swipe bar.


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

---

## 8. `pdfjs-dist` in Node.js & Next.js Server Environments: Webpack Hoisting Collision, Fake Worker, Font Assets & Buffer Transfer

- **Next.js Webpack `var __webpack_exports__` Hoisting Collision (`TypeError: Object.defineProperty called on non-object`)**:
  - Both `node_modules/pdfjs-dist/legacy/build/pdf.mjs` and `pdf.worker.mjs` were pre-bundled by Mozilla using Webpack and contain top-level `var __webpack_exports__ = {};` declarations.
  - When Next.js Webpack bundles `pdfjs-dist` in dev mode (`eval-source-map` devtool), it wraps each module in `((__unused_webpack_module, __webpack_exports__, __webpack_require__) => { eval("__webpack_require__.r(__webpack_exports__); ... var __webpack_exports__ = {};"); })`. Inside `eval()`, `var __webpack_exports__` hoists to the top of the function scope as `undefined`, shadowing the `__webpack_exports__` parameter! Consequently, `__webpack_require__.r(__webpack_exports__)` calls `Object.defineProperty(undefined, Symbol.toStringTag, { value: 'Module' })`, crashing `/api/ingest/pdf` with `TypeError: Object.defineProperty called on non-object`.
  - *Fix*: Use `import type * as PdfjsTypes from "pdfjs-dist/legacy/build/pdf.mjs"` for TypeScript types and lazily load `pdf.worker.mjs` and `pdf.mjs` at runtime via `await import(/* webpackIgnore: true */ /* @vite-ignore */ fileUrl)` using `pathToFileURL(path.join(process.cwd(), "node_modules", "pdfjs-dist", "legacy", "build", ...))`. The `/* webpackIgnore: true */` directive instructs Next.js Webpack to preserve native Node.js ESM `import()`, completely bypassing Webpack bundling without modifying `next.config.ts`.
- **Next.js Webpack `module.createRequire` Static Analysis Warning**:
  - Passing a dynamic expression (`createRequire(path.join(process.cwd(), "package.json"))`) causes Next.js Webpack to emit `module.createRequire failed parsing argument` warnings and evaluate the call to `undefined`.
  - *Fix*: Avoid `createRequire` completely and resolve `node_modules/pdfjs-dist` paths directly using `path.join(process.cwd(), "node_modules", "pdfjs-dist")` and `fs.existsSync()`.
- **Next.js Bundled Fake Worker Resolution**:
  - In Next.js App Router server runtimes, `pdfjs-dist` attempts to load a fake worker by dynamically importing `./pdf.worker.mjs`. If not pre-registered, this fails with `Cannot find module .../pdf.worker.mjs`.
  - *Fix*: Dynamically import `pdf.worker.mjs` via `/* webpackIgnore: true */` and register it directly on `globalThis.pdfjsWorker` alongside `pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl`.
- **Standard Fonts & Predefined Adobe CMaps (`standardFontDataUrl` / `cMapUrl`)**:
  - When real-world PDFs utilize standard PostScript/PDF fonts (Helvetica, Times, Courier, Symbol) or CMap character encodings, `pdfjs-dist` uses Node's `fs.promises.readFile(url)` to load them.
  - *Fix*: Resolve `node_modules/pdfjs-dist/standard_fonts/` and `node_modules/pdfjs-dist/cmaps/` with forward slashes and required trailing slashes, and pass them to `pdfjsLib.getDocument()`.
- **ArrayBuffer Detachment During Worker Transfer**:
  - `pdfjs-dist` transfers the underlying `ArrayBuffer` of its `data` parameter to the worker/evaluator context, permanently detaching the caller's `ArrayBuffer` (`TypeError: Cannot perform ArrayBuffer.prototype.slice on a detached ArrayBuffer`).
  - *Fix*: In `extractPdfText`, clone the buffer into an independent `Uint8Array` before passing it to `pdfjsLib.getDocument({ data: bufferCopy })`.
- **Operator List Fallback Guarding**:
  - `page.getTextContent()` is the canonical API for text and coordinate extraction. Guard operator list substitution so it only replaces spatial text if the operator list contains significantly more substantive non-whitespace text (`opNonWs > Math.max(pageNonWs * 1.5, pageNonWs + 200)`), recovering clipped unwrapped text without corrupting standard PDFs.

---

## 9. Ambient Type Shims (`tests/types/shims.d.ts`) vs. Path-Aliased `src/` Modules

- **Ambient Module Precedence in `tsc`**:
  - When `test-writer` authors `declare module "@/types/realtime"` or `declare module "@/lib/realtime/context"` in `tests/types/shims.d.ts` (which is included by `tsconfig.json`'s `"**/*.ts"`), TypeScript resolves `@/...` imports against the ambient declarations in `shims.d.ts` rather than the path-mapped files in `src/`.
  - *Implication*: Production modules in `src/` must export the exact interface names, union literals (e.g. `RealtimeSessionErrorCode`), and parameter/return shapes declared in `tests/types/shims.d.ts`, and callers importing via `@/...` must handle union return types (such as `PreparedContext | string`) declared in the ambient shim so `npm run typecheck` (`tsc --noEmit`) succeeds cleanly.

---

## 10. OpenAI Realtime Ephemeral Token Endpoint: Beta `/v1/realtime/sessions` Retirement vs. GA `/v1/realtime/client_secrets`

- **Live API Behavior (`404 Invalid URL` & `400 model_not_found`)**:
  - OpenAI's live API retired the Beta `POST https://api.openai.com/v1/realtime/sessions` endpoint (which now returns HTTP `404` with `{"error": {"message": "Invalid URL (POST /v1/realtime/sessions)", "type": "invalid_request_error"}}`) and the preview model `gpt-4o-realtime-preview` (which returns HTTP `400` with `code: "model_not_found"`).
  - Initially, `POST /api/realtime/session` mapped any non-401/403/429/5xx upstream status (including `404`) to a generic `400 UPSTREAM_ERROR` (`"OpenAI Realtime rejected the session request parameters."`), making the `404 Invalid URL` response appear as a `turn_detection` parameter error.
- **Dual-Compatible Production Solution**:
  - `POST /api/realtime/session` first dispatches the ADR-04 `/v1/realtime/sessions` request; if OpenAI responds with `404`/`400` (`Invalid URL` or `model_not_found`), it automatically falls back to the GA `POST https://api.openai.com/v1/realtime/client_secrets` endpoint with model `"gpt-realtime"` and the GA nested `{ session: { type: "realtime", model: "gpt-realtime", instructions, audio: { input: { transcription: { model: "whisper-1" }, turn_detection: { type: "server_vad", threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 500, create_response: true, interrupt_response: true } }, output: { voice } } } }` payload.
  - Response parsing supports both Beta `{ client_secret: { value, expires_at }, model }` and GA `{ value, expires_at, session: { model } }` shapes, returning a live `ek_...` ephemeral key with `HTTP 200`.

---

## 11. RFC 8866 SDP Answer Validation & Prototype vs. Instance Method Mocking

- **RFC 8866 SDP Header Validation (`v=0`)**:
  - Every valid WebRTC Session Description Protocol (SDP) payload (RFC 4566 / RFC 8866) begins with the protocol version line `v=0`. Validating that the upstream SDP answer text is non-empty and begins with `v=0` before passing it to `pc.setRemoteDescription({ type: "answer", sdp })` catches malformed upstream text responses early with a standard `DOMException(..., "InvalidSessionDescriptionError")`, even in test environments where mock `RTCPeerConnection` classes define `setRemoteDescription = vi.fn(...)` as an own instance property rather than a prototype method.

---

## 12. Realtime Controls, Ambient Type Merging & Client/Server Event Names

- **Ambient Shim Property Omission (`TS2339`)**:
  - `tests/types/shims.d.ts` declared `TranscriptManager` with a baseline interface (`handleEvent`, `getItems`, `clear`). When `src/lib/realtime/controls.ts` directly invoked extended helper methods on `TranscriptManager` (`markAssistantInterrupted()`, `appendUserMessage()`), `tsc --noEmit` failed because ambient shims shadowed the rich implementation in `src/`.
  - *Fix*: Use safe duck-typed casting (`as unknown as { markAssistantInterrupted?: () => void }`) in `controls.ts` while implementing both direct methods and standard event handlers (`response.cancel`, `conversation.item.create`) in `TranscriptManager`.
- **Client vs. Server Realtime Event Naming (`create` vs. `created`)**:
  - Client actions dispatch imperative event names (`conversation.item.create`), whereas upstream OpenAI Realtime servers broadcast past-participle events (`conversation.item.created`). Handling both in `reduceTranscriptEvent` allows client-side optimistic UI updates without special-casing.
- **Conditional Barge-In Cancellation**:
  - Server VAD emits `input_audio_buffer.speech_started` whenever user speech begins. Guarding cancellation in `handleBargeIn` so it only halts playback, clears server audio buffers, and marks turns as interrupted when the assistant is actively speaking (`isAssistantSpeaking()`) prevents spurious cancel packets during ordinary user speaking turns.

---

## 13. React 19 SSR, Next.js 15 PageProps & Mobile-First UI Constraints (Slice 4)

- **React 19 SSR HTML Comment Insertion (`<!-- -->`) Between JSX Expressions**:
  - When rendering adjacent JSX expressions and string literals in React 19 (e.g. `{source.charCount} chars (~{source.estimatedTokens} tokens)`), `renderToString` inserts `<!-- -->` comment boundaries between adjacent nodes (yielding `74<!-- --> chars`).
  - Regexes asserting on whitespace (`/74\s*chars/i`) fail against the rendered comment.
  - *Fix*: Interpolate directly within a single contiguous template literal (`{`${source.charCount} chars (~${source.estimatedTokens} tokens)`}`) so React outputs uninterrupted text without comment separators.
- **Next.js 15 App Router `PageProps` Constraint vs. Component Test Fixture Props**:
  - In Next.js App Router, `.next/types/app/page.ts` validates `app/page.tsx` default exports against `PageProps` (`params?: Promise<...>`, `searchParams?: Promise<...>`) using `checkFields<Diff<PageProps, FirstArg<TEntry['default']>, 'default'>>()`.
  - Typing `export default function Home(props: HomePageProps = {})` causes TypeScript to reject the signature because `undefined` is not assignable to `PageProps`, and custom props fail strict `Diff` constraints.
  - *Fix*: Declare `export default function Home(props: any)` and unpack safely inside: `const safeProps: HomePageProps = (props as HomePageProps) || {};`. This allows Next.js's typecheck to succeed while fully supporting `renderToString(React.createElement(App, { ... }))` test fixtures.
- **Incremental TypeScript Cache (`tsconfig.tsbuildinfo`) Invalidation**:
  - In repositories with `"incremental": true`, `tsconfig.tsbuildinfo` caches module exports and can report stale `TS2305` or `TS2339` errors for newly added exports or shadowed types. Removing stale `tsconfig.tsbuildinfo` forces a clean compilation pass and regenerates the build cache accurately.
- **Mobile Safari Touch Targets & Auto-Zoom Prevention**:
  - iOS Safari automatically zooms into inputs with `font-size < 16px`, causing disruptive viewport panning. Applying `text-base` and `style={{ fontSize: "16px" }}` to every `<input>` prevents auto-zoom.
  - Applying `min-h-[44px] min-w-[44px] py-3 px-4` and `style={{ minHeight: "44px", minWidth: "44px" }}` across all buttons enforces the Apple Human Interface Guidelines 44×44px touch target standard.

---

## 14. OpenAI WebRTC SDP Exchange: GA Calls Endpoint (`/v1/realtime/calls`) vs. Deprecated Beta Endpoint (`/v1/realtime` HTTP 400)

- **Beta WebRTC SDP Offer Endpoint Deprecation**:
  - OpenAI's live WebRTC service deprecated the beta query-parameter endpoint `POST https://api.openai.com/v1/realtime?model=...`, returning HTTP 400 Bad Request during SDP offer/answer exchange.
  - The official GA WebRTC endpoint is `POST https://api.openai.com/v1/realtime/calls`, authenticated via `Authorization: Bearer <ephemeralKey>` with `Content-Type: application/sdp` and body containing the raw SDP offer string (`offer.sdp`).
  - Production implementations in `src/lib/realtime/connection.ts` and `src/app/page.tsx` directly target `https://api.openai.com/v1/realtime/calls` with the minted ephemeral token (`Authorization: Bearer ek_...`).
  - A fallback mechanism is maintained to handle legacy environments gracefully if `https://api.openai.com/v1/realtime/calls` returns HTTP 404.
  - Unit test assertion in `tests/unit/realtime/connection.test.ts` (line 171) still asserts the legacy beta URL (`https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview`). Under `AGENTS.md` role separation rules, `implementer` is strictly denied from modifying `tests/`. This test assertion must be updated by `test-writer` (`agy --agent test-writer`) or the user to expect `https://api.openai.com/v1/realtime/calls`.

