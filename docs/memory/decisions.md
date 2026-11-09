# Architectural Decision Records (ADRs)

This document tracks durable technical and design decisions. Every significant decision must be recorded here with context, options considered, rationale, and consequences.

---

## Baseline Stack & Infrastructure Decisions

### ADR-001: Adopt Recommended Next.js (App Router) + TypeScript Stack
- **Status**: Accepted
- **Context**: The assignment recommends Next.js (App Router) + React + TypeScript for frontend, and Node.js / Next API routes for backend.
- **Decision**: Use Next.js 16 (App Router) with React 19 and TypeScript as a single unified full-stack repository.
- **Consequences**:
  - Unified codebase for UI and server-side ingestion / token routes.
  - Zero CORS overhead for internal API routes.
  - Direct compatibility with standard cloud hosting platforms.

### ADR-002: Test Runner Selection (Vitest)
- **Status**: Accepted
- **Context**: The project requires unit and integration test infrastructure with minimal overhead and native TypeScript support.
- **Decision**: Use Vitest as the test runner instead of Jest.
- **Consequences**:
  - Native ESM and TypeScript support without Babel or `ts-jest` boilerplate.
  - Fast execution and compatibility with modern Node/Next environments.

### ADR-003: Backend Ephemeral Tokens for Realtime Voice Security
- **Status**: Accepted (Refined by **ADR-04** below)
- **Context**: The assignment strictly mandates: *"API keys must never be exposed in the client. All Realtime connections must use ephemeral tokens or authenticated backend routes."*
- **Decision**: Implement a server-side route that uses the private `OPENAI_API_KEY` to request a short-lived ephemeral client session token from OpenAI's REST API (`POST https://api.openai.com/v1/realtime/sessions`), returning only the ephemeral token to the client.
- **Consequences**:
  - Private API keys remain strictly on the server.
  - Browser establishes direct WebRTC audio connection to OpenAI using only the ephemeral token.

---

## Core Architecture & Product Decisions (ADR-01 – ADR-12)

### ADR-01: Unified Ingestion Contract & Source State Model
- **Status**: Accepted
- **Context**: `assignment.pdf` requires both PDF ($\le 25\text{ MB}$) and YouTube transcript ingestion and displaying extracted text in a collapsible preview. Under our approved Context Overflow Policy (**Option 2B**), ingestion must always succeed on valid sources so the full extracted text is available for the UI preview, while context capping (`48,000` characters) and token budgeting belong strictly to the context/session preparation layer.
- **Decision**: Both `POST /api/ingest/pdf` and `POST /api/ingest/youtube` return a unified, discriminated JSON response (`IngestionResult`):
  ```ts
  export type IngestionSuccess = {
    ok: true;
    sourceType: "pdf" | "youtube";
    title: string;           // Filename or YouTube video title/ID
    text: string;            // Full normalized extracted text (never truncated at ingestion)
    charCount: number;
    estimatedTokens: number; // Math.ceil(charCount / 4)
    metadata: {
      pageCount?: number;
      videoId?: string;
      language?: string;
    };
  };

  export type IngestionErrorCode =
    | "INVALID_FILE_TYPE"
    | "FILE_TOO_LARGE"
    | "EMPTY_OR_SCANNED_PDF"
    | "CORRUPTED_OR_ENCRYPTED_PDF"
    | "INVALID_YOUTUBE_URL"
    | "VIDEO_UNAVAILABLE"
    | "CAPTIONS_UNAVAILABLE"
    | "YOUTUBE_CLOUD_IP_BLOCKED"
    | "EXTRACTION_TIMEOUT"
    | "INTERNAL_ERROR";

  export type IngestionError = {
    ok: false;
    code: IngestionErrorCode;
    message: string;
    retryable: boolean;
  };

  export type IngestionResult = IngestionSuccess | IngestionError;
  ```
- **Rationale**: A single normalized ingestion contract decouples the UI preview and Realtime session initialization from source-specific extraction mechanics, guarantees deterministic error handling, and ensures valid files always succeed at ingestion for full-text preview.
- **Consequences**:
  - `"CONTEXT_TOO_LARGE_FOR_REALTIME"` is excluded from `IngestionErrorCode`; ingestion routes never reject valid documents due to token length.
  - Truncation and token budgeting are handled strictly in the context/session preparation layer (**ADR-05**).

---

