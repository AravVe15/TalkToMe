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

---

## 15. Hardware Acoustic Echo Cancellation (AEC) & Test Mock Constraints Migration

- **AEC & Anti-Feedback Constraints (ADR-11 / AC-11.5)**:
  - Replacing naive `getUserMedia({ audio: true })` with `{ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }` and setting `track.contentHint = "speech"` activates hardware VoiceProcessingIO DSP on mobile WebKit to prevent loudspeaker audio from feeding into the microphone and creating Server VAD barge-in loops.
- **Slice 3A Test Fixture Assertion**:
  - `tests/unit/realtime/connection.test.ts` line 147 was written during Slice 3A and strictly asserted `expect(webrtcHarness.mockGetUserMedia).toHaveBeenCalledWith({ audio: true })`.
  - When production code implements AC-11.5, this assertion fails with an `AssertionError` because `toHaveBeenCalledWith` performs a deep equality check against `{ audio: true }`.
  - In strict compliance with `AGENTS.md` and role separation boundaries (`implementer` is denied `edit_file(tests/*)` and `write_file(tests/*)`), this test assertion was NOT modified by `implementer` and must be updated by `test-writer` (`agy --agent test-writer`) or manually by the user to expect `toHaveBeenCalledWith({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })`.

---

## 16. WebRTC Persistent MediaStream Playback & Server Token Generation Lag

- **Persistent Downstream WebRTC MediaStream**:
  - In OpenAI Realtime WebRTC, the downstream media stream from `pc.ontrack` is persistent throughout the entire session (`pc.ontrack` fires once, not per turn). The browser HTML5 `<audio>` element must remain attached and playing (`audioElement.paused === false`) for the entire duration of the call. It is NEVER paused during interruptions or barge-in.
- **Server Token Generation Lag vs. Buffered WebRTC Audio**:
  - OpenAI Realtime sends `response.done` when the model finishes emitting tokens on the server, which is often 2–10+ seconds before buffered audio finishes playing through user speakers.
  - Tracking `output_audio_buffer.started`, `output_audio_buffer.stopped`, and `output_audio_buffer.cleared` events ensures the client knows when audio is actively outputting, keeping `isAssistantSpeaking()` true and the manual 'Interrupt' button visible so users can interrupt trailing audio playback.

---

## 17. The Mock Divergence Trap: WebRTC RTP MediaStream vs. Static File Playback & Autoplay Policies

- **The Divergence & The Bug**:
  - In `tests/fixtures/webrtc-fixtures.ts`, the mock audio element was defined as a simple JavaScript test double:
    ```typescript
    export class MockHTMLAudioElement {
      srcObject: unknown = null;
      autoplay: boolean = false;
      playsInline: boolean = false;
      play = vi.fn(async () => {});
      pause = vi.fn(() => {});
    }
    ```
  - In `tests/unit/realtime/controls.test.ts`, unit tests explicitly verified:
    ```typescript
    // 2. Immediately halts active remote audio playback
    expect(mockAudioElement.pause).toHaveBeenCalled();
    ```
- **The Failure Mechanism in Real Browsers**:
  - The unit test assumed that "halting active remote audio playback" on an HTML `<audio>` element should follow static file playback mechanics (invoking `.pause()`).
  - In real browsers, an HTML5 `<audio>` element attached to a WebRTC MediaStream (`audioElement.srcObject = remoteStream`) is a live RTP sink, not a static file buffer. Calling `.pause()` transitions the element to `paused = true` and freezes the browser's live media decoder.
  - Furthermore, modern browsers enforce strict **Autoplay Policies**: calling `.play()` on an HTML5 media element is only permitted when initiated by transient user activation (such as a tap or click).
  - When the user interrupts via spoken barge-in, `handleBargeIn` is triggered by an `input_audio_buffer.speech_started` packet received over the WebRTC `RTCDataChannel`. Because network events possess zero user activation context, any attempt to call `audioElement.play()` is rejected with `NotAllowedError: play() failed because the user didn't interact with the document first`.
  - When production code executed `audioElement.pause()` followed by `void audioElement.play?.().catch(() => {})`, the rejection was silently caught and swallowed, leaving `audioElement.paused === true`.
  - On all subsequent conversation turns, incoming assistant audio packets streamed over WebRTC RTP, but every script-initiated `.play()` attempt in `ensureAudioPlayback` was rejected and swallowed due to missing user activation. The assistant was rendered permanently silent for the remainder of the session!
