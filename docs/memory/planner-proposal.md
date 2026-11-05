# Planner Audit & Architectural Decisions Proposal

> **Scope Note**: This document was authored from an independent zero-prior audit of [`assignment.pdf`](file:///C:/Users/Arav%20Verma/Downloads/TalktToMe/assignment.pdf), [`AGENTS.md`](file:///C:/Users/Arav%20Verma/Downloads/TalktToMe/AGENTS.md), and [`.agents/agents/planner.md`](file:///C:/Users/Arav%20Verma/Downloads/TalktToMe/.agents/agents/planner.md), supplemented by current OpenAI Realtime API and Next.js platform documentation. Review and approve/modify in one pass; once approved, these decisions and acceptance criteria will be promoted into `docs/memory/decisions.md` and `docs/memory/requirements.md`.

---

## Part 1: Independent Audit of `assignment.pdf`

### 1.1 Explicit Functional Requirements
| ID | Category | Requirement from `assignment.pdf` |
| :--- | :--- | :--- |
| **FR-01** | **PDF Ingestion** | Accept a PDF file upload ($\le 25\text{ MB}$), extract full text server-side, and work reliably in the publicly deployed application. |
| **FR-02** | **YouTube Ingestion** | Accept a YouTube URL (with accessible transcript/captions) and extract the transcript server-side. Must work locally; working in the deployed app is a bonus (if blocked by cloud provider IPs, document the limitation in `README.md` and demo locally). |
| **FR-03** | **Extracted Text Display** | Display the extracted text to the user in a collapsible or preview format. |
| **FR-04** | **Context Preparation** | Prime an OpenAI Realtime session directly with the extracted text as conversational context. No chunking, summarization, or citation handling is required (and RAG/chunking/summarization are strictly prohibited per `AGENTS.md`). |
| **FR-05** | **Live Voice Session** | Provide a **"Start Voice Chat"** button to establish a live WebRTC voice session with the OpenAI Realtime API, allowing the user to ask spoken questions and hear spoken answers in real time. |
| **FR-06** | **Live Conversation Transcript** | Display a real-time text transcript of the ongoing conversation (both user questions and assistant answers). |
| **FR-07** | **Text-Based Chat Fallback** | If a microphone is unavailable, allow seamless fallback to a text-based chat mode. |
| **FR-08** | **Session & Mic Controls** | Include clear controls for starting, stopping, and muting/unmuting the session, alongside visual indicators for connection status and conversation flow. |

### 1.2 Explicit Non-Functional Requirements
| ID | Category | Requirement from `assignment.pdf` |
| :--- | :--- | :--- |
| **NFR-01** | **Mobile-First Responsive UI** | Simple, intuitive, mobile-first design optimized for `~390 px` width screens and functional across mobile devices. |
| **NFR-02** | **Credential Security** | `OPENAI_API_KEY` must never be exposed in client bundles, network payloads, or browser storage. All Realtime connections must authenticate via backend-minted ephemeral tokens. |
| **NFR-03** | **Network Stability** | Maintain stability and graceful error/reconnection handling under poor network conditions (Review Script Step 4). |
| **NFR-04** | **Modularity & Type Safety** | Clean, modular, strictly typed TypeScript across frontend and backend with clear separation of concerns and unit/integration tests where appropriate. |
| **NFR-05** | **Documentation** | `README.md` containing setup/run instructions, environment configuration, technical overview, trade-offs made, and notes on AI tool usage. |

### 1.3 Technical Constraints & Fixed Project Boundaries
1. **Recommended Stack**: Next.js (App Router) + React + TypeScript on the frontend; Node.js / Next.js Route Handlers + TypeScript on the backend.
2. **Realtime Transport**: OpenAI Realtime API over **WebRTC** (`RTCPeerConnection` + audio tracks + `oai-events` data channel), authenticated with short-lived ephemeral tokens from the backend.
3. **Server-Side Extraction**:
   - PDF extraction must run on the server (e.g., `unpdf`, `pdf-parse`, `pdfjs-dist`, or equivalent).
   - YouTube caption extraction must run on the server (cannot use official YouTube Data API v3 `captions.download` because it only permits caption downloads for videos owned by the authenticated OAuth account).
4. **No OCR (Fixed Project Boundary)**: Only text-based PDFs are supported. Scanned/image-only or empty PDFs must return a clear, typed error message and allow the user to retry.
5. **No Chunking, Summarization, or RAG (Fixed Project Boundary)**: Extracted text is passed directly to the Realtime session without vector stores, retrieval pipelines, chunking, or pre-summarization.
6. **Data Storage**: In-memory or lightweight storage (or stateless request/session flow) is sufficient; no persistent user authentication is required.

### 1.4 Deliverables, Rubric & 5-Step Review Script
- **Deliverables**:
  1. **Publicly Hosted Web Application** (Vercel, Render, Railway, Firebase, Netlify, etc.).
  2. **Video Walkthrough (10–15 min)** demonstrating upload/URL ingestion, extracted text preview, live voice conversation, and architectural explanation.
  3. **Public GitHub Repository** with clean modular source code, `README.md`, dependencies, and unit/integration tests.
- **Evaluation Rubric (4 – Exceptional Targets)**:
  - *Product Polish (Mobile)*: Delightful UX, robust states, responsive `~390 px` layout.
  - *Ingestion Quality*: Handles edge cases for YouTube/PDF parsing gracefully.
  - *Code Quality*: Modular, typed, secure, well-documented, tested.
  - *System Design*: Clear separation of concerns, scalable architecture.
- **Evaluator's 5-Step Review Script (Page 5)**:
  1. Paste a YouTube URL with available captions; confirm transcript ingestion.
  2. Upload a PDF and confirm full text extraction.
  3. Test on mobile: start a voice conversation, interrupt (barge-in), follow up naturally.
  4. Test under poor network conditions to assess stability.
  5. Review code structure, environment handling, and secret management.

---

## Part 2: Critical Decisions Requiring Your Explicit Input

Before locking the architecture, **3 decisions** carry genuine deployment, product, or API behavior trade-offs where silently assuming a default would be risky. Please confirm your preferred option for each:

### [CRITICAL-1] Deployment Target vs. 25 MB PDF Upload Limit
- **The Architectural Conflict**: The assignment requires accepting PDF files up to **`25 MB`** and states *"PDF ingestion must work in your deployed application."* However, **Vercel Serverless Functions enforce a hard `4.5 MB` incoming request body limit** (`HTTP 413 Payload Too Large`) at their edge proxy.
- **Options**:
  - **Option 1A (Recommended — Container Host: Render / Railway / Fly.io)**: Deploy the Next.js app as a standard Node.js server on Render, Railway, or Fly.io (or configure for both). A standard `POST /api/ingest/pdf` using `multipart/form-data` handles up to `25 MB` natively with zero external cloud-storage dependencies.
  - **Option 1B (Vercel Deployment without External Blob Storage)**: Deploy on Vercel using standard `POST /api/ingest/pdf` (enforcing `25 MB` in application code for local/container runs, while documenting in `README.md` that Vercel's platform proxy caps direct uploads at `4.5 MB` unless `@vercel/blob` is configured).
  - **Option 1C (Vercel Deployment + `@vercel/blob` Presigned Upload)**: Add `@vercel/blob` so browsers upload PDFs up to `25 MB` directly to Vercel Blob storage and pass the URL to `/api/ingest/pdf`. *(Adds external token/storage configuration).*
- **Planner Recommendation**: **Option 1A** (keep `POST /api/ingest/pdf` self-contained and host on Render/Railway, or Vercel with the `4.5 MB` platform note in `README.md`).

### [CRITICAL-2] Context Window Overflow Policy (Given "No Chunking / No Summarization")
- **The Architectural Conflict**: A `25 MB` text PDF or a 2-hour YouTube video can exceed `100,000+` tokens. However, chunking, summarization, and RAG are forbidden, and the OpenAI Realtime API enforces strict token limits (`32,000` total context tokens / `28,672` max input tokens across the session, and a `16,384` token cap on `session.instructions`). Sending an oversized payload causes OpenAI to reject the session or evict the context immediately.
- **Options**:
  - **Option 2A (Recommended — Strict Token Budget Gate with Typed Error)**: Extract and return the full text if within the Realtime safe context budget (**`15,000` tokens / `~60,000` characters**, reserving sufficient tokens for multi-turn voice audio/transcripts). If the extracted source exceeds `60,000` characters, return a clear, typed error (`CONTEXT_TOO_LARGE_FOR_REALTIME`) explaining the source's token estimate vs. the Realtime API limit (since chunking/summarization are disabled by design) and prompt the user to upload a shorter source.
  - **Option 2B (Full Text Preview + Safe Context Prefix Cap with UI Warning)**: Always succeed on extraction and display the **entire** extracted text in the UI preview (satisfying Review Script Step 2 *"Upload a PDF and confirm full text extraction"* even on huge PDFs), but if the text exceeds **`60,000` characters (`~15,000` tokens)**, pass the first `60,000` characters into the Realtime session and display a prominent, non-blocking warning banner (`"Source is ~X tokens. Due to Realtime API context limits and no-chunking rules, the voice assistant is primed with the first ~15,000 tokens."`).
- **Planner Recommendation**: **Option 2B** (or **Option 2A** if you prefer a hard rejection). Option 2B guarantees Review Script Step 2 (*"Upload a PDF and confirm full text extraction"*) never fails on a large multi-page PDF while still preventing OpenAI Realtime API crashes and respecting the no-chunking/no-RAG constraint.

### [CRITICAL-3] OpenAI Realtime API Version (GA `v1/realtime/client_secrets` vs. Beta `v1/realtime/sessions`)
- **The Architectural Conflict**: OpenAI supports both the **GA Realtime interface** (`POST /v1/realtime/client_secrets` + `POST /v1/realtime/calls` with model `gpt-realtime`) and the widely used **Preview/Beta WebRTC interface** (`POST /v1/realtime/sessions` + `POST /v1/realtime?model=gpt-4o-realtime-preview-2024-12-17`).
- **Options**:
  - **Option 3A (Recommended — `POST /v1/realtime/sessions` with configurable `OPENAI_REALTIME_MODEL` defaulting to `gpt-4o-realtime-preview`)**: Use the battle-tested `/v1/realtime/sessions` ephemeral token flow + `/v1/realtime?model=...` SDP exchange, or support GA `/v1/realtime/client_secrets` cleanly behind the server route.
  - **Option 3B (Strict GA `/v1/realtime/client_secrets` + `/v1/realtime/calls` with `gpt-realtime`)**: Use exclusively the newer GA endpoint schema.
- **Planner Recommendation**: **Option 3A** (or dual-compatible parser in our backend token route) because `/v1/realtime/sessions` with `gpt-4o-realtime-preview` has universal account compatibility across OpenAI API tiers.

---

## Part 3: Comprehensive Architectural Decisions Proposal (One-Pass Review)

Below are all **12 architectural decisions** covering every ambiguity and edge case identified in the audit. Each includes a one-line rationale and verifiable acceptance criteria (`AC`) for `test-writer`.

---

### ADR-01: Unified Ingestion Contract & Source State Model
- **Ambiguity**: `assignment.pdf` requires both PDF and YouTube ingestion and displaying extracted text in a collapsible preview, but does not define the normalized data contract between backend extraction and frontend session priming.
- **Proposed Decision**: Both `POST /api/ingest/pdf` and `POST /api/ingest/youtube` return a unified, discriminated JSON response (`IngestionResult`):
  ```ts
  type IngestionSuccess = {
    ok: true;
    sourceType: "pdf" | "youtube";
    title: string;          // Filename or YouTube video title/ID
    text: string;           // Full normalized extracted text
    charCount: number;
    estimatedTokens: number; // Math.ceil(charCount / 4)
    truncatedForRealtime: boolean;
    warnings?: string[];
    metadata: { pageCount?: number; videoId?: string; language?: string };
  };
  type IngestionError = {
    ok: false;
    code:
      | "INVALID_FILE_TYPE"
      | "FILE_TOO_LARGE"
      | "EMPTY_OR_SCANNED_PDF"
      | "CORRUPTED_OR_ENCRYPTED_PDF"
      | "INVALID_YOUTUBE_URL"
      | "VIDEO_UNAVAILABLE"
      | "CAPTIONS_UNAVAILABLE"
      | "YOUTUBE_CLOUD_IP_BLOCKED"
      | "CONTEXT_TOO_LARGE_FOR_REALTIME"
      | "EXTRACTION_TIMEOUT"
      | "INTERNAL_ERROR";
    message: string;
    retryable: boolean;
  };
  ```
- **One-Line Rationale**: A single normalized ingestion contract decouples the UI preview and Realtime session initialization from source-specific extraction mechanics and guarantees deterministic error handling.
- **Testable Acceptance Criteria**:
  - `AC-01.1`: Both `/api/ingest/pdf` and `/api/ingest/youtube` return HTTP `200` with `ok: true`, non-empty `text`, accurate `charCount`, and `estimatedTokens === Math.ceil(text.length / 4)` on valid inputs.
  - `AC-01.2`: On any validation or extraction failure, both endpoints return an appropriate `4xx`/`5xx` HTTP status and a JSON body matching `IngestionError` (`ok: false`, typed `code`, human-readable `message`, boolean `retryable`).

---

### ADR-02: Server-Side PDF Extraction & Non-Negotiable No-OCR Boundary
- **Ambiguity**: Which server-side PDF library to use in Next.js App Router without native binary (`node-gyp`/`canvas`) deployment failures, and how to detect scanned/empty/encrypted PDFs.
- **Proposed Decision**:
  1. Run `POST /api/ingest/pdf` explicitly on the Node.js runtime (`export const runtime = "nodejs"`).
  2. Validate that the uploaded `File` is present, has MIME type `application/pdf` (or `.pdf` extension) and begins with the `%PDF-` magic header, and has `size > 0` and `size <= 25 * 1024 * 1024` bytes (`26,214,400` bytes).
  3. Extract text server-side using `unpdf` (or `pdf-parse` if already installed in `package.json`), normalizing excessive whitespace while preserving paragraph breaks.
  4. **No-OCR Enforcement**: If the extracted text after trimming whitespace contains fewer than **`20` non-whitespace characters**, reject with HTTP `422` and `code: "EMPTY_OR_SCANNED_PDF"` (*"This PDF contains no extractable text (it may be a scanned image). OCR is not supported; please upload a text-based PDF."*).
  5. Catch password-protected or malformed PDF parser exceptions and return HTTP `422` with `code: "CORRUPTED_OR_ENCRYPTED_PDF"`.
- **One-Line Rationale**: Enforcing strict byte-size, magic-byte, and minimum-text-density checks on the Node.js server satisfies the 25 MB limit and the non-negotiable No-OCR boundary while preventing crashes on malformed files.
- **Testable Acceptance Criteria**:
  - `AC-02.1`: Uploading a file `> 26,214,400` bytes returns HTTP `413` with `code: "FILE_TOO_LARGE"`.
  - `AC-02.2`: Uploading a non-PDF file (wrong MIME type or missing `%PDF-` magic bytes) returns HTTP `400` with `code: "INVALID_FILE_TYPE"`.
  - `AC-02.3`: Uploading a scanned/image-only or blank PDF yielding `< 20` non-whitespace characters returns HTTP `422` with `code: "EMPTY_OR_SCANNED_PDF"` and `retryable: true`.
  - `AC-02.4`: Uploading a password-protected or corrupted PDF returns HTTP `422` with `code: "CORRUPTED_OR_ENCRYPTED_PDF"`.
  - `AC-02.5`: Uploading a valid multi-page text PDF ($\le 25\text{ MB}$) extracts and concatenates text across all pages in reading order and returns `ok: true` with `metadata.pageCount`.

---

### ADR-03: Server-Side YouTube Transcript Extraction & Cloud IP Block Mitigation
- **Ambiguity**: YouTube offers no official public API for third-party video captions and aggressively blocks cloud datacenter IPs (Vercel, AWS, Render) on unofficial endpoints. Furthermore, users paste many URL variants (`watch?v=`, `youtu.be/`, `shorts/`, `embed/`, mobile `m.youtube.com`, or URLs with `&t=` / `&list=` query params).
- **Proposed Decision**:
  1. **URL Parser**: Parse and extract the 11-character YouTube `videoId` across all standard URL formats (`youtube.com/watch?v=`, `youtu.be/`, `youtube.com/shorts/`, `youtube.com/embed/`, `youtube.com/live/`). Reject non-YouTube URLs or malformed IDs with HTTP `400` (`code: "INVALID_YOUTUBE_URL"`).
  2. **Server-Side Transcript Fetcher**: Fetch captions server-side (`POST /api/ingest/youtube`) using an Innertube/caption-track extractor (supporting English preferred `en`/`en-US`, falling back to the first available manual or auto-generated caption track), decoding HTML entities (`&#39;`, `&amp;`, `&quot;`) and joining segments into clean readable text without raw XML tags or timestamps.
  3. **Cloud IP Block Bonus & Fallback**:
     - Support an optional server environment variable `YOUTUBE_PROXY_URL` (HTTP/HTTPS proxy) so production deployments can route YouTube caption fetches through a residential proxy to achieve the deployed bonus.
     - Distinguish between *"Video has no captions"* (`code: "CAPTIONS_UNAVAILABLE"`, HTTP `422`) and *"YouTube blocked cloud IP / 429 / Sign-in required"* (`code: "YOUTUBE_CLOUD_IP_BLOCKED"`, HTTP `503`), returning a clear message explaining the cloud IP limitation and allowing the user to retry or switch sources.
- **One-Line Rationale**: Combining multi-format URL parsing, optional proxy routing for cloud deployments, and distinct error codes for missing captions vs. datacenter IP blocks maximizes deployed reliability while transparently handling YouTube's anti-bot restrictions.
- **Testable Acceptance Criteria**:
  - `AC-03.1`: URL parser accurately extracts the 11-char `videoId` from `youtube.com/watch?v=`, `youtu.be/`, `youtube.com/shorts/`, `youtube.com/embed/`, and `m.youtube.com` URLs (ignoring extra query parameters like `&t=30s` or `&list=...`), and returns HTTP `400` (`INVALID_YOUTUBE_URL`) for non-YouTube domains or invalid IDs.
  - `AC-03.2`: Valid YouTube video with captions returns HTTP `200` (`ok: true`) with HTML entities decoded and segment text joined cleanly.
  - `AC-03.3`: Video without captions or disabled transcripts returns HTTP `422` with `code: "CAPTIONS_UNAVAILABLE"`.
  - `AC-03.4`: Upstream HTTP `403`/`429` or `LOGIN_REQUIRED` anti-bot responses from YouTube return HTTP `503` with `code: "YOUTUBE_CLOUD_IP_BLOCKED"` and a clear explanation.

---

### ADR-04: Ephemeral Token Minting & Secret Isolation (`POST /api/realtime/session`)
- **Ambiguity**: How the browser authenticates with OpenAI's WebRTC Realtime endpoint without exposing `OPENAI_API_KEY`, and where session configuration (voice, VAD, input audio transcription) is initialized.
- **Proposed Decision**:
  1. Create backend route `POST /api/realtime/session` (`runtime = "nodejs"`).
  2. Read ` process.env.OPENAI_API_KEY` exclusively on the server. If missing, return HTTP `500` with a safe error (`code: "SERVER_MISCONFIGURED"`) without leaking environment details.
  3. Call OpenAI's ephemeral session endpoint (`https://api.openai.com/v1/realtime/sessions` or `/v1/realtime/client_secrets`) with:
     - `model`: `process.env.OPENAI_REALTIME_MODEL ?? "gpt-4o-realtime-preview"`
     - `modalities`: `["audio", "text"]`
     - `voice`: `"alloy"` (or configurable default)
     - `input_audio_transcription`: `{ model: "gpt-4o-mini-transcribe" }` (enables live user speech transcripts)
     - `turn_detection`: `{ type: "server_vad", threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 500, create_response: true, interrupt_response: true }`
  4. Return `{ ok: true, ephemeralKey: "<ek_...>", model, expiresAt }` to the client with `Cache-Control: no-store`.
- **One-Line Rationale**: Minting single-use, `no-store` ephemeral tokens server-side with pre-configured VAD and transcription settings keeps `OPENAI_API_KEY` strictly server-only and guarantees every WebRTC session starts with proper audio/transcript capabilities.
- **Testable Acceptance Criteria**:
  - `AC-04.1`: `OPENAI_API_KEY` never appears in any client-side bundle, `NEXT_PUBLIC_*` variable, or API response body.
  - `AC-04.2`: `POST /api/realtime/session` returns HTTP `200` with `ephemeralKey`, `model`, and `Cache-Control: no-store` when OpenAI responds succeeds, and returns a typed `4xx`/`5xx` JSON error on upstream failure or missing API key.
  - `AC-04.3`: The upstream payload includes `input_audio_transcription` and `turn_detection` (`server_vad` with `interrupt_response: true`).

---

### ADR-05: Direct Context Priming Strategy & Grounding Guardrails
- **Ambiguity**: Should extracted context be injected via `session.instructions` or `conversation.item.create`? How do we ensure the assistant answers strictly from the source without chunking/RAG?
- **Proposed Decision**:
  1. Build a deterministic system prompt containing:
     - Role & grounding instructions: Answer questions clearly and concisely based on the provided source text (`title`, `sourceType`), speak naturally for voice output, and explicitly state if a user's question is not covered by the source.
     - Delimited source text: `<source_context title="..." type="...">\n${contextText}\n</source_context>`.
  2. Pass this grounded system prompt in `instructions` during `POST /api/realtime/session` (and confirm/apply via `session.update` once the `oai-events` WebRTC data channel opens).
  3. **Why `session.instructions` over `conversation.item.create`?** In OpenAI Realtime sessions, `conversation.item.create` items are part of the rolling message history and can be **automatically evicted/truncated** by the server during a long conversation, whereas `session.instructions` remains permanently pinned across all turns.
  4. Enforce the context window cap (`60,000` characters / `~15,000` tokens, well inside the `16,384`-token `instructions` limit and `32,000`-token total context window) per **[CRITICAL-2]**.
- **One-Line Rationale**: Pinning the extracted text inside `session.instructions` (within the 15k-token safe budget) prevents OpenAI's rolling conversation truncation from dropping the document mid-call while avoiding any chunking or RAG.
- **Testable Acceptance Criteria**:
  - `AC-05.1`: Prompt builder function deterministically embeds `sourceType`, `title`, and extracted `text` inside `session.instructions` without chunking or summarizing.
  - `AC-05.2`: When extracted text exceeds the `60,000`-character Realtime budget, the system applies the agreed **[CRITICAL-2]** overflow policy deterministically.

---

### ADR-06: WebRTC Session Lifecycle & State Machine
- **Ambiguity**: Managing complex asynchronous browser states across ingestion, token minting, microphone capture, SDP exchange, active voice conversation, and teardown without memory/audio leaks.
- **Proposed Decision**:
  - Implement a strict, deterministic client session state machine:
    - `idle` (no source loaded)
    - `ingesting` (uploading PDF or fetching YouTube transcript)
    - `ready` (source text extracted & previewed; **"Start Voice Chat"** enabled)
    - `connecting` (minting ephemeral token, acquiring mic or falling back to text, negotiating WebRTC SDP, awaiting `oai-events` data channel open)
    - `connected` (active Realtime session, with sub-states for conversation flow: `listening`, `user_speaking`, `assistant_thinking`, `assistant_speaking`)
    - `reconnecting` (transient ICE disconnect recovery in progress)
    - `error` (recoverable error state with clear retry/reconnect CTA)
  - **Clean Teardown Guarantee**: Stopping a session, switching sources, or unmounting the component must synchronously:
    1. Stop all local microphone `MediaStreamTrack`s (`track.stop()`), releasing the OS microphone indicator immediately.
    2. Pause and clear `audioElement.srcObject = null`.
    3. Close the `oai-events` `RTCDataChannel` and `RTCPeerConnection`.
- **One-Line Rationale**: An explicit finite state machine with deterministic media-track and peer-connection cleanup prevents orphaned WebRTC sessions, ghost audio playback, and stuck mobile microphone indicators.
- **Testable Acceptance Criteria**:
  - `AC-06.1`: `"Start Voice Chat"` button is disabled until a valid PDF or YouTube source has transitioned the state to `ready`.
  - `AC-06.2`: Clicking `"Stop"` (or ingesting a new source while connected) closes the `RTCPeerConnection`, closes the data channel, stops all local `MediaStreamTrack`s, and detaches the remote audio stream.
  - `AC-06.3`: UI renders distinct visual indicators for each connection state (`connecting`, `connected`, `reconnecting`, `error`) and active conversation sub-state (`user_speaking`, `assistant_thinking`, `assistant_speaking`).

---

### ADR-07: Speech Interruption (Barge-In) & Natural Follow-Up (Review Script Step 3)
- **Ambiguity**: Review Script Step 3 explicitly tests: *"Test on mobile: start a voice conversation, interrupt, follow up naturally."* How should automatic voice barge-in and manual interruption work over WebRTC?
- **Proposed Decision**:
  1. **Automatic Voice Barge-In**: With WebRTC + Server VAD (`interrupt_response: true`), when the user speaks while the assistant is talking, OpenAI emits `input_audio_buffer.speech_started` and `output_audio_buffer.cleared` (or `response.done` with status `cancelled`), automatically halting the outbound WebRTC audio stream and truncating server-side audio context at the exact playback point.
  2. **Client Event Handling on Barge-In**: Upon receiving `input_audio_buffer.speech_started` while the assistant is speaking:
     - Immediately transition conversation flow UI to `user_speaking` ("Listening...").
     - Finalize the interrupted assistant transcript item in the UI (marking it cleanly rather than leaving it hanging or discarding what was already spoken).
  3. **Manual "Interrupt" Control**: Provide a tappable **"Interrupt"** button whenever the assistant is speaking that sends `{ type: "response.cancel" }` and `{ type: "output_audio_buffer.clear" }` over the `oai-events` data channel so users in noisy environments (or using text mode) can cut off a long answer on demand.
- **One-Line Rationale**: Combining WebRTC's native Server-VAD audio truncation with immediate UI state transitions and a manual `response.cancel` button guarantees responsive, natural barge-in on mobile devices.
- **Testable Acceptance Criteria**:
  - `AC-07.1`: Receiving `input_audio_buffer.speech_started` during an active assistant response immediately transitions the conversation sub-state to `user_speaking` and finalizes the in-progress assistant transcript turn.
  - `AC-07.2`: Tapping the manual `"Interrupt"` button while `assistant_speaking` is active dispatches `{ type: "response.cancel" }` and `{ type: "output_audio_buffer.clear" }` over the `oai-events` data channel.

---

### ADR-08: Real-Time Conversation Transcript Synchronization
- **Ambiguity**: User speech transcription (`conversation.item.input_audio_transcription.*`) runs asynchronously in parallel with model response generation (`response.output_audio_transcript.delta` / `response.audio_transcript.delta`), meaning the assistant's transcript deltas can arrive *before* the user's final speech transcription completes!
- **Proposed Decision**:
  1. Create a placeholder user transcript entry (`role: "user"`, `status: "transcribing"`, `text: "Listening..."`) keyed by `item_id` as soon as `input_audio_buffer.speech_stopped` / `conversation.item.created` fires, **preserving chronological turn order** in the UI list.
  2. Update the user entry incrementally on `conversation.item.input_audio_transcription.delta` and finalize it on `conversation.item.input_audio_transcription.completed`.
  3. Support **both** GA and Beta assistant transcript event names (`response.output_audio_transcript.delta` / `response.audio_transcript.delta` and `response.output_text.delta` / `response.text.delta`) so streaming text updates work regardless of model version or modality.
- **One-Line Rationale**: Creating chronological turn placeholders on `item_id` creation prevents out-of-order chat bubbles when asynchronous Whisper/GPT-4o user transcription finishes after the assistant starts speaking.
- **Testable Acceptance Criteria**:
  - `AC-08.1`: User spoken turns appear in the transcript list *before* the assistant's corresponding reply, even when `conversation.item.input_audio_transcription.completed` arrives after the first assistant transcript delta.
  - `AC-08.2`: Assistant transcript entries update incrementally on both `response.audio_transcript.delta` and `response.output_audio_transcript.delta` events and finalize on `.done`.

---

### ADR-09: Text-Based Chat Fallback When Microphone Is Unavailable
- **Ambiguity**: `assignment.pdf` states: *"If a microphone is unavailable, allow fallback to a text-based chat mode."* What triggers this fallback, how does WebRTC connect without a microphone, and how are text turns exchanged?
- **Proposed Decision**:
  1. **Automatic & Manual Activation**:
     - When starting a session, attempt `navigator.mediaDevices.getUserMedia({ audio: true })`.
     - If `navigator.mediaDevices` is undefined or `getUserMedia` rejects (`NotAllowedError`, `NotFoundError`, `NotReadableError`, `OverconstrainedError`), **do not abort the session**! Instead, automatically enter **Text Fallback Mode** (`micStatus: "unavailable"`), display a clear banner (*"Microphone unavailable — switched to text chat mode"*), and reveal the text input bar.
     - Also allow users with a working microphone to toggle or send text messages at any time (and mute their mic via `audioTrack.enabled = false`).
  2. **Mic-Less WebRTC Negotiation**:
     - When no local microphone track exists, call `pc.addTransceiver("audio", { direction: "recvonly" })` before `pc.createOffer()` so the WebRTC SDP still negotiates downstream audio (allowing the user to *hear* spoken answers if desired) alongside the `oai-events` data channel.
  3. **Sending Text Questions Over `oai-events`**:
     - Submitting a text message dispatches:
       1. `{ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } }`
       2. `{ type: "response.create" }`
     - Immediately append the user's text message to the conversation transcript UI.
- **One-Line Rationale**: Using a `recvonly` WebRTC audio transceiver plus `oai-events` data channel messages when `getUserMedia` fails keeps the architecture unified on OpenAI Realtime WebRTC while providing a seamless text chat fallback.
- **Testable Acceptance Criteria**:
  - `AC-09.1`: When `getUserMedia` rejects with `NotAllowedError` or `NotFoundError`, the session still connects via WebRTC using a `recvonly` audio transceiver and transitions cleanly into text fallback mode with a visible notice and text input box.
  - `AC-09.2`: Submitting a non-empty text message in text mode appends the user message to the transcript and sends `conversation.item.create` (`input_text`) followed by `response.create` over `oai-events`.
  - `AC-09.3`: Toggling Mute sets `localAudioTrack.enabled = false` (and `true` on Unmute) without dropping the `RTCPeerConnection`.

---

### ADR-10: Poor Network Handling & Stability (Review Script Step 4)
- **Ambiguity**: Review Script Step 4 explicitly tests: *"Test under poor network conditions to assess stability."* What happens on slow ingestion uploads, packet loss, transient ICE disconnects, or total connection drops?
- **Proposed Decision**:
  1. **HTTP Ingestion & Token Timeouts**: Wrap ingestion (`30s` timeout) and token minting (`15s` timeout) requests with `AbortController`. If a request times out or fails due to `TypeError: Failed to fetch` (offline), transition to a recoverable error state with a one-tap **"Retry"** button without losing the user's selected file or URL input.
  2. **WebRTC Connection & ICE Monitoring**:
     - Listen to `pc.onconnectionstatechange` and `pc.oniceconnectionstatechange`, plus browser `window` `offline`/`online` events.
     - **Transient Drop (`disconnected`)**: Transition UI status to `reconnecting` (*"Poor network detected — attempting to recover connection..."*) and start a **`10-second` recovery grace timer** while WebRTC attempts ICE recovery. If `iceConnectionState` returns to `connected`/`completed` within 10s, clear the timer and restore `connected` state.
     - **Hard Failure (`failed` or 10s grace timer expires)**: Cleanly close the failed `RTCPeerConnection`, **preserve the entire conversation transcript and extracted source context in state**, and display a prominent **"Reconnect Voice Session"** button that mints a fresh ephemeral token and re-establishes the session in one tap.
  3. **Data Channel Backpressure / Safety**: Before calling `dataChannel.send(...)`, verify `dataChannel.readyState === "open"`; if not open, surface a clear non-crashing warning rather than throwing an unhandled DOMException.
- **One-Line Rationale**: Combining explicit fetch timeouts, a 10-second ICE recovery grace period, transcript-preserving session reconnection, and guarded data-channel sends ensures the app never crashes or loses user progress on flaky mobile networks.
- **Testable Acceptance Criteria**:
  - `AC-10.1`: When `iceConnectionState` transitions to `"disconnected"`, the UI enters `"reconnecting"` status and waits up to `10,000 ms` for automatic recovery before declaring failure.
  - `AC-10.2`: If `iceConnectionState` transitions to `"connected"` before the `10,000 ms` grace timer expires, the session resumes `"connected"` status without dropping the call.
  - `AC-10.3`: If `connectionState`/`iceConnectionState` transitions to `"failed"` or the `10,000 ms` timer expires, the peer connection is cleaned up, existing transcript history and extracted source text are preserved on screen, and a `"Reconnect"` action is presented.
  - `AC-10.4`: Attempting to send a message when `dataChannel.readyState !== "open"` does not throw an unhandled exception and surfaces a user-visible error indicator.

---

### ADR-11: Mobile-First UI/UX & iOS Safari Autoplay Compliance (`~390 px`)
- **Ambiguity**: Mobile browsers (especially iOS Safari on `~390 px` viewports) block unmuted `<audio>` playback unless triggered appropriately, auto-zoom the page if form inputs have `font-size < 16px`, and struggle when long extracted texts push chat controls off-screen.
- **Proposed Decision**:
  1. **Viewport & Layout (`~390 px` First)**:
     - Single-column responsive flex/grid container (`max-w-md mx-auto min-h-dvh flex flex-col`) designed for `390 px` width with zero horizontal overflow (`overflow-x-hidden`).
  2. **Collapsible Extracted Text Preview**:
     - Render extracted text inside a collapsible card/drawer (`<details>` or toggleable panel) showing source title, character/word count badge, and a collapsed 3-line preview by default once a conversation starts, expanding on tap to a scrollable container (`max-h-60 overflow-y-auto`).
  3. **Thumb-Friendly Bottom Control Dock**:
     - Sticky bottom bar with touch targets $\ge 44\times 44\text{ px}$ for **Start/Stop Voice Chat**, **Mute/Unmute**, **Interrupt**, and **Text Chat Input**.
     - All `<input>` and `<textarea>` elements use `text-base` (`font-size: 16px`) so iOS Safari never auto-zooms on focus.
  4. **Mobile Audio Autoplay Unlock**:
     - Create/bind the `<audio autoPlay playsInline>` element synchronously inside the click handler of **"Start Voice Chat"** before awaiting async network calls so mobile browsers grant audio playback permission for the session.
- **One-Line Rationale**: Designing specifically around `390 px` `dvh` layout, collapsible source preview, `44 px` touch targets, `16 px` inputs, and gesture-bound `<audio playsInline>` eliminates mobile Safari/Chrome layout and audio traps.
- **Testable Acceptance Criteria**:
  - `AC-11.1`: Extracted text preview renders in a collapsible component that displays character/token metadata and toggles between collapsed and expanded states.
  - `AC-11.2`: Primary session controls (Start/Stop, Mute/Unmute, Interrupt, Text Send) have accessible labels (`aria-label` or visible text) and remain accessible alongside the live transcript on a `390 px` viewport.
  - `AC-11.3`: Remote WebRTC audio element sets `autoPlay` and `playsInline` attributes.

---

### ADR-12: Stateless Storage Scope & Rate/Payload Safety
- **Ambiguity**: `assignment.pdf` mentions *"In-memory or lightweight database (e.g., SQLite) is sufficient. No persistent user authentication required."* Should we introduce SQLite or keep the backend stateless?
- **Proposed Decision**:
  - Keep backend API routes stateless (returning extracted text directly to the client and passing context during session initialization, with an optional lightweight bounded in-memory LRU cache keyed by SHA-256 of PDF buffer or YouTube `videoId` to avoid re-scraping the exact same source during a demo session).
  - Do **not** introduce SQLite or persistent disk writes, which break on read-only serverless filesystems (Vercel/Netlify) and are unnecessary without user accounts.
- **One-Line Rationale**: Stateless API routes with an optional bounded in-memory cache satisfy all functional requirements while remaining 100% compatible with both serverless and container cloud hosts.
- **Testable Acceptance Criteria**:
  - `AC-12.1`: Repeated ingestion of the same YouTube `videoId` within the cache TTL returns the cached transcript without redundant upstream scraping calls.

---

## Summary Checklist for Your Review

Please reply with:
1. Your choices on the 3 critical items:
   - **[CRITICAL-1] Deployment Target**: `1A` (Render/Railway container host or Vercel with 4.5MB platform note), `1B`, or `1C`?
   - **[CRITICAL-2] Context Overflow Policy**: `2B` (Full text preview + 60k char / ~15k token Realtime context cap with UI warning banner) or `2A` (Hard error rejection above 60k chars)?
   - **[CRITICAL-3] Realtime Endpoint Version**: `3A` (`/v1/realtime/sessions` with `gpt-4o-realtime-preview`) or `3B` (GA `/v1/realtime/client_secrets` with `gpt-realtime`)?
2. Approval or any vetoes/adjustments on **ADR-01 through ADR-12**.
