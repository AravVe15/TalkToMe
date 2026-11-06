# Project Requirements & Verifiable Acceptance Criteria

This document captures the functional, non-functional, and deliverable requirements derived directly from [`assignment.pdf`](../../assignment.pdf) along with the verifiable acceptance criteria (`AC-01` through `AC-12`) corresponding to the approved Architecture Decision Records in [`docs/memory/decisions.md`](./decisions.md). It serves as the durable specification for `test-writer`, `implementer`, and `reviewer`.

---

## 1. Objective

Build a mobile-first web application that allows users to interact with uploaded documents or YouTube videos through live, voice-based conversations powered by OpenAI's Realtime API.

Core flow:
1. Accept a YouTube URL (with accessible transcript/captions) OR a PDF file ($\le 25\text{ MB}$).
2. Extract text from the provided source server-side.
3. Display the full extracted text in a collapsible preview and use it to prime a conversational context.
4. Initiate a live voice conversation with OpenAI's Realtime API (WebRTC), allowing the user to ask spoken questions, interrupt naturally, and receive spoken answers in real time.
5. Deliver an intuitive, responsive, mobile-first experience (`~390 px` viewport).

---

## 2. Mandatory Functional Requirements

### 2.1 Ingestion
- **PDF Upload**:
  - Accept PDF file uploads up to `25 MB` (`26,214,400` bytes). Rejects oversized requests early via `Content-Length` header check or body size with HTTP `413`.
  - Validate MIME types accepting `application/pdf`, `application/x-pdf`, or `application/octet-stream` with a `.pdf` extension.
  - Text extraction must occur server-side (`POST /api/ingest/pdf` on Node.js runtime) using spatial coordinate-aware extraction (`pdfjs-dist` legacy build) operating on standard unmodified page viewports (`612pt`) with multi-column gutter detection (reading Column 1 top-to-bottom before Column 2) and collapsing large vertical voids caused by embedded images into clean paragraph breaks (`\n\n`).
  - PDF ingestion must work in the deployed application (hosted on a container platform such as Render/Railway for native 25 MB payload support; Vercel's 4.5 MB serverless body limit is documented in `README.md`).
  - **Fixed Boundary (No OCR)**: Only text-based PDFs are supported. Scanned/image-only or blank PDFs must return a clear, typed error (`EMPTY_OR_SCANNED_PDF`) and allow the user to retry.
- **YouTube Ingestion**:
  - Accept a YouTube video URL with accessible transcript or captions (`POST /api/ingest/youtube` on Node.js runtime).
  - Transcript retrieval must occur server-side with SSRF hostname validation on caption track URLs (restricted to `*.youtube.com` and `youtube.com`) and support for `YOUTUBE_PROXY_URL` routing across all outbound requests.
  - Local demonstration is acceptable if cloud provider IP ranges are blocked by YouTube; deployed functionality via optional `YOUTUBE_PROXY_URL` is supported as a bonus, with clear `YOUTUBE_CLOUD_IP_BLOCKED` error reporting when unproxied cloud IPs are blocked.
- **Preview**:
  - Always display the full, untruncated extracted text to the user in a collapsible preview format before and during the conversation.

### 2.2 Context Preparation
- Once text is extracted, make it available for use as context in an OpenAI Realtime session via `session.instructions`.
- **Fixed Boundary (No Chunking, Summarization, or RAG)**: Extracted text is passed directly without chunking, summarization, citation pipelines, or retrieval.
- **Context Overflow Policy (Option 2B — 48,000-Character Cap)**:
  - Full extracted text is always returned by ingestion and displayed in the UI preview.
  - For the Realtime voice session, cap the context injected into `session.instructions` at **`48,000` characters (`~12,000` tokens)** to stay safely within OpenAI's `16,384` instruction token limit.
  - When `text.length > 48,000`, slice the Realtime session context to the first `48,000` characters and display an explanatory, non-blocking warning banner in the UI.

### 2.3 Voice Conversation
- Include a **"Start Voice Chat"** button to establish a live WebRTC session with the OpenAI Realtime Voice API (`POST /v1/realtime/sessions` with `gpt-4o-realtime-preview`).
- The user can speak questions, interrupt (barge in) naturally while the assistant is speaking, and hear spoken answers in real time.
- Display a real-time text transcript of the ongoing conversation (both user speech via `whisper-1` and assistant responses).
- If a microphone is unavailable (or permission is denied), seamlessly fall back to a text-based chat mode over the WebRTC `oai-events` data channel.

### 2.4 User Interface
- Mobile-first design optimized for `~390 px` width screens.
- Clear microphone and session controls (Start, Stop, Mute/Unmute, Interrupt, Reconnect, Text Fallback Input).
- Visual connection status and conversation flow indicators (`listening`, `user_speaking`, `assistant_thinking`, `assistant_speaking`).

### 2.5 Security
- `OPENAI_API_KEY` must **never** be exposed in client code, browser bundles, or network responses.
- All Realtime connections must authenticate exclusively using short-lived ephemeral tokens minted by `POST /api/realtime/session`.
- **Early Request Boundary & Denial-of-Service Defense**: PDF upload routes inspect the `Content-Length` header early to reject oversized requests (`> 25 MB`) before buffering multipart form-data streams into server memory.
- **SSRF Protection**: Outbound server-side requests for YouTube caption tracks must validate that target hostnames strictly match `youtube.com` or end with `.youtube.com` before issuing network requests. Outbound requests route via `YOUTUBE_PROXY_URL` when configured.

---

## 3. Verifiable Acceptance Criteria (By ADR)

The `test-writer` agent MUST author automated unit and integration tests verifying the following acceptance criteria:

### AC-01: Unified Ingestion Contract (`ADR-01`)
- **`AC-01.1`**: Both `POST /api/ingest/pdf` and `POST /api/ingest/youtube` return HTTP `200` on valid inputs with a JSON payload matching `IngestionSuccess`:
  - `ok: true`
  - `sourceType`: `"pdf"` or `"youtube"`
  - `title`: non-empty string
  - `text`: full normalized extracted text (never truncated at ingestion, even when `text.length > 48,000`)
  - `charCount`: exact `text.length`
  - `estimatedTokens`: `Math.ceil(text.length / 4)`
  - `metadata`: object containing `pageCount` (for PDF) or `videoId` / `language` (for YouTube).
- **`AC-01.2`**: On any validation or extraction error, both endpoints return an appropriate `4xx`/`5xx` HTTP status with a JSON payload matching `IngestionError`:
  - `ok: false`
  - `code`: one of `"INVALID_FILE_TYPE" | "FILE_TOO_LARGE" | "EMPTY_OR_SCANNED_PDF" | "CORRUPTED_OR_ENCRYPTED_PDF" | "INVALID_YOUTUBE_URL" | "VIDEO_UNAVAILABLE" | "CAPTIONS_UNAVAILABLE" | "YOUTUBE_CLOUD_IP_BLOCKED" | "EXTRACTION_TIMEOUT" | "INTERNAL_ERROR"` (explicitly excluding `"CONTEXT_TOO_LARGE_FOR_REALTIME"`).
  - `message`: clear, human-readable error message
  - `retryable`: boolean.

### AC-02: Server-Side Spatial PDF Extraction & No-OCR Boundary (`ADR-02`)
- **`AC-02.1`**: Uploading a PDF file larger than `25 MB` (`> 26,214,400` bytes) to `POST /api/ingest/pdf` returns HTTP `413` with `code: "FILE_TOO_LARGE"` and `retryable: true`. The route enforces this boundary early via the `Content-Length` header check prior to buffering multipart body streams into memory, as well as checking `file.size` and `buffer.byteLength`.
- **`AC-02.2`**: Uploading a missing file, empty (`0` byte) file, unsupported MIME type (accepting `application/pdf`, `application/x-pdf`, or `application/octet-stream` with a `.pdf` extension), or file lacking the `%PDF-` magic header returns HTTP `400` with `code: "INVALID_FILE_TYPE"`.
- **`AC-02.3`**: Uploading a scanned/image-only or blank PDF whose extracted text has `< 20` non-whitespace characters returns HTTP `422` with `code: "EMPTY_OR_SCANNED_PDF"`, a message stating that OCR is not supported and a text-based PDF is required, and `retryable: true`.
- **`AC-02.4`**: Uploading a password-protected or corrupted PDF that throws a parser exception returns HTTP `422` with `code: "CORRUPTED_OR_ENCRYPTED_PDF"`.
- **`AC-02.5`**: Uploading a valid multi-page text-based PDF ($\le 25\text{ MB}$) extracts and concatenates text across all pages in reading order and returns HTTP `200` with `ok: true` and `metadata.pageCount`.
- **`AC-02.6`**: Spatial coordinate-aware extraction (`pdfjs-dist` legacy build) detects multi-column vertical gutters and reconstructs logical column reading order (extracting Column 1 top-to-bottom in full before Column 2 top-to-bottom) without horizontally interleaving sentences across columns, and collapses large vertical voids caused by embedded images into clean paragraph breaks (`\n\n`) rather than emitting multiple blank lines. All spatial column calculations operate on the genuine document viewport (`612pt`) without modifying PDF binary buffers (e.g. MediaBox rewrites) or applying monkey-patches to worker viewport bounds.

### AC-03: Server-Side YouTube Transcript Extraction (`ADR-03`)
- **`AC-03.1`**: The YouTube URL parser extracts the 11-character `videoId` from `youtube.com/watch?v=`, `youtu.be/`, `youtube.com/shorts/`, `youtube.com/embed/`, `youtube.com/live/`, and `m.youtube.com` URLs (ignoring extra query params such as `&t=` or `&list=`), and rejects non-YouTube URLs or invalid IDs with HTTP `400` and `code: "INVALID_YOUTUBE_URL"`.
- **`AC-03.2`**: A valid YouTube video with available captions returns HTTP `200` (`ok: true`) with HTML entities (`&#39;`, `&amp;`, `&quot;`, etc.) decoded and caption segments joined into clean readable text without XML tags or timestamps.
- **`AC-03.3`**: A YouTube video with disabled or missing captions returns HTTP `422` with `code: "CAPTIONS_UNAVAILABLE"` and `retryable: true`.
- **`AC-03.4`**: When YouTube blocks the server IP (`HTTP 403`, `HTTP 429`, `LOGIN_REQUIRED`, or anti-bot challenge), `POST /api/ingest/youtube` returns HTTP `503` with `code: "YOUTUBE_CLOUD_IP_BLOCKED"` and a clear explanation of the cloud IP restriction.
- **`AC-03.5`**: Server-side caption track fetching enforces SSRF protection by verifying that parsed caption `baseUrl` hostnames strictly resolve to `youtube.com` or `*.youtube.com` before initiating outbound fetch requests (rejecting untrusted hostnames with `CAPTIONS_UNAVAILABLE`), and routes through `YOUTUBE_PROXY_URL` if configured.

### AC-04: Ephemeral Token Minting & Secret Isolation (`ADR-04`)
- **`AC-04.1`**: `OPENAI_API_KEY` is read exclusively on the server and never appears in client bundles, `NEXT_PUBLIC_*` variables, or response payloads. If `OPENAI_API_KEY` is missing, `POST /api/realtime/session` returns HTTP `500` with `code: "SERVER_MISCONFIGURED"`.
- **`AC-04.2`**: `POST /api/realtime/session` calls `POST https://api.openai.com/v1/realtime/sessions` with:
  - `model`: `"gpt-4o-realtime-preview"` (or `process.env.OPENAI_REALTIME_MODEL`)
  - `modalities`: `["audio", "text"]`
  - `input_audio_transcription`: `{ model: "whisper-1" }`
  - `turn_detection`: `{ type: "server_vad", threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 500, create_response: true, interrupt_response: true }`
  - `instructions`: grounded system prompt containing the prepared source context.
- **`AC-04.3`**: On success, `POST /api/realtime/session` returns HTTP `200` with `{ ok: true, ephemeralKey, expiresAt, model }` and header `Cache-Control: no-store`.

### AC-05: Direct Context Priming & 48,000-Character Cap (`ADR-05`)
- **`AC-05.1`**: For any source with `text.length <= 48_000`, the context builder embeds the complete `text`, `title`, and `sourceType` into `session.instructions` with `isContextTruncated: false` and no warning banner.
- **`AC-05.2`**: For any source with `text.length > 48_000`, the UI preview still displays the full untruncated `text`, while the Realtime context builder slices the text injected into `session.instructions` to exactly `48,000` characters (`~12,000` tokens), sets `isContextTruncated: true`, and renders an explanatory warning banner in the UI.
- **`AC-05.3`**: No chunking, vector embedding, retrieval (RAG), or pre-summarization is performed on the extracted text.

### AC-06: WebRTC Session Lifecycle & Resource Teardown (`ADR-06`)
- **`AC-06.1`**: The `"Start Voice Chat"` button is disabled in `idle` and `ingesting` states and enabled once valid source ingestion transitions state to `ready`.
- **`AC-06.2`**: Clicking `"Stop"`, switching to a new PDF/YouTube source while connected, or unmounting the component invokes deterministic cleanup that:
  1. Calls `.stop()` on every local `MediaStreamTrack`.
  2. Clears `audioElement.srcObject = null`.
  3. Closes the `oai-events` `RTCDataChannel` and `RTCPeerConnection`.
- **`AC-06.3`**: The UI displays distinct status indicators for `connecting`, `connected`, `reconnecting`, and `error` states, plus active conversation flow sub-states (`listening`, `user_speaking`, `assistant_thinking`, `assistant_speaking`).

### AC-07: Speech Interruption / Barge-In (`ADR-07`)
- **`AC-07.1`**: Receiving `input_audio_buffer.speech_started` over `oai-events` while the assistant is speaking immediately transitions the conversation sub-state to `user_speaking` and finalizes the in-progress assistant transcript turn (preserving what was already spoken).
- **`AC-07.2`**: Clicking the manual `"Interrupt"` button while `assistant_speaking` is active sends `{ type: "response.cancel" }` and `{ type: "output_audio_buffer.clear" }` over the `oai-events` data channel.

### AC-08: Real-Time Conversation Transcript Synchronization (`ADR-08`)
- **`AC-08.1`**: When user speech is committed (`input_audio_buffer.speech_stopped` / user `conversation.item.created`), a user transcript placeholder (`role: "user"`) is inserted into the transcript list immediately so the user turn always appears chronologically *before* the assistant's reply bubble, even when asynchronous `whisper-1` transcription (`conversation.item.input_audio_transcription.completed`) resolves after the first assistant delta.
- **`AC-08.2`**: Assistant transcript turns stream incrementally on both `response.audio_transcript.delta` and `response.output_audio_transcript.delta` (as well as `response.text.delta` / `response.output_text.delta`) and mark complete on the corresponding `.done` event.

### AC-09: Text-Based Chat Fallback & Mute Controls (`ADR-09`)
- **`AC-09.1`**: When `navigator.mediaDevices.getUserMedia` is unavailable or rejects (`NotAllowedError`, `NotFoundError`, `NotReadableError`, `OverconstrainedError`), the client does not abort the session; it adds a `recvonly` audio transceiver (`pc.addTransceiver("audio", { direction: "recvonly" })`), completes the WebRTC connection, displays a `"Microphone unavailable — using text chat mode"` banner, and enables the text chat input.
- **`AC-09.2`**: Submitting a text message in text mode appends the user message to the transcript and sends `{ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } }` followed by `{ type: "response.create" }` over `oai-events`.
- **`AC-09.3`**: Toggling Mute sets `localAudioTrack.enabled = false` (and `true` on Unmute) without closing the `RTCPeerConnection`.

### AC-10: Poor Network Handling & Resilience (`ADR-10`)
- **`AC-10.1`**: When `iceConnectionState` or `connectionState` transitions to `"disconnected"`, the UI enters `"reconnecting"` status and starts a `10,000 ms` grace timer.
- **`AC-10.2`**: If `iceConnectionState` / `connectionState` recovers to `"connected"` or `"completed"` within `10,000 ms`, the grace timer is cleared and the session returns to `"connected"` status without dropping the conversation.
- **`AC-10.3`**: If `connectionState` / `iceConnectionState` transitions to `"failed"` or the `10,000 ms` grace timer expires, the peer connection is cleaned up, the existing conversation transcript and extracted source context are preserved on screen, and a `"Reconnect Voice Session"` button is displayed.
- **`AC-10.4`**: Attempting to send an event when `dataChannel.readyState !== "open"` is safely guarded against throwing an unhandled exception and surfaces a user-visible warning/error.

### AC-11: Mobile-First UI/UX & Autoplay Compliance (`ADR-11`)
- **`AC-11.1`**: Extracted text preview renders in a collapsible container showing source title, character count, and estimated token count (plus the truncation warning banner when `charCount > 48,000`), and toggles cleanly between collapsed and expanded states.
- **`AC-11.2`**: Session controls (Start/Stop, Mute/Unmute, Interrupt, Text Send) have accessible labels, touch-friendly sizing ($\ge 44\times 44\text{ px}$), and `16px` (`text-base`) input font sizes to prevent iOS Safari zoom on a `~390 px` viewport.
- **`AC-11.3`**: The remote WebRTC `<audio>` element configures `autoPlay` and `playsInline`.

### AC-12: Bounded In-Memory Ingestion Cache (`ADR-12`)
- **`AC-12.1`**: Repeated ingestion of the same YouTube `videoId` (or identical PDF SHA-256 buffer hash) within the in-memory cache TTL returns the cached `IngestionSuccess` result without redundant upstream parsing/scraping, and evicts oldest entries when capacity is exceeded.

---

## 4. Deliverables & Evaluator's 5-Step Review Script

1. **Working Web Application** hosted publicly and ready to demo.
2. **Video Walkthrough (10–15 minutes)** demonstrating the full workflow and explaining architectural decisions and trade-offs.
3. **GitHub Repository** with clean, modular frontend + backend code, `README.md`, and automated tests.
4. **Evaluator Review Script**:
   1. Paste a YouTube URL with available captions; confirm transcript ingestion.
   2. Upload a PDF and confirm full text extraction.
   3. Test on mobile: start a voice conversation, interrupt, follow up naturally.
   4. Test under poor network conditions to assess stability.
   5. Review code structure, environment handling, and secret management.