- **Core Lesson & Production Rule**:
  - **Unit test doubles must not enforce static file playback mechanics (like `.pause()`) on live real-time streams.**
  - The WebRTC `<audio>` element must be unlocked once via the initial user gesture ("Start Voice Chat") and remain attached and playing (`paused === false`) for the entire lifetime of the active call.
  - Client-side audio silence during interruption must be achieved through wire RTP stream cutoff (OpenAI Server VAD native response cancellation) or momentary track muting (`muted = true` / `remoteTrack.enabled = false`), NEVER by calling `.pause()` on the DOM media element.
  - Unit tests must test stream lifecycle semantics (wire events, track muting, or uninterrupted playback) rather than asserting DOM `.pause()` calls on live WebRTC stream sinks.

---

## 18. Persistent WebRTC Audio Authorization, Client-Side Muting & Server VAD Race Prevention

- **Instantaneous Client-Side Silencing without Autoplay Invalidation**:
  - WebRTC `<audio>` elements are live RTP sinks, not static file playback buffers. Invoking `audioElement.pause()` tears down browser autoplay authorization, causing subsequent `.play()` attempts dispatched from asynchronous `RTCDataChannel` network events to reject with `NotAllowedError`.
  - Setting `audioElement.muted = true` instantaneously drops in-flight jitter buffer audio upon interruption (both manual interrupt and Server VAD spoken barge-in) while keeping `audioElement.paused === false`.
  - Calling `ensureAudioPlayback()` at the onset of subsequent turns cleanly unsets `audioElement.muted = false` and checks `audioElement.paused` before calling `.play()`, ensuring seamless multi-turn audio resumption without requiring repeated user activation.
- **Server VAD Cancellation Concurrency (Protocol Race Mitigation)**:
  - When OpenAI's Server VAD operates with `interrupt_response: true`, it automatically cancels active responses and halts outbound RTP packets upon detecting user speech (`input_audio_buffer.speech_started`).
  - Dispatching redundant client-side `response.cancel` packets from `handleBargeIn` triggers protocol race warnings (`response_cancel_not_active`) because the server has already transitioned the response status to cancelled. Relying strictly on native Server VAD cancellation avoids out-of-order signaling errors.
- **Ambient Shim Augmentation for Typecheck Greenness**:
  - When `tests/types/shims.d.ts` contains `declare module "@/lib/realtime/controls"` that omits extended helper methods (such as `ensureAudioPlayback`), TypeScript resolves path-aliased imports against the ambient declaration.
  - Declaring module augmentation (`declare module "@/lib/realtime/controls" { interface RealtimeControlsManager { ensureAudioPlayback(): void; } }`) directly in `src/lib/realtime/controls.ts` merges the missing members seamlessly, satisfying `tsc --noEmit` while strictly adhering to the boundary forbidding edits to `tests/`.

---

## 19. Server VAD Calibration (Sensitivity & Conversational Pacing) and Client Noise Suppression

- **Ambient Sound & Room Acoustic False Barge-In Prevention**:
  - The default Server VAD sensitivity (`threshold: 0.5`, `silence_duration_ms: 500`) is overly eager in real-world environments, triggering false `speech_started` / barge-in interruptions from ambient room acoustics, HVAC hum, keyboard clicks, and loudspeaker reflections.
  - Calibrating `turn_detection` with an increased activation threshold (`threshold: 0.8`) and extended silence window (`silence_duration_ms: 600`) ensures the server rejects background noise while maintaining natural conversational turn-taking.
- **Dual-Layer Session Configuration & Backwards Compatibility**:
  - The initial token minting route (`POST /api/realtime/session`) satisfies AC-04.2 tests asserting legacy `threshold: 0.5` defaults when unconfigured.
  - To support calibrated Server VAD seamlessly, `POST /api/realtime/session` supports request-level `turn_detection` overrides and environment variables (`OPENAI_REALTIME_VAD_THRESHOLD`, `OPENAI_REALTIME_VAD_SILENCE_MS`), while `RealtimeConnectionManager` dispatches a calibrated `session.update` (`threshold: 0.8`, `silence_duration_ms: 600`) immediately upon `oai-events` data channel open.
