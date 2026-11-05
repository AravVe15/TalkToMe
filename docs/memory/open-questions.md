# Open Questions & Ambiguities

This document records ambiguities and product decisions that required resolution with the user. All open questions (`OQ-001` through `OQ-010`) have been **RESOLVED** and codified in [`docs/memory/decisions.md`](./decisions.md) and [`docs/memory/requirements.md`](./requirements.md).

---

## OQ-001: Context Window Overflow Without Chunking/Summarization
- **Status**: RESOLVED (See **ADR-01** & **ADR-05**)
- **Resolution**: Ingestion always returns the full extracted text so the UI preview is never truncated (**Option 2B**). For the Realtime voice session, context injected into `session.instructions` is capped at **`48,000` characters (`~12,000` tokens)** to stay safely under OpenAI's `16,384` instruction token ceiling, accompanied by an explanatory, non-blocking UI warning banner.

---

## OQ-002: User Interruption Handling of Model Speech
- **Status**: RESOLVED (See **ADR-07**)
- **Resolution**: Combine WebRTC + Server VAD (`interrupt_response: true`) automatic audio cutoff and truncation with immediate client state transition to `user_speaking` on `input_audio_buffer.speech_started`, preserving already-spoken assistant transcript text, plus a manual **"Interrupt"** button that sends `response.cancel` and `output_audio_buffer.clear` over `oai-events`.

---

## OQ-003: Behavior Under Poor Network Conditions or Disconnects
- **Status**: RESOLVED (See **ADR-10**)
- **Resolution**: Enforce fetch timeouts (`30s` ingestion, `15s` token minting), implement a **`10-second` ICE disconnect recovery grace period** (`reconnecting` UI state), and if recovery fails, cleanly tear down the peer connection while preserving the entire conversation transcript and source context on screen with a one-tap **"Reconnect Voice Session"** button.

---

## OQ-004: Session Lifecycle (Stop, Restart, Switching Sources)
- **Status**: RESOLVED (See **ADR-06**)
- **Resolution**: Clicking `"Stop"`, switching sources (uploading a new PDF or submitting a new YouTube URL), or unmounting immediately tears down the active WebRTC session (`track.stop()`, `audioElement.srcObject = null`, closing `oai-events` and `RTCPeerConnection`). Starting a new session always mints a fresh `no-store` ephemeral token.

---

## OQ-005: Text-Fallback Mechanism When Microphone is Unavailable
- **Status**: RESOLVED (See **ADR-09**)
- **Resolution**: Operate over the same OpenAI Realtime WebRTC architecture. When `getUserMedia` fails or is denied, attach a `recvonly` audio transceiver (`pc.addTransceiver("audio", { direction: "recvonly" })`), connect the `oai-events` data channel, and dispatch user text questions via `conversation.item.create` (`input_text`) + `response.create`.

---

## OQ-006: Transcript Language, Formatting & Timestamps
- **Status**: RESOLVED (See **ADR-03** & **ADR-08**)
- **Resolution**: Prefer English (`en`/`en-US`) YouTube captions with fallback to the first available caption track, stripping XML tags/timestamps and decoding HTML entities. In the live conversation transcript, insert a user turn placeholder upon speech commit so user turns (`whisper-1`) and assistant turns always appear in strict chronological order with clear `User` / `Assistant` speaker labels.

---

## OQ-007: YouTube Ingestion Strategy (Deployed vs. Local)
- **Status**: RESOLVED (See **ADR-03**)
- **Resolution**: Perform server-side caption extraction supporting all standard YouTube URL formats, with optional `YOUTUBE_PROXY_URL` environment variable support for cloud deployments, and distinct error reporting for missing captions (`CAPTIONS_UNAVAILABLE`) vs. cloud IP blocks (`YOUTUBE_CLOUD_IP_BLOCKED`).

---

## OQ-008: 25 MB PDF Uploads vs Serverless Request Limits
- **Status**: RESOLVED (See **ADR-02**, **[CRITICAL-1] Option 1A**)
- **Resolution**: Target container hosting (Render / Railway) where the Node.js server natively supports `25 MB` `multipart/form-data` uploads (`<= 26,214,400` bytes), and document Vercel's `4.5 MB` serverless edge proxy limit in `README.md`.

---

## OQ-009: Realtime WebRTC Client Integration Method
- **Status**: RESOLVED (See **ADR-04** & **ADR-06**)
- **Resolution**: Use native browser `RTCPeerConnection`, `getUserMedia`, `<audio autoPlay playsInline>`, and the `oai-events` `RTCDataChannel` against `POST https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview` authenticated with ephemeral tokens from `POST /api/realtime/session` (`POST https://api.openai.com/v1/realtime/sessions`).

---

## OQ-010: Session Data Persistence Strategy
- **Status**: RESOLVED (See **ADR-12**)
- **Resolution**: Keep backend routes stateless with a bounded in-memory LRU/TTL cache keyed by YouTube `videoId` or PDF SHA-256 hash; no SQLite or filesystem writes required.
