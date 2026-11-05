# Project Requirements

This document captures the functional, non-functional, and deliverable requirements derived directly from [assignment.pdf](../../assignment.pdf). It serves as the durable baseline for all agents.

---

## 1. Objective

Build a mobile-first web application that allows users to interact with uploaded documents or YouTube videos through live, voice-based conversations powered by OpenAI's Realtime API.

Core flow:
1. Accept a YouTube URL (with accessible transcript/captions) OR a PDF file (≤ 25 MB).
2. Extract text from the provided source.
3. Use the extracted text to prime a conversational context.
4. Initiate a live voice conversation with OpenAI's Realtime API, allowing the user to ask spoken questions and receive spoken answers in real time.
5. Deliver an intuitive, responsive, mobile-first experience.

---

## 2. Mandatory Functional Requirements

### Ingestion
- **PDF Upload**:
  - Accept PDF file uploads up to 25 MB.
  - Text extraction must occur server-side.
  - PDF ingestion must work in the deployed application.
- **YouTube Ingestion**:
  - Accept a YouTube video URL with accessible transcript or captions.
  - Transcript retrieval must occur server-side.
  - Local demonstration is acceptable (due to cloud provider IP blocking on unofficial endpoints); deployed functionality is an explicit bonus.
  - Explain limitations in the README.
- **Preview**:
  - Display extracted text to the user in a collapsible or preview format before or during the conversation.

### Context Preparation
- Once text is extracted, make it available for use as context in an OpenAI Realtime session.
- Explicit constraint from assignment: **No chunking, summarization, or citation handling is required.**

### Voice Conversation
- Include a "Start Voice Chat" button to establish a live session with OpenAI Realtime Voice API.
- The user can speak questions and hear audio answers in real time.
- Display a real-time text transcript of the ongoing conversation.
- If a microphone is unavailable, provide fallback to a text-based chat mode.

### User Interface
- Mobile-first design optimized for ~390 px width screens (modern smartphone viewport).
- Clear microphone and session controls (start, stop, mute, etc.).
- Visual connection status and clear conversation flow.

### Security
- API keys must **never** be exposed in client code or browser network traffic.
- All Realtime connections must use ephemeral tokens or authenticated backend routes.

---

## 3. Recommendations (Explicitly Non-Mandatory)

The following items are recommendations provided in the assignment, not strict mandates:
- **Frontend**: Next.js (App Router) + React + TypeScript *(Recommended)*.
- **Backend**: Node.js / Next API routes (or Express/Fastify) + TypeScript *(Recommended)*.
- **Realtime Integration**: OpenAI Realtime API (WebRTC) for live audio sessions with backend-issued ephemeral tokens *(Recommended)*.
- **PDF Extraction**: Server-side library such as `pdf-parse`, `pdfjs-dist`, or equivalent *(Recommended)*.
- **YouTube Retrieval**: Server-side transcript fetch *(Recommended)*.
- **Data Storage**: In-memory or lightweight database (e.g., SQLite) is sufficient. No persistent user authentication required *(Recommended)*.

---

## 4. Deliverables

1. **Working Web Application**:
   - Frontend interface for uploading or entering a YouTube URL.
   - Backend handling ingestion, text extraction, and Realtime session setup.
   - Hosted publicly (e.g., Vercel, Render, Railway, Firebase, Netlify) ready to demo.
2. **Video Walkthrough (10–15 minutes)**:
   - Demonstrate full workflow: upload/enter link -> view extracted text -> live voice chat.
   - Explain key architectural and design decisions (frameworks, backend, hosting, Realtime integration, libraries).
3. **GitHub Repository**:
   - Publicly accessible.
   - Clean, modular source code for frontend and backend.
   - README with setup and environment configuration.
   - Unit or integration tests where appropriate.
4. **Notes on AI Use**:
   - Note where and how AI-assisted tools helped (evaluating workflow and reasoning).

---

## 5. Evaluation Criteria & Timeline

- **Criteria**: Product Polish (Mobile ~390px), Ingestion Quality, Code Quality (modular, typed, secure, tested), System Design.
- **Timeline**: 7 business days from receipt.
