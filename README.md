# Talk to a Document or YouTube Video

A mobile-first web application enabling live, voice-based conversations with uploaded PDF documents or YouTube videos powered by OpenAI's Realtime API.

---

## 1. Project Overview & Architecture

### High-Level Design
- **Frontend**: Next.js 15 (App Router) + React 19 + TypeScript, designed with a mobile-first responsive viewport (~390px width).
- **Backend**: Node.js Next.js API Routes for server-side PDF text extraction, YouTube transcript retrieval, and ephemeral token negotiation.
- **Voice Engine**: OpenAI Realtime API (WebRTC) using backend-minted ephemeral session tokens (zero client-side API key exposure).
- **Testing**: Vitest for fast, native TypeScript unit and integration testing.

---

## 2. Environment Configuration & Setup

### Prerequisites
- Node.js `v20.x` (LTS)
- npm `10.x` or higher
- OpenAI API Key with Realtime API access

### Installation
1. Clone the repository:
   ```bash
   git clone <repo-url>
   cd TalktToMe
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Configure environment variables:
   Copy `.env.example` to `.env.local` and add your secret OpenAI key:
   ```bash
   cp .env.example .env.local
   ```
   Edit `.env.local`:
   ```env
   OPENAI_API_KEY=your_openai_api_key_here
   ```

---

## 3. Running the Application

### Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your mobile browser or responsive emulator (~390px width).

### Build for Production
```bash
npm run build
npm run start
```

### Verification & Testing
Run the complete health check suite (typecheck, lint, and tests):
```bash
npm run verify
```

Or run individual checks:
```bash
npm run typecheck   # Strict TypeScript check (tsc --noEmit)
npm run lint        # ESLint analysis (next lint)
npm test            # Vitest suite (vitest run)
```

---

## 4. Technical Trade-Offs & Architecture Decisions

1. **Node.js Runtime & Dependency Pinning**:
   - The developer machine runs Node.js `v20.17.0`. Bleeding-edge `eslint@10` and `vitest@5` mandate Node `>=20.19.0` or `>=22.12.0`. To ensure 100% stability without engine warnings or peer-dependency conflicts, dependencies were pinned to Next.js 15 LTS (`15.5.29`), ESLint `9.20.0`, TypeScript `5.8.2`, and Vitest `3.2.7`.
2. **WebRTC Ephemeral Tokens vs Client Secrets**:
   - Private API keys are never exposed to browser bundles. Authentication is negotiated server-side, granting short-lived ephemeral session tokens for direct client WebRTC audio streaming.
3. **YouTube Ingestion Cloud Limitations**:
   - Unofficial YouTube transcript scrapers are routinely blocked by cloud provider IP addresses. In accordance with the assignment guidelines, local YouTube demonstration is supported and documented, with deployed operation treated as an extension bonus.
4. **Context Window Handling**:
   - In accordance with assignment instructions, no chunking, summarization, or retrieval pipelines are implemented; source text is passed directly into the session priming context.

---

## 5. Notes on AI Use

This project utilizes Google Antigravity autonomous coding agents operating under durable, role-separated permission boundaries:
- **Planner Agent**: Requirements analysis, architectural design, and ADR authoring in `docs/memory/`.
- **Test-Writer Agent**: Authors unit and integration tests strictly from specifications (denied access to implementation code).
- **Implementer Agent**: Implements modular code in `src/` to satisfy tests (denied modifying tests or installing packages).
- **Reviewer Agent**: Read-only verification auditing diffs and security constraints.

A detailed, immutable audit log of AI usage, models used, tools exercised, and rationales is maintained in [`docs/memory/ai-usage-log.md`](docs/memory/ai-usage-log.md).