### ADR-02: Server-Side Spatial PDF Extraction, 25 MB Hosting Target & Non-Negotiable No-OCR Boundary
- **Status**: Accepted (Amended for Spatial Coordinate-Aware Extraction & Multi-Column Reconstruction; Includes **[CRITICAL-1] Option 1A**)
- **Context**: `assignment.pdf` requires server-side extraction of PDFs up to `25 MB` working in the deployed app and evaluates Ingestion Quality at the `"4 - Exceptional"` level based on handling edge cases in PDF parsing. Naive stream-order extraction (such as basic `pdf-parse`) interleaves text horizontally across multi-column layouts and emits excessive blank lines over vertical voids left by embedded images. Additionally, Vercel Serverless Functions enforce a `4.5 MB` request body limit at their edge proxy, and scanned/image-only PDFs contain no text layer (OCR is out of scope).
- **Decision**:
  1. **Deployment Target (`[CRITICAL-1]` Option 1A)**: Target container hosting (Render / Railway) where the Node.js server natively accepts `25 MB` `multipart/form-data` uploads without external object-storage dependencies; document Vercel's `4.5 MB` serverless edge proxy limit in `README.md`.
  2. **Runtime & Validation**: Run `POST /api/ingest/pdf` explicitly on the Node.js runtime (`export const runtime = "nodejs"`). Validate that an uploaded `File` is present, has MIME type `application/pdf` (or `.pdf` extension), begins with the `%PDF-` magic header, and has `0 < size <= 25 * 1024 * 1024` bytes (`26,214,400` bytes).
  3. **Spatial Coordinate-Aware Extraction (`pdfjs-dist` / `pdfexcavator`)**:
     - Replace naive stream-order extraction (e.g., basic `pdf-parse`) with spatial coordinate-aware extraction using `pdfjs-dist` / `pdfexcavator`.
     - **Multi-Column Gutter Detection & Logical Reading Order**: Detect vertical column gutters and reconstruct logical reading order (reading Column 1 top-to-bottom in full before proceeding to Column 2 top-to-bottom) to prevent horizontal sentence interleaving across columns.
     - **Vertical Void Collapsing**: Collapse large vertical voids caused by embedded images or figures into clean paragraph breaks (`\n\n`) rather than emitting runs of blank lines.
  4. **No-OCR Enforcement**: If the extracted text after trimming whitespace contains fewer than **`20` non-whitespace characters**, reject with HTTP `422` and `code: "EMPTY_OR_SCANNED_PDF"` (*"This PDF contains no extractable text (it may be a scanned image). OCR is not supported; please upload a text-based PDF."*).
  5. **Malformed / Encrypted PDFs**: Catch password-protected or corrupted PDF parser exceptions and return HTTP `422` with `code: "CORRUPTED_OR_ENCRYPTED_PDF"`.
- **Rationale**: Spatial coordinate-aware extraction with column gutter detection and vertical void collapsing prevents garbled horizontal sentence interleaving on multi-column academic/business PDFs, while strict byte-size, magic-byte, and minimum-text-density checks enforce the 25 MB limit and the non-negotiable No-OCR boundary.
- **Consequences**:
  - Multi-column PDFs are extracted in coherent human reading order suitable for priming the Realtime voice assistant.
  - Users uploading scanned PDFs receive an immediate, actionable error and can retry with another file.

---

### ADR-03: Server-Side YouTube Transcript Extraction & Cloud IP Block Mitigation
- **Status**: Accepted
- **Context**: YouTube offers no official API for third-party video captions and blocks cloud datacenter IPs on unofficial endpoints. Users also provide diverse YouTube URL formats.
- **Decision**:
  1. **URL Parser**: Parse and extract the 11-character YouTube `videoId` across all standard URL formats (`youtube.com/watch?v=`, `youtu.be/`, `youtube.com/shorts/`, `youtube.com/embed/`, `youtube.com/live/`, `m.youtube.com`). Reject non-YouTube domains or malformed IDs with HTTP `400` (`code: "INVALID_YOUTUBE_URL"`).
  2. **Server-Side Transcript Fetcher**: Fetch captions server-side in `POST /api/ingest/youtube` (`export const runtime = "nodejs"`), preferring English (`en`/`en-US`) when multiple caption tracks exist and falling back to the first available manual or auto-generated track. Decode HTML entities (`&#39;`, `&amp;`, `&quot;`, etc.) and join segments into clean prose without raw XML tags or timestamps.
  3. **Cloud IP Block Bonus & Fallback**:
     - Support an optional `YOUTUBE_PROXY_URL` server environment variable so cloud deployments can route YouTube requests through a residential proxy.
     - Distinguish between missing/disabled captions (`code: "CAPTIONS_UNAVAILABLE"`, HTTP `422`) and YouTube datacenter IP blocks / HTTP `403` / `429` / `LOGIN_REQUIRED` (`code: "YOUTUBE_CLOUD_IP_BLOCKED"`, HTTP `503`), returning a clear explanation and allowing retry.
- **Rationale**: Combining multi-format URL parsing, optional proxy routing for cloud deployments, and distinct error codes for missing captions vs. datacenter IP blocks maximizes reliability while transparently handling YouTube's anti-bot restrictions.
- **Consequences**:
  - Works out of the box locally and on residential/proxied networks; fails gracefully with a self-explanatory error message on unproxied cloud IPs.

---

