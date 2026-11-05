# Open Questions & Ambiguities

This document records ambiguities and product decisions that require resolution. In accordance with project working rules, **no agent may quietly make decisions on these items**. Each question is marked **OPEN** for the `planner` agent to resolve with the user before implementation.

---

## OQ-001: Context Window Overflow Without Chunking/Summarization
- **Status**: OPEN (Assigned to: `planner`)
- **Assignment Context**: The assignment explicitly states: *"No chunking, summarization, or citation handling is required."* However, a dense 25 MB PDF or long YouTube transcript could exceed OpenAI Realtime session context token limits.
- **Question**: When extracted text exceeds the context capacity of the Realtime model, what is the expected fallback strategy? (e.g., simple head/tail truncation with user warning, maximum character cap, or error reporting)?

---

## OQ-002: User Interruption Handling of Model Speech
- **Status**: OPEN (Assigned to: `planner`)
- **Assignment Context**: Review script item 3 states: *"Test on mobile: start a voice conversation, interrupt, follow up naturally."*
- **Question**: Should voice interruption rely entirely on OpenAI Realtime's server-side Voice Activity Detection (server VAD) to cancel model audio playback, or is client-side audio track muting/cancellation required? What visual cue should indicate the model was interrupted?

---

## OQ-003: Behavior Under Poor Network Conditions or Disconnects
- **Status**: OPEN (Assigned to: `planner`)
- **Assignment Context**: Review script item 4 states: *"Test under poor network conditions to assess stability."*
- **Question**: What reconnection or retry behavior should the application exhibit when WebRTC connection drops or degrades? (e.g., auto-reconnect with session resumption, or degrade gracefully to text mode with clear status banner)?

---

## OQ-004: Session Lifecycle (Stop, Restart, Switching Sources)
- **Status**: OPEN (Assigned to: `planner`)
- **Assignment Context**: The requirements specify session controls ("start, stop, mute, etc.") and accepting both PDF or YouTube.
- **Question**: How should the application manage session transitions? When a user clicks "Stop" or switches to a new document/video:
  - Is the previous WebRTC session torn down immediately?
  - Does switching documents re-prime the existing session or initiate an entirely fresh session token?
  - Is past conversation history preserved across document switches?

---

## OQ-005: Text-Fallback Mechanism When Microphone is Unavailable
- **Status**: OPEN (Assigned to: `planner`)
- **Assignment Context**: *"If a microphone is unavailable, allow fallback to a text-based chat mode."*
- **Question**: Should the text fallback operate over the Realtime API WebRTC data channel (`conversation.item.create`), or should it route through standard OpenAI Chat Completions API (`/v1/chat/completions`)?

---

## OQ-006: Transcript Language, Formatting & Timestamps
- **Status**: OPEN (Assigned to: `planner`)
- **Assignment Context**: *"Display a text transcript of the ongoing conversation in real time."*
- **Question**: What level of formatting and metadata is expected in the real-time transcript? (e.g., speaker labels `User:` / `Assistant:`, auto-scroll behavior, markdown rendering, or timestamps)? What should happen with non-English YouTube transcripts or multi-lingual PDFs?

---

## OQ-007: YouTube Ingestion Strategy (Deployed vs. Local)
- **Status**: OPEN (Assigned to: `planner`)
- **Assignment Context**: The assignment notes that cloud provider IP ranges are blocked by unofficial YouTube scraper endpoints. A local demonstration is acceptable, while deployed functioning is an optional bonus.
- **Question**: What library or mechanism should be implemented first? Should we prioritize a lightweight server-side fetch with informative local-only explanation on cloud, or incorporate an external proxy/caption service for deployed environments?

---

## OQ-008: 25 MB PDF Uploads vs Serverless Request Limits
- **Status**: OPEN (Assigned to: `planner`)
- **Assignment Context**: PDF files up to 25 MB must be supported, and PDF ingestion must work in the deployed application. Serverless platforms like Vercel impose request payload limits (e.g. 4.5 MB body limit on serverless functions).
- **Question**: How should the upload architecture be structured to handle up to 25 MB files in deployment? (e.g., chunked streaming upload, client-side pre-processing, hosting on Render/Railway with higher payload limits, or pre-signed storage URLs)?

---

## OQ-009: Realtime WebRTC Client Integration Method
- **Status**: OPEN (Assigned to: `planner`)
- **Assignment Context**: Assignment recommends using OpenAI Realtime API (WebRTC) with ephemeral tokens.
- **Question**: Should the client implementation use native browser `RTCPeerConnection` and `getUserMedia` primitives directly, or integrate an official/community client wrapper?

---

## OQ-010: Session Data Persistence Strategy
- **Status**: OPEN (Assigned to: `planner`)
- **Assignment Context**: *"In-memory or lightweight database (e.g., SQLite) is sufficient. No persistent user authentication required."*
- **Question**: Is an ephemeral in-memory session cache adequate for the demo, or should a lightweight SQLite file (e.g. via `better-sqlite3` or Turso) be used to persist session transcripts across page refreshes?