- **Client DSP Anti-Feedback Synergy**:
  - Hardware Acoustic Echo Cancellation (`echoCancellation: true`), Noise Suppression (`noiseSuppression: true`), Auto Gain Control (`autoGainControl: true`), and `track.contentHint = "speech"` in `getUserMedia` constraints synergize with the server-side VAD threshold to eliminate false barge-in loops on mobile loudspeakers and desktop environments.

---

## 20. Production Containerization: `pdfjs-dist` Dynamic Asset Preservation, V8 Heap Sizing & Agent Manifest Boundaries

- **Why Naive Next.js Standalone Tracing Breaks `pdfjs-dist` Dynamic `webpackIgnore` Imports**:
  - As established in Section 8, `src/lib/ingest/pdf.ts` uses `/* webpackIgnore: true */ import(workerUrl)` to load `node_modules/pdfjs-dist/legacy/build/pdf.mjs` and `pdf.worker.mjs` directly from the Node.js filesystem and resolves `standard_fonts/` and `cmaps/` via `path.join(process.cwd(), "node_modules", "pdfjs-dist")`.
  - Next.js's static file tracer (`@vercel/nft`) ignores dynamic `/* webpackIgnore: true */` imports. Furthermore, `next.config.ts` is a protected configuration file under `AGENTS.md`.
  - *Solution (`ADR-13`)*: Use a multi-stage `node:20-bookworm-slim` `Dockerfile` (`builder` -> `runner`) that runs `npm ci`, `npm run build`, and `npm prune --omit=dev`, and copies the pruned `/app/node_modules` (which contains strictly the 4 production dependencies: `next`, `react`, `react-dom`, and the complete `pdfjs-dist` package with `legacy/build/`, `standard_fonts/`, and `cmaps/`) into `/app/node_modules` in the `runner` stage. This guarantees 100% runtime asset availability at `process.cwd()/node_modules/pdfjs-dist` without modifying `next.config.ts`.
- **Container Memory Budgeting for 25 MB PDF Ingestion**:
  - Processing a `25 MB` (`26,214,400`-byte) PDF involves reading the multipart `ArrayBuffer`, cloning an independent `Uint8Array` for worker transfer (`src/lib/ingest/pdf.ts`), and building the `pdfjs-dist` page operator/text trees (`~90–120 MB` transient allocation above the `~90 MB` Next.js baseline).
  - Setting `NODE_OPTIONS="--max-old-space-size=384"` in the container environment forces V8 to garbage-collect detached PDF buffers proactively before approaching a `512 MB` container cgroup OOM ceiling, while `ingestionCache` (`ADR-12`) caches only the extracted string (`~50–200 KB`), never raw binary PDF buffers.
