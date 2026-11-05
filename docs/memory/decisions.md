# Architectural Decision Records (ADRs)

This document tracks durable technical and design decisions. Every significant decision must be recorded here with context, options considered, rationale, and consequences.

---

## ADR-001: Adopt Recommended Next.js (App Router) + TypeScript Stack

- **Status**: Accepted
- **Context**: The assignment recommends Next.js (App Router) + React + TypeScript for frontend, and Node.js / Next API routes for backend.
- **Decision**: Use Next.js 16 (App Router) with React 19 and TypeScript as a single unified full-stack repository.
- **Consequences**:
  - Unified codebase for UI and server-side ingestion / token routes.
  - Zero CORS overhead for internal API routes.
  - Direct compatibility with standard serverless hosting platforms (e.g. Vercel).

---

## ADR-002: Test Runner Selection (Vitest)

- **Status**: Accepted
- **Context**: The project requires unit and integration test infrastructure with minimal overhead and native TypeScript support.
- **Decision**: Use Vitest as the test runner instead of Jest.
- **Consequences**:
  - Native ESM and TypeScript support without Babel or `ts-jest` boilerplate.
  - Fast execution and compatibility with modern Node/Next environments.

---

## ADR-003: Backend Ephemeral Tokens for Realtime Voice Security

- **Status**: Accepted
- **Context**: The assignment strictly mandates: "API keys must never be exposed in the client. All Realtime connections must use ephemeral tokens or authenticated backend routes."
- **Decision**: Implement a server-side route (`/api/session`) that uses the private `OPENAI_API_KEY` to request a short-lived ephemeral client session token from OpenAI's REST API (`/v1/realtime/sessions`), returning only the ephemeral token to the client.
- **Consequences**:
  - Private API keys remain strictly on the server.
  - Browser establishes direct WebRTC audio connection to OpenAI using only the ephemeral token.