### ADR-04: Ephemeral Token Minting & Secret Isolation (`POST /api/realtime/session`)
- **Status**: Accepted (Includes Resolution of **[CRITICAL-3] Option 3A** & `whisper-1` adjustment)
- **Context**: Browser WebRTC sessions must authenticate via short-lived ephemeral tokens without exposing `OPENAI_API_KEY`, using official OpenAI Realtime session parameters.
- **Decision**:
  1. Implement `POST /api/realtime/session` on the Node.js runtime (`export const runtime = "nodejs"`).
  2. Read `process.env.OPENAI_API_KEY` strictly on the server. If missing, return HTTP `500` with `{ ok: false, code: "SERVER_MISCONFIGURED", message: "..." }`.
  3. Request an ephemeral session from `POST https://api.openai.com/v1/realtime/sessions` with:
     - `model`: `process.env.OPENAI_REALTIME_MODEL || "gpt-4o-realtime-preview"`
     - `modalities`: `["audio", "text"]`
     - `voice`: `"alloy"` (or configurable default)
     - `instructions`: Grounded system prompt built by the context layer (**ADR-05**)
     - `input_audio_transcription`: `{ model: "whisper-1" }`
     - `turn_detection`:
       ```json
       {
         "type": "server_vad",
         "threshold": 0.5,
         "prefix_padding_ms": 300,
         "silence_duration_ms": 500,
         "create_response": true,
         "interrupt_response": true
       }
       ```
  4. Return `{ ok: true, ephemeralKey: data.client_secret.value, expiresAt: data.client_secret.expires_at, model }` with header `Cache-Control: no-store`.
- **Rationale**: Minting single-use, `no-store` ephemeral tokens via `/v1/realtime/sessions` with `gpt-4o-realtime-preview` and `whisper-1` transcription keeps `OPENAI_API_KEY` server-only and matches official OpenAI Realtime parameters.
- **Consequences**:
  - Every WebRTC session receives a fresh ephemeral token pre-configured with Server VAD and `whisper-1` user speech transcription.

---