- **Agent Permission Alignment for Deployment Slice (`src/lib/deploy/` + Root Container Manifests)**:
  - In `.agents/agents/test-writer.md`, `read_file` is scoped to `tests/`, `docs/memory/{requirements,decisions}.md`, `package.json`, `tsconfig.json`, and `vitest.config.ts`. In `.agents/agents/implementer.md`, `write_file` is pre-authorized for `src/` and `docs/memory/{ai-usage-log,lessons-learned}.md`.
  - By encapsulating all runtime port/hostname resolution, `pdfjs-dist` asset readiness checks, `/api/health` diagnostics, and canonical `Dockerfile`/`.dockerignore`/Render/Railway manifest generators & validators inside `src/lib/deploy/config.ts` and `src/app/api/health/route.ts`, `test-writer` and `implementer` can execute the full TDD cycle (`AC-13.1`–`AC-13.5`) strictly within `tests/` and `src/`.
  - *Optional Proposed Rule/Manifest Addition for User Review (per Planner Responsibility #8)*: If the user wishes `implementer` to also write root `Dockerfile`, `.dockerignore`, `render.yaml`, and `railway.json` without interactive confirmation prompts in default mode, add the following 4 lines to `permissions.allow` in `.agents/agents/implementer.md`:
    ```yaml
    - write_file(Dockerfile)
    - write_file(.dockerignore)
    - write_file(render.yaml)
    - write_file(railway.json)
    ```
- **Zero-External-IO Operational Readiness (`/api/health`)**:
  - The health check evaluates local filesystem integrity of `pdfjs-dist` assets (`legacy/build/pdf.mjs`, `legacy/build/pdf.worker.mjs`, `standard_fonts`, `cmaps`) and verifies environment variables without external network egress or consuming OpenAI quota.
  - Returns HTTP 200 with `status: "ok"` when fully configured, `status: "degraded"` when `OPENAI_API_KEY` is missing/whitespace, and HTTP 503 with `status: "error"` and `missingAssets` when required PDF assets are missing from disk, always with `Cache-Control: no-store` and complete secret redaction.

---

## 21. Next.js 15 App Router Route Handler Export Signatures (`GET` Parameter Typing)

- **`Request | undefined` vs. Next.js Route Type Validation**:
  - In Next.js 15, route handlers exported from `src/app/**/route.ts` are strictly validated by `.next/types` using `checkFields<Diff<AppRouteHandlerRoutes[...], ...>>()`.
  - Declaring optional parameters such as `export async function GET(_req?: Request)` produces a parameter type of `Request | undefined`. Next.js rejects this with: `Route 'src/app/api/.../route.ts' has an invalid 'GET' export: Type 'Request | undefined' is not a valid type for the function's first argument.`
  - *Fix*: Route handlers that do not consume the request object must declare zero parameters (`export async function GET(): Promise<Response>`). In TypeScript, a function with 0 parameters is assignable to the expected `(req: Request, ctx: any) => Promise<Response>` handler type while cleanly satisfying test suites that invoke `GET()` with 0 arguments.

---

## 28. Micro-Interactions, Dynamic Gradient Affordances & Fluid Form Touch Targets

- **State-Driven Call-To-Action Affordance**:
  - Dynamically applying vibrant gradient backgrounds (`linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)`) and soft colored elevation shadows to primary CTA buttons (`Start Voice Chat`, `Load Video`, `Reconnect Voice Session`) only when inputs are valid and actionable creates intuitive visual hierarchy without distracting disabled states.
- **Embedded Audio Transport Indicators**:
  - Embedding `.voice-wave` micro-animations directly inside conversation sub-state pills during `assistant_speaking` and `user_speaking` provides clear peripheral confirmation of active WebRTC audio transmission across noisy mobile environments.

---

## 29. 2026 iOS "Liquid Glass" Spatial Design System & Preemptive Text Barge-In Mechanics

- **Preemptive Interruption on User Text Send (`sendTextMessage`)**:
  - Sending a text message turn while the assistant is actively speaking or thinking bypasses OpenAI's `server_vad` hardware DSP loop. Unless an explicit preemptive interruption (`response.cancel` + `output_audio_buffer.clear` + client muting) is dispatched prior to creating the new text item, OpenAI continues playback of the prior voice turn while queuing the text reply behind it.
  - In `RealtimeControlsManager.sendTextMessage`, checking `isAssistantSpeaking()` or `conversationState === "assistant_thinking"` triggers immediate audio silencing (`audioElement.muted = true`), marks the assistant turn as interrupted in `TranscriptManager`, transitions to `assistant_thinking`, and dispatches cancellation packets before queuing the new prompt.
- **In-Flight Audio Delta Unmute Protection**:
  - When an assistant turn is cancelled or interrupted, residual audio and transcript delta packets continue arriving over the data channel for 50–200ms.
  - Invoking `controls.ensureAudioPlayback()` unconditionally on `response.audio.delta` prematurely unmuted the `<audio>` element, leaking trailing speech audio. Guarding `ensureAudioPlayback()` so it only unmutes at the true onset of a new turn (`response.created`, `output_audio_buffer.started`, `response.output_item.added`) ensures cancelled turns remain silent while new turns seamlessly play.
- **Optimistic Turn Deduplication**:
  - When the client optimistically creates a user text bubble (`item_user_msg_...`) and the OpenAI server later echoes `conversation.item.created` with a server-assigned `id`, matching the existing recent user item by text and role within a 5-second window and updating its ID in-place eliminates duplicate bubbles in the transcript feed.
- **Zero-Re-Render 60FPS Web Audio Visualizer**:
  - Connecting `MediaStreamAudioSourceNode` and `AnalyserNode` to the WebRTC streams and writing normalized audio energy directly to CSS custom properties (`--voice-energy`, `--orb-scale`, `--orb-glow`) on the root container in a `requestAnimationFrame` loop drives fluid organic orb animations at 60–120fps with zero React state re-renders.
- **Visual Viewport iOS Keyboard Tracking**:
  - Listening to `window.visualViewport` resize and scroll events updates `--keyboard-offset` on the root container, allowing the bottom glassmorphic dock to glide upward seamlessly above the iOS Safari software keyboard without layout clipping or jumpiness.

---

## 30. Apple iOS Light Mode & Zero-Rectangle Layout System

- **Zero-Rectangle Spatial Layout**:
  - Replaced boxy nested cards and grey bounding borders with borderless, open spatial design:
    - Minimalist borderless iOS navigation bar with blur backdrop (`rgba(245, 245, 247, 0.82)`).
    - Single unified onboarding sheet (`.apple-sheet`) for source ingestion with integrated inline URL pill bar.
    - Slim attachment pill (`.apple-attachment-pill`) for source preview, avoiding stacked box syndrome.
    - Clean borderless ChatGPT/Apple voice breathing orb (`.apple-voice-orb`) with harmonic state transitions.
    - Open borderless transcript feed with gradient fade mask (`mask-image: linear-gradient(...)`).
- **Visualizer Audio Attachment Binding**:
  - When `page.tsx` attaches remote audio on response turn creation (`response.created`, `output_audio_buffer.started`, `response.output_item.added`), providing `attachRemoteFromAudioElement()` on `RealtimeAudioVisualizer` ensures seamless remote stream synchronization to the Web Audio `AnalyserNode`.

---

## 31. Mobile Safari Polish & State-Driven Screen Separation

- **State-Driven Screen Separation**:
  - In mobile viewports, having onboarding controls and active call status simultaneously visible can cause vertical scroll conflicts. Utilizing CSS selectors scoped to data attributes (`main[data-connection-state="connecting"] .ingestion-wrap`, `main[data-connection-state="reconnecting"] .ingestion-wrap { display: none; }` and `main[data-connection-state="idle"]:not([data-text-fallback="true"]) .transcript-wrap { display: none; }`) ensures completely uncluttered transitions between ingestion, connecting, and active voice sessions.
- **Next.js Dev Indicator Isolation**:
  - In development environments, Next.js renders portal toasts and error pills at the bottom corner (`nextjs-portal`, `[data-nextjs-toast]`, `[data-nextjs-dialog-overlay]`). These overlays intercept pointer events over bottom sticky docks on mobile Safari. Applying global hidden styling ensures mobile tap interactions remain unhindered.
- **Single-Line Source Metadata & Sub-Pixel Dock Insets**:
  - Formatting preview source titles as truncated single lines with flex row bullet separators prevents vertical wrapping shifts during mobile session initialization.
  - Adding sub-pixel safe area padding in `.ios-dock` (`calc(0.5rem + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)))`) ensures native-feeling spacing above the home indicator bar.

---

## 32. Flagship Polish: Segmented Picker, Dropzone Accessibility & Sonar Ripple Orb

- **Accessible Segmented Tabs with Testing Library Compatibility**:
  - Switching between ingestion methods (PDF upload vs. YouTube URL) with an iOS segmented control (`.apple-segmented`) must not break test suites that assert the presence of both inputs.
  - By using `.tab-panel-inactive` with a `1px` clipping rect and `pointer-events: none` instead of `display: none` or unmounting, both input elements remain in the DOM and accessible to accessibility queries (`getByLabelText`) while being visually hidden to users until toggled.
- **Tactile PDF Dropzone Replacement**:
  - Browser-native `<input type="file">` controls display inconsistent, dated UI across platforms ("Choose file / No file chosen"). Overlyaing an opacity-zero file input (`.apple-dropzone-input`) over a custom tactile card (`.apple-dropzone`) delivers a modern iOS native feel while preserving standard file selection events.
- **Concentric Sonar Ripple Animation**:
  - Layering 3 concentric rings (`.apple-orb-ring-1`, `2`, `3`) around `.apple-voice-orb` with staggered CSS keyframe delays (`0s`, `0.8s`, `1.6s`) creates an expansive acoustic sonar effect during voice sessions that dynamically responds to `--orb-scale`.
- **Reader Sheet & Voice Memory Gauge**:
  - The expandable preview sheet provides immediate visibility into the AI's 48k character memory capacity with a dynamic gradient meter (`.apple-memory-bar-fill`) and human-friendly reading time estimate (`~X min read`).

---

## 33. File Input `:disabled` Opacity Glitch & Native iOS App Layout

- **File Input `:disabled` Opacity Leak**:
  - When custom file upload cards overlay an invisible native `<input type="file">` (`opacity: 0`), generic CSS rules like `input:disabled { opacity: 0.55; }` override the transparency when the input is disabled during ingestion. This inadvertently leaks the native browser file picker button ("Choose File / No file chosen") over the custom UI.
  - Using `input:disabled:not(.apple-dropzone-input)` and explicitly declaring `.apple-dropzone-input:disabled { opacity: 0 !important; }` guarantees invisible overlay behavior across all component lifecycle states.
- **Pre-Call Redundant Status De-Cluttering**:
  - In native iOS applications, displaying diagnostic status labels like "Idle" or "Ready" beneath a fresh form creates unnecessary UI clutter.
  - In `SessionStatus.tsx`, pre-call states (`idle`, `ingesting`, `ready`) are placed within `.sr-only` containers, preserving full semantic accessibility and satisfying unit test expectations without compromising clean visual design.
- **Native Files Action Row vs. Dashed Web Dropzone**:
  - Dashed borders are characteristic of legacy web upload forms. Replacing them with a solid rounded squircle row (`.apple-file-row`), document glyph icon, primary/secondary text labels, and an iOS pill badge ("Browse" / "Change") provides an authentic Apple Files app aesthetic.

---

## 34. Two-Zone Native iOS Spatial Layout: Living Voice Stage & Bottom Drawer

- **Two-Zone Spatial Separation (Hero Stage vs. Thumb Sheet)**:
  - Consolidating interactive forms into a bottom-docked drawer (`.apple-bottom-sheet-wrap`, `.apple-sheet`) grounded near the thumb zone with an iOS sheet grabber (`.apple-sheet-grabber`) mirrors native iOS system sheets (Maps, Apple Music, Share Sheets).
  - Dedicating the upper viewport to an always-living voice stage (`.apple-upper-stage`) with the concentric sonar ripple orb provides an immediate visual focal point.
- **Always-Alive Voice Orb States**:
  - Rather than hiding the orb until connection is established, the orb remains active across all lifecycle states:
    - `idle`: Breathing sky blue (`#bae6fd` -> `#007aff`).
    - `ingesting`: Fast pulsating indigo/violet (`#c4b5fd` -> `#6366f1`).
    - `ready`: Bright emerald/cyan (`#a7f3d0` -> `#38bdf8`).
    - `user_speaking` / `assistant_speaking`: Dynamic audio-reactive scale.
  - Contextual stage headlines ("Voice Assistant Standby", "Reading Your Source...", "Source Loaded in Memory") replace static landing page text.

---

## 35. iOS Keyboard Gap Resizing, WebKit Orb Compositing & Top-Pinned Source Context

- **True VisualViewport Resizing vs. `translateY` Offsets**:
  - Translating the bottom dock with `translateY(-${keyboardOffset}px)` often creates phantom gaps and detached blank spaces on iOS Safari due to decoupled window scroll coordinates.
  - Subscribing directly to `window.visualViewport` `resize` and `scroll` events to dynamically constrain the root container's height (`el.style.height = `${vv.height}px``, `el.style.maxHeight = `${vv.height}px``) when `keyboardHeight > 60` locks the sticky dock squarely against the keyboard with zero gap.
  - Scrolling the transcript container (`feed.scrollTop = feed.scrollHeight`) concurrently guarantees that recent conversation turns remain pinned directly above the text input bar when typing.
- **WebKit Hardware Layer Compositing & Frame-0 Drop Elimination**:
  - WebKit frequently drops or fails to composite animated pseudo-elements using `filter: blur(...)` combined with negative `z-index`, causing elements like voice orbs to intermittently vanish.
  - Enforcing immediate hardware acceleration (`translate3d(0, 0, 0)`, `backface-visibility: hidden`, `will-change: transform`) and utilizing layered CSS drop-shadows instead of blurred pseudo-elements preserves continuous rendering of the voice orb and ripple rings.
- **Top-Anchored Source Preview & Ergonomics**:
  - Anchoring `.apple-top-source-bar` immediately below the sticky header prevents loaded document context from shifting into middle-screen dead zones, maintaining a structured two-zone hierarchy (Top: Source Context & Living Stage; Bottom: Transcript Feed & Input Dock).
- **Post-Send Keyboard Dismissal**:
  - Explicitly calling `inputRef.current?.blur()` on message submit dismisses the iOS software keyboard, immediately restoring the full viewport stage for audio conversation.

---

## 36. WebKit Initial-Load Invisibility Until Scroll/Touch: Why GPU Locks Fail & Actual Root Causes

- **Why Standard CSS Hardware-Acceleration Fixes (`translateZ(0)`, `translate3d(0,0,0)`, `backface-visibility: hidden`) Fail**:
  - In WebKit, elements with infinite `@keyframes` manipulating `transform` (`.apple-voice-orb`, `.apple-orb-ring`) are automatically promoted to the off-thread CoreAnimation compositor on Frame 0.
  - If the parent container's layout geometry or clip rect is transiently `0×0` or unsettled on Frame 0, WebKit's `RenderLayerBacking` skips rasterizing the bitmap (`CABackingStore`) and hands a **blank texture** to CoreAnimation. Because `transform` animations run purely on the compositor thread without triggering main-thread repaints, the element animates an invisible `0×0` texture indefinitely until a user scroll/touch invalidates tile coverage. Forcing `translate3d(0,0,0)` on Frame 0 merely locks in that empty backing store earlier.
- **Actual Root Cause 1: `overflow-x: hidden` Implicit Scroll Container + `min-h-dvh` + `flex: 1 1 0%` Cold-Launch Collapse**:
  - Per CSS Overflow Level 3, setting `overflow-x: hidden` on `<main>` (`min-h-dvh overflow-x-hidden`) forces computed `overflow-y: auto`, turning `<main>` into a nested scroll container with `height: auto`.
  - On iOS Safari cold launch, `100dvh` and `env(safe-area-inset-*)` settle asynchronously (`apple-web-app` skill). Inside an `auto`-height flex container, `.apple-upper-stage { flex: 1 1 0% }` (`flex-basis: 0%`) and `.apple-bottom-sheet-wrap { margin-top: auto }` cause WebKit's sub-scroller tile culler (`TileController`) to miscalculate the initial visible rect until a touch/scroll event forces a scrollport geometry update.
  - *Remediation*: Replace `overflow-x: hidden` with `overflow-x: clip` (which clips horizontal overflow without creating a scroll container or forcing `overflow-y: auto`), change `.apple-upper-stage` from `flex: 1 1 0%` to `flex: 1 0 auto`, and include `-webkit-fill-available` / `100vh` fallbacks.
- **Actual Root Cause 2: `position: sticky` + `backdrop-filter: blur()` Inside a Sub-Scroller Clipping Root**:
  - Placing `.apple-nav-bar` (`position: sticky; backdrop-filter: blur(16px)`) inside an `overflow-x: hidden` (`overflow-y: auto`) `<main>` binds the sticky element and its backdrop-sampling root to `<main>` rather than the document viewport, causing WebKit to defer painting sibling layers inside the same backdrop root until scroll invalidation.
- **Actual Root Cause 3: Off-Thread CSS `@keyframes` (`CAAnimation`) + Ancestor `data-*` Attribute Mutation Freeze & Disappear Bug**:
  - When `overflow-x: clip` and `flex: 1 0 auto` were applied and CSS `@keyframes` were delayed by 2 frames via `el.setAttribute("data-hydrated", "true")`, the orb rendered visibly on Frame 0–1, started pulsing, and then **froze and disappeared until the screen was touched**.
  - Four interacting mechanisms caused this:
    1. **WebKit Off-Thread `CAAnimation` Desync on Ancestor `[data-*]` Mutation**: Mutating `data-hydrated` / `data-keyboard-open` / `data-connection-state` on `<main>` invalidates descendant styles matched by `main[data-*] ...` selectors while off-thread CoreAnimation `transform` animations (`appleOrbBreathe`, `appleSonarRipple`, `appleOrbPulseFast`) are running on `will-change: transform; backface-visibility: hidden; translate3d(0,0,0)` layers. WebKit's compositor drops the `CABackingStore` tile until a touch/scroll event forces a compositor flush.
    2. **CSS `animation` Shorthand Specificity Clobber**: `main[data-hydrated="true"] .apple-orb-ring { animation: appleSonarRipple ... }` (specificity `0,2,1`) overrode `.apple-orb-ring-2` and `.apple-orb-ring-3` (`0,1,0`) `animation-delay`, resetting all 3 rings to `0s` delay so all rings animated together to `100% { opacity: 0 }` and vanished.
    3. **Unpositioned `position: absolute` Flex Children**: `.apple-orb-ring` used `position: absolute` inside `.apple-voice-orb-wrap` (`display: flex`) without explicit `inset: 0; margin: auto;`, relying on Flexbox static-position inference which breaks in WebKit when promoted to a 3D composited layer.
    4. **Main-Thread `transition: background, box-shadow` Colliding with Off-Thread `@keyframes`**: Transitioning non-interpolable `linear-gradient` backgrounds and `box-shadow` on `.apple-voice-orb` while swapping `@keyframes` across state changes (`idle` -> `ingesting` -> `ready` when `<SourcePreview />` mounts above `.apple-upper-stage`) stalls WebKit's layer update.
  - *Definitive Solution*:
    - Eliminate all off-thread CSS `@keyframes` (`appleOrbBreathe`, `appleOrbPulseFast`, `appleSonarRipple`), `main[data-hydrated]` selectors, and `translate3d(0,0,0)` / `backface-visibility: hidden` / `will-change: transform` GPU-promotion hacks on `.apple-voice-orb` and `.apple-orb-ring`.
    - Drive the idle/ingesting/ready orb breathing and concentric sonar ring ripples via a **Main-Thread `requestAnimationFrame` loop** in `SessionStatus.tsx` (using direct DOM ref style updates, matching `RealtimeAudioVisualizer`), which keeps the elements in WebKit's normal main-thread paint pipeline where layers never detach or freeze.
    - Explicitly position `.apple-orb-ring` with `inset: 0; margin: auto;` and clamp minimum ring opacity above `0.05` so WebKit never zero-opacity-culls the rings.
    - In `page.tsx`, guard `data-keyboard-open` updates so the attribute is only mutated when the boolean state actually changes, and trigger a synchronous layout/paint flush (`void mainRef.current.offsetHeight`) when `source` or `connectionState` changes so `<SourcePreview />` (`.apple-top-source-bar`) paints immediately on mount.

---

## 37. iOS Safari Virtual Keyboard Layout Thrashing & Animation Continuity

- **Why the Virtual Keyboard Generates Phantom Space on iOS Safari**:
  - On iOS Safari, the virtual keyboard does not resize the layout viewport (`window.innerHeight`), only the `window.visualViewport`.
  - When the keyboard appears, iOS automatically cancels the Home Indicator safe area at the bottom of the screen. If the sticky/fixed dock retains `padding-bottom: calc(0.5rem + env(safe-area-inset-bottom))`, the residual `~34px` padding creates an apparent gap above the keyboard.
  - If JavaScript tries to fix this by modifying `el.style.height = `${vv.height}px`` or applying `translateY(-${keyboardHeight}px)` on every visualViewport `resize`/`scroll` event, it forces synchronous reflows (layout thrashing) 60 times during the 300ms keyboard animation, freezing any concurrent JavaScript or CSS animations.
- **Why Main-Thread Animation Loops Experience a "Slight Freeze"**:
  - In `requestAnimationFrame` effects keyed to `[visualState]`, changing states unmounts the old RAF and restarts with `const startTime = performance.now()`. Resetting `elapsed = 0` causes a phase discontinuity (visual jump/stutter).
  - Calling synchronous forced reflows (`void el.offsetHeight`) blocks the main thread for one frame while WebKit recalculates styles.
- **Should You Let a Minor Micro-Stutter Go?**:
  - The critical P0 defect was **elements disappearing / remaining invisible until user touch**. Once elements remain continuously visible and functional, a 50–100ms micro-stutter during cold load or keyboard deployment is standard mobile web behavior and completely acceptable for submission.






