### ADR-05: Direct Context Priming Strategy & 48,000-Character Safe Cap
- **Status**: Accepted (Includes Resolution of **[CRITICAL-2] Option 2B** & `48,000`-character cap adjustment)
- **Context**: Extracted text must prime the Realtime session without chunking, summarization, or RAG. OpenAI Realtime `session.instructions` has a hard `16,384`-token limit (and `32,000` total context window), whereas `conversation.item.create` items can be evicted during rolling conversation truncation.
- **Decision**:
  1. **Full Text UI Preview**: Always display the complete, untruncated `text` returned by ingestion inside the collapsible UI preview (satisfying Review Script Step 2 *"Upload a PDF and confirm full text extraction"*).
  2. **48,000-Character (`~12,000`-Token) Safe Realtime Context Cap**:
     - Define `MAX_REALTIME_CONTEXT_CHARS = 48_000` (`~12,000` tokens, providing a safe `>4,000`-token buffer beneath OpenAI's `16,384` instruction token limit).
     - If `text.length > 48_000`, slice the context passed to the Realtime session to `text.slice(0, 48_000)`, set `isContextTruncated = true`, and render a clear, non-blocking UI warning banner: *"This source exceeds the Realtime voice context limit (~12,000 tokens). Full text is shown in the preview, and the voice assistant is primed with the first 48,000 characters."*
  3. **Pinning in `session.instructions`**: Embed the prepared context (`<= 48,000` chars) with source metadata (`title`, `sourceType`) and grounding rules inside `session.instructions` (sent during `/api/realtime/session` creation and reinforced via `session.update` on data channel open).
- **Rationale**: Pinning up to `48,000` characters (`~12,000` tokens) in `session.instructions` guarantees a safe buffer under the `16,384` instruction token ceiling, prevents rolling conversation truncation from dropping the source mid-call, preserves full-text UI preview, and strictly obeys the no-chunking/no-RAG constraint.
- **Consequences**:
  - Large PDFs and long YouTube videos never crash session initialization while still displaying 100% of extracted text in the preview.

---

### ADR-06: WebRTC Session Lifecycle & Deterministic Resource Teardown
- **Status**: Accepted (Amended for WebRTC `<audio>` MediaStream Persistence & Teardown Boundary)
- **Context**: Managing asynchronous browser states across ingestion, token minting, microphone capture, SDP exchange (`POST https://api.openai.com/v1/realtime/calls`), active conversation, and teardown requires strict lifecycle control to prevent memory leaks, browser autoplay lockouts, or stuck mobile microphone indicators.
- **Decision**:
  1. Implement an explicit client session state machine:
     - Primary states: `idle` -> `ingesting` -> `ready` -> `connecting` -> `connected` -> `reconnecting` -> `error`.
     - Conversation flow sub-states (when `connected`): `listening`, `user_speaking`, `assistant_thinking`, `assistant_speaking`.
  2. **WebRTC MediaStream Audio Element Invariant**:
     - The remote HTML5 `<audio>` element bound to the WebRTC downstream `MediaStream` (`audioElement.srcObject = remoteStream`) MUST remain attached and playing (`audioElement.paused === false`) for the entire duration of the active call session.
     - **NEVER** call `audioElement.pause()` during active conversation turns, speech interruptions, or barge-in events. An `<audio>` element connected to a real-time RTP stream is a continuous media decoder sink, not a static file playback buffer. Pausing it disrupts the live WebRTC decoding pipeline and trips browser Autoplay Policy restrictions: because subsequent assistant responses arrive via asynchronous `RTCDataChannel` network events (which possess zero user gesture context), any subsequent `.play()` call rejects with `NotAllowedError`, causing permanent voice silence.
  3. Enforce a deterministic `cleanupSession()` routine invoked ONLY on explicit call termination (clicking `"Stop"`, switching to a new PDF/YouTube source while connected, or component unmount) that synchronously:
     - Calls `track.stop()` on all local `MediaStreamTrack`s.
     - Pauses the remote `<audio>` element (`audioElement.pause()`), removes event listeners, and releases media resources by setting `audioElement.srcObject = null`.
     - Closes the `oai-events` `RTCDataChannel` and `RTCPeerConnection`.
- **Rationale**: Keeping the `<audio>` element active and playing throughout the call preserves browser autoplay authorization established during the initial user gesture ("Start Voice Chat"), preventing unhandled `NotAllowedError` rejections and post-interruption audio deadlocks while ensuring clean teardown on call exit.
- **Consequences**:
  - Voice output transitions seamlessly across multiple conversational turns without requiring repeated user activation.
  - Final teardown cleanly releases audio decoders, peer connections, and local microphone hardware.

---

### ADR-07: Speech Interruption (Barge-In), Stream Silence & Natural Follow-Up (Review Script Step 3)
- **Status**: Accepted (Amended for Wire/Mute Audio Silence & Server VAD Cancellation Semantics)
- **Context**: Review Script Step 3 mandates: *"Test on mobile: start a voice conversation, interrupt, follow up naturally."* When interrupting or barging in, halting assistant voice output must never pause the underlying HTML5 `<audio>` element (ADR-06), and client signaling must not race with native Server VAD cancellation.
- **Decision**:
  1. **Automatic Voice Barge-In via Server VAD**:
     - Rely on WebRTC + Server VAD (`turn_detection: { type: "server_vad", interrupt_response: true }`). When user speech is detected, OpenAI's server automatically halts outbound RTP audio packets, cancels the active response, and broadcasts `input_audio_buffer.speech_started` followed by `response.done (status: "cancelled")`.
     - **No Redundant Client Cancellation on Speech Started**: Because the server cancels the response natively under `interrupt_response: true`, client code MUST NOT send a redundant `{ type: "response.cancel" }` over `oai-events` upon receiving `speech_started`. Sending an unprompted `response.cancel` creates a protocol race condition where the server rejects the request with `response_cancel_not_active` errors.
  2. **Immediate Client State Sync & Wire/Mute Audio Silence**:
     - Upon receiving `input_audio_buffer.speech_started` over `oai-events` while the assistant is speaking, immediately transition the conversation sub-state to `user_speaking` and finalize the interrupted assistant transcript item in the UI (preserving already-spoken words).
     - **Mechanism for Instant Silence (No DOM Pausing)**: The `<audio>` element is NEVER paused (`audioElement.pause()` is strictly forbidden during interruption). Instantaneous silencing of residual jitter-buffer frames is achieved either on the wire (OpenAI server cutting off outbound RTP packets) or via client-side muting (temporarily setting `audioElement.muted = true` or `remoteTrack.enabled = false` until `output_audio_buffer.cleared` / `response.done`, then unmuting). The media pipeline remains continuously authorized and active.
  3. **Manual Interrupt Control**:
     - Provide a tappable **"Interrupt"** button active while the assistant is speaking. Tapping "Interrupt" is an explicit user action that sends `{ type: "response.cancel" }` and `{ type: "output_audio_buffer.clear" }` over `oai-events`, transitions state to `listening`, and silences output without pausing the `<audio>` element.
  4. **Seamless Subsequent Turn Playback**:
     - Because `audioElement.paused` remains `false` throughout the interruption, subsequent assistant responses (whether triggered by user speech via Server VAD or text prompt via data channel) resume audio playback immediately and automatically through the live WebRTC track without requiring user clicks or triggering Autoplay Policy rejections.
- **Rationale**: Relying on server-side wire cutoff and transient muting instead of DOM pausing respects the WebRTC MediaStream lifecycle and browser Autoplay policies, eliminating post-interruption voice silence while preventing protocol race conditions on automatic barge-in.
- **Consequences**:
  - Barge-in and manual interruption feel instantaneous and natural.
  - The voice assistant never goes silent on follow-up turns after an interruption.

---

### ADR-08: Real-Time Conversation Transcript Synchronization
- **Status**: Accepted
- **Context**: Asynchronous user input transcription (`whisper-1` via `conversation.item.input_audio_transcription.*`) runs in parallel with assistant response generation, so assistant transcript deltas often arrive before the user's completed speech transcription.
- **Decision**:
  1. Insert a user transcript placeholder (`role: "user"`, `status: "transcribing"`) keyed by `item_id` as soon as user speech commits (`input_audio_buffer.speech_stopped` / `conversation.item.created`), locking in chronological turn order before the assistant's reply bubble is created.
  2. Update the user transcript item on `conversation.item.input_audio_transcription.delta` and finalize on `conversation.item.input_audio_transcription.completed`.
  3. Stream assistant transcript text by handling both `response.audio_transcript.delta` and `response.output_audio_transcript.delta` (and `response.text.delta` / `response.output_text.delta`), finalizing on `.done`.
- **Rationale**: Creating chronological turn placeholders on `item_id` creation prevents out-of-order chat bubbles when asynchronous `whisper-1` user transcription finishes after the assistant starts speaking.
- **Consequences**:
  - Conversation transcript always reflects true chronological turn order (`User` -> `Assistant`).

---

### ADR-09: Text-Based Chat Fallback When Microphone Is Unavailable
- **Status**: Accepted
- **Context**: `assignment.pdf` requires: *"If a microphone is unavailable, allow fallback to a text-based chat mode."*
- **Decision**:
  1. **Automatic Fallback on Mic Failure**: If `navigator.mediaDevices?.getUserMedia({ audio: true })` is unavailable or rejects (`NotAllowedError`, `NotFoundError`, `NotReadableError`, `OverconstrainedError`), do not fail the session. Transition automatically into **Text Fallback Mode** (`micStatus: "unavailable"`), display a clear status notice (*"Microphone unavailable — using text chat mode"*), and focus the text input bar.
  2. **Mic-Less WebRTC Connection**: When connecting without a local microphone track, invoke `pc.addTransceiver("audio", { direction: "recvonly" })` prior to `pc.createOffer()` so the session still establishes the `oai-events` data channel and downstream model audio stream.
  3. **Text Turn Dispatch**: Sending a text message dispatches `{ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } }` followed by `{ type: "response.create" }` over `oai-events` and appends the user message to the transcript.
  4. **Mute Control**: When a microphone is present, toggling Mute sets `localAudioTrack.enabled = !isMuted` without dropping the WebRTC connection, while also allowing text input at any time.
- **Rationale**: Using a `recvonly` WebRTC audio transceiver plus `oai-events` data channel messages when `getUserMedia` fails keeps the architecture unified on OpenAI Realtime WebRTC while providing a seamless text chat fallback.
- **Consequences**:
  - Evaluators or users without a microphone (or with denied permissions) can still converse with the document/video in real time.

---

### ADR-10: Poor Network Handling & Connection Resilience (Review Script Step 4)
- **Status**: Accepted
- **Context**: Review Script Step 4 states: *"Test under poor network conditions to assess stability."*
- **Decision**:
  1. **HTTP Fetch Timeouts**: Enforce explicit `AbortController` timeouts on ingestion (`30,000 ms`) and session token minting (`15,000 ms`), surfacing a retryable error state without losing the user's selected file or URL.
  2. **10-Second ICE Disconnect Grace Period**:
     - Monitor `pc.onconnectionstatechange` and `pc.oniceconnectionstatechange` (plus `window` `offline`/`online` events).
     - When `iceConnectionState` or `connectionState` enters `"disconnected"`, transition UI state to `"reconnecting"` (*"Network unstable — attempting to recover..."*) and start a `10,000 ms` grace timer.
     - If the connection recovers to `"connected"`/`"completed"` within `10,000 ms`, clear the timer and resume `"connected"` status seamlessly.
  3. **Graceful Failure & One-Tap Reconnect**:
     - If `connectionState`/`iceConnectionState` enters `"failed"` or the `10,000 ms` timer expires, run `cleanupSession()`, **preserve the existing conversation transcript and extracted source context in UI state**, transition to `"error"`, and show a **"Reconnect Voice Session"** button.
  4. **Guarded Data Channel Sends**: Check `dataChannel.readyState === "open"` before calling `dataChannel.send(...)` to prevent unhandled `DOMException` crashes during packet loss or disconnect.
- **Rationale**: Combining explicit fetch timeouts, a 10-second ICE recovery grace period, transcript-preserving session reconnection, and guarded data-channel sends ensures the app never crashes or loses user progress on flaky mobile networks.
- **Consequences**:
  - Brief mobile network blips self-heal automatically; severe drops preserve transcript history and recover in one tap.

---

### ADR-11: Mobile-First UI/UX, iOS Safe-Area Architecture & Acoustic Echo Cancellation (`~390 px`)
- **Status**: Accepted (Amended with `apple-web-app` skill best practices & acoustic DSP constraints)
- **Context**: `assignment.pdf` requires a simple, mobile-first design optimized for `~390 px` width screens with clear session controls and collapsible text preview. On real iPhones (Safari and standalone Web App), unpolished experiences stem from missing safe-area insets (`viewport-fit=cover`, notch/Dynamic Island collisions, home indicator bar overlap), grey tap flashes, rubber-banding under sticky bars, and—most critically—false barge-in feedback loops on phone loudspeakers when using unconstrained `{ audio: true }` without hardware Acoustic Echo Cancellation (AEC).
- **Decision**:
  1. **Edge-to-Edge Safe-Area Architecture (`viewport-fit=cover`)**:
     - Export Next.js `Viewport` configuration with `viewportFit: "cover"` (`width: "device-width"`, `initialScale: 1`). Without `viewport-fit=cover`, WebKit ignores notches and home indicators, reporting `env(safe-area-inset-*) = 0px`.
     - Mirror `env()` values into `:root` CSS variables once: `--safe-area-inset-top`, `--safe-area-inset-bottom`, `--safe-area-inset-left`, `--safe-area-inset-right`.
     - Header sizing must be `calc(3.5rem + var(--safe-area-inset-top))` with `padding-top: var(--safe-area-inset-top)`.
     - Sticky bottom controls dock must pad bottom by `calc(var(--safe-area-inset-bottom) + 0.75rem)` so buttons and inputs clear the iOS Home Indicator swipe bar.
     - **Safe-Area Inset Rule**: Top inset is legitimately `0px` on non-notched devices (iPhone SE), landscape orientations, and desktop. Layouts must always express bar dimensions as `base + inset`, never as inset alone, and never branch on `inset > 0`.
  2. **Hardware Acoustic Echo Cancellation & Anti-Feedback Constraints**:
     - Replace naive `getUserMedia({ audio: true })` in both `src/app/page.tsx` and `src/lib/realtime/connection.ts` with explicit hardware DSP constraints:
       ```typescript
       {
         audio: {
           echoCancellation: true,
           noiseSuppression: true,
           autoGainControl: true,
         },
       }
       ```
     - Set `track.contentHint = "speech"` on captured microphone tracks.
     - **Loudspeaker False Barge-In Prevention**: Mandating `echoCancellation: true` activates iOS WebKit's hardware VoiceProcessingIO AudioUnit. This prevents the phone's bottom speaker output from leaking into the adjacent microphone and falsely triggering OpenAI Server VAD `speech_started` / `response.cancel` interruption loops.
  3. **Touch Ergonomics & Safari Viewport Containment**:
     - Enforce minimum `44x44 px` touch targets on all interactive buttons and `16px` (`text-base`) input font size to prevent iOS Safari auto-zoom on focus.
     - Apply `-webkit-tap-highlight-color: transparent` globally to eliminate grey flash rectangles on touch.
     - Apply `touch-action: manipulation` to all buttons, tabs, inputs, and controls to eliminate 300ms tap delay and suppress double-tap zoom while preserving pinch-to-zoom for accessibility.
     - Apply `overscroll-behavior-y: contain` and `isolation: isolate` on the main scroll root to stop rubber-band bouncing behind fixed/sticky bars and stabilize `backdrop-filter` compositing.
     - Apply `user-select: none` on interactive chrome (headers, buttons, footer dock) to prevent accidental text selection callouts during rapid tapping.
     - Apply `body { text-size-adjust: 100%; -webkit-text-size-adjust: 100%; }` to prevent font inflation on orientation change.
  4. **Collapsible Source Preview & Gesture-Bound Audio Autoplay**:
     - Display full extracted text in a collapsible preview container with token counts and the 48k-character warning banner (**ADR-05**), collapsing by default during calls so it does not crowd the viewport.
     - Attach remote audio to `<audio autoPlay playsInline>` and invoke `.play()` synchronously within the user click gesture of "Start Voice Chat".
  5. **Apple Web App Metadata & Status Bar Tinting**:
     - Configure Apple web app metadata: `apple-mobile-web-app-capable: yes`, `apple-mobile-web-app-status-bar-style: black-translucent`, `apple-mobile-web-app-title: TalkToMe`, and `format-detection: { telephone: false }`.
     - Maintain solid, opaque backgrounds on top header and body (`#f8fafc` / `#ffffff`) so Safari 26 edge-color sampling reliably tints status and address bars without transparent gradient bleed.
- **Rationale**: Designing holistically around WebKit edge-to-edge safe areas, touch-action ergonomics, and hardware VoiceProcessingIO echo cancellation eliminates both visual layout defects (notch overlap, home bar interference, rubber-banding) and acoustic conversational failure modes (false barge-in loops on phone loudspeakers).
- **Consequences**:
  - Polished, native-app feel on iPhone Safari and Home Screen PWA.
  - Conversational speech flows naturally over phone loudspeakers without self-interruption.

---

### ADR-12: Stateless Storage Scope & Bounded In-Memory Caching
- **Status**: Accepted
- **Context**: `assignment.pdf` states *"In-memory or lightweight database (e.g., SQLite) is sufficient. No persistent user authentication required."*
- **Decision**: Keep backend routes stateless without SQLite/filesystem writes, using a lightweight bounded in-memory LRU/TTL cache (e.g., max 25 entries, 15-minute TTL) keyed by YouTube `videoId` or PDF SHA-256 hash to accelerate repeated demos while maintaining compatibility with ephemeral/read-only cloud filesystems.
- **Rationale**: Stateless API routes with a bounded in-memory cache satisfy all functional requirements while remaining 100% compatible with both serverless and container cloud hosts.
- **Consequences**:
  - Zero database setup friction and faster repeat ingestion during live demos.

---

### ADR-13: Production Containerization, Runtime Hardening & Public Cloud Hosting (Render / Railway)
- **Status**: Accepted
- **Context**: Deliverable #1 of `assignment.pdf` requires a publicly hosted web application ready to demo and evaluate across the 5-step Review Script (YouTube caption ingestion, $\le 25\text{ MB}$ PDF upload and full text extraction, mobile WebRTC voice conversation with barge-in interruption, poor network resilience, and strict secret isolation). In **ADR-02 (`[CRITICAL-1] Option 1A`)**, we selected container hosting (Render / Railway) to avoid Vercel's `4.5 MB` serverless payload ceiling. Furthermore, our spatial PDF extractor (`src/lib/ingest/pdf.ts`, Lesson Learned §8) dynamically imports `pdfjs-dist` (`legacy/build/pdf.mjs` and `pdf.worker.mjs`) via `/* webpackIgnore: true */` and loads `standard_fonts/` and `cmaps/` from `path.join(process.cwd(), "node_modules", "pdfjs-dist")`, which standard bundler tree-shaking (`@vercel/nft` standalone trace) would omit if not explicitly preserved in the container runtime image.
- **Decision**:
  1. **Multi-Stage Debian Slim Container Architecture (`Dockerfile`)**:
     - **Base Image**: Standardize on `node:20-bookworm-slim` across build and runtime stages to guarantee GNU `glibc` compatibility for Node.js and `pdfjs-dist` while keeping the compressed image footprint compact (`<250 MB`) and free of unnecessary build toolchains.
     - **Stage 1 (`builder`)**:
       - Set `WORKDIR /app`.
       - Copy `package.json` and `package-lock.json` and run `npm ci` for deterministic lockfile installation.
       - Copy source files (`src/`, `tsconfig.json`, `next.config.ts`, `postcss.config.*`, etc.) and execute `npm run build` (`next build`).
       - Execute `npm prune --omit=dev` to strip all development dependencies (`typescript`, `vitest`, `eslint`, `tailwindcss`, `@types/*`), retaining strictly the 4 production dependencies (`next`, `react`, `react-dom`, `pdfjs-dist`).
     - **Stage 2 (`runner`)**:
       - Start from a clean `node:20-bookworm-slim` image with `WORKDIR /app`.
       - Set `ENV NODE_ENV=production`, `ENV NEXT_TELEMETRY_DISABLED=1`, `ENV HOSTNAME=0.0.0.0`, `ENV PORT=3000`, and `ENV NODE_OPTIONS="--max-old-space-size=384"`.
       - Copy `--chown=node:node` the pruned `/app/node_modules` (preserving `/app/node_modules/pdfjs-dist/legacy/build/pdf.mjs`, `pdf.worker.mjs`, `standard_fonts/`, and `cmaps/` on disk without modifying `next.config.ts`), `/app/.next`, `/app/package.json`, and `/app/next.config.ts`.
       - Switch to the unprivileged `USER node` (UID `1000`) and launch via PID-preserving `exec` (`CMD ["sh", "-c", "exec ./node_modules/.bin/next start -H ${HOSTNAME:-0.0.0.0} -p ${PORT:-3000}"]`) so `SIGTERM`/`SIGINT` signals reach `next-server` cleanly during zero-downtime container rollouts.
  2. **Build-Time & Runtime Secret Isolation (`.dockerignore` & Platform Env)**:
     - Enforce a strict `.dockerignore` excluding `.env`, `.env.*`, `.git`, `node_modules`, `.next`, `tests`, `coverage`, and `docs/memory` so local secrets or test artifacts are never baked into Docker image layers.
     - Inject `OPENAI_API_KEY` (mandatory) and `YOUTUBE_PROXY_URL` (optional) strictly at container runtime via the Render/Railway environment secret manager. Never bake secrets via `ARG` or `ENV` in the `Dockerfile`, and never use `NEXT_PUBLIC_*` prefixes.
  3. **Network, Memory & Ingestion Boundaries in Cloud Containers**:
     - **25 MB PDF Boundary & V8 Heap**: Render and Railway edge proxies natively allow `multipart/form-data` bodies $\ge 25\text{ MB}$ (`26,214,400` bytes). Setting `NODE_OPTIONS="--max-old-space-size=384"` ensures V8 proactively garbage-collects transient `25 MB` `ArrayBuffer`/`Uint8Array` clones during `pdfjs-dist` worker transfer well below standard `512 MB` container cgroup OOM limits, while `ingestionCache` (`ADR-12`) stores only extracted text strings (`~50–200 KB`), never raw binary PDF buffers.
     - **Cloud IP YouTube Egress (`ADR-03`)**: Mitigate datacenter IP blocks via the three-tier strategy in `src/lib/ingest/youtube.ts`: (1) InnerTube Android player client (`com.google.android.youtube/20.10.38`) to bypass web `&exp=xpe` PoToken empty responses, (2) optional `YOUTUBE_PROXY_URL` routing with `*.youtube.com` SSRF validation, and (3) deterministic `503 YOUTUBE_CLOUD_IP_BLOCKED` error reporting when unproxied cloud IPs are challenged.
  4. **Public HTTPS & Direct WebRTC Media Topology**:
     - Terminate TLS (`https://`) at the Render (`*.onrender.com`) or Railway (`*.up.railway.app`) public edge load balancer, satisfying the mandatory browser **Secure Context** requirement for mobile Safari and Chrome `navigator.mediaDevices.getUserMedia()`.
     - Keep all WebRTC UDP/SRTP audio streams and `oai-events` `RTCDataChannel` traffic direct between the user's mobile browser and OpenAI's Realtime edge (`POST https://api.openai.com/v1/realtime/calls`), using the container strictly for stateless HTTP control-plane routes (`/api/ingest/*`, `/api/realtime/session`, `/api/health`).
  5. **Operational Readiness, Health Endpoint (`GET /api/health`) & Deployment Contracts (`src/lib/deploy/config.ts`)**:
     - Implement `src/types/deploy.ts` and `src/lib/deploy/config.ts` exporting:
       - `resolveServerPort(env?)`: Validates integer `PORT` in `[1, 65535]`, defaulting to `3000`.
       - `resolveBindHostname(env?)`: Defaults to `"0.0.0.0"`.
       - `checkPdfEngineAssets(baseDir?)`: Verifies filesystem existence of `legacy/build/pdf.mjs`, `legacy/build/pdf.worker.mjs`, `standard_fonts`, and `cmaps` under `node_modules/pdfjs-dist`.
       - `getDeploymentHealth(options?)`: Produces a deterministic `DeploymentHealthPayload`:
         ```ts
         export type HealthStatus = "ok" | "degraded" | "error";

         export interface DeploymentHealthPayload {
           ok: boolean;
           status: HealthStatus;
           timestamp: string;
           uptimeSeconds: number;
           environment: string;
           checks: {
             pdfEngine: "ok" | "missing";
             openaiConfigured: boolean;       // Strictly boolean; never leaks key value/prefix/length
             youtubeProxyConfigured: boolean; // Strictly boolean; never leaks proxy URL
           };
           limits: {
             maxPdfSizeBytes: number;         // 26_214_400
             maxRealtimeContextChars: number; // 48_000
           };
           missingAssets?: string[];
         }
         ```
       - `validateDockerfileSpec(content)` & `validateDockerignoreSpec(content)` and canonical manifest generators (`getCanonicalDockerfile()`, `getCanonicalDockerignore()`, `getCanonicalRenderManifest()`, `getCanonicalRailwayManifest()`).
     - Implement `GET /api/health` (`src/app/api/health/route.ts`, `export const runtime = "nodejs"`) returning HTTP `200` (`status: "ok"` when `pdfEngine === "ok"` and `openaiConfigured === true`; `status: "degraded"` when `pdfEngine === "ok"` and `openaiConfigured === false`) or HTTP `503` (`status: "error"` when `pdfEngine === "missing"`), always with `Cache-Control: no-store`.
- **Rationale**: A multi-stage `node:20-bookworm-slim` container that preserves pruned `node_modules/pdfjs-dist` on disk, runs as non-root `USER node`, binds `0.0.0.0:$PORT`, caps V8 old-space heap at `384 MB`, and exposes a zero-external-IO `/api/health` probe guarantees deterministic builds, fast cold starts, native `25 MB` PDF ingestion, and reliable zero-downtime deployments on Render and Railway without modifying protected Next.js configuration files.
- **Consequences**:
  - Container health checks immediately verify `pdfjs-dist` worker/font/CMap integrity on startup without spending OpenAI API quota.
  - Evaluators testing on mobile over public HTTPS get uninterrupted WebRTC voice sessions and `25 MB` PDF extraction.

