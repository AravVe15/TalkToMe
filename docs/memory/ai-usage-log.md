# AI Usage Log

This document records the use of AI-assisted tools and models throughout the lifecycle of the project. It directly supports the deliverable requirement: *"Notes on AI Use: please briefly note where and how they helped. We're evaluating your workflow and reasoning, not penalizing tool usage."*

---

## Session Log

| Date | Phase / Task | Agent / Tool | Model Used | Action & Reasoning | Tools Exercised | Output / Contribution |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 2026-11-05 | Project Initialization & Setup (Steps 1 & 2) | Antigravity CLI / Orchestrator | Gemini 3.8 Flash (High) | Decomposed `assignment.pdf`, verified Antigravity custom agent schemas and model tier enums, initialized git repository with secret protection (`.gitignore`, `.env.example`), created persistent memory bank (`requirements.md`, `decisions.md`, `open-questions.md`, `lessons-learned.md`, `ai-usage-log.md`). Checked live registry package versions. | `read_file`, `write_file`, `run_command` | Commits `8a4c926` and `024a222`; complete version-controlled memory bank; git branch renamed to `main`. |
| 2026-11-05 | Rules, Custom Agents & Boundary Probes (Step 3) | Antigravity CLI / Orchestrator | Gemini 3.8 Flash (High) | Configured `AGENTS.md` (constraints, default execution mode, commit discipline, no .env reading), `.agents/rules/` (`security.md`, `typing.md`, `testing.md`), and custom agent manifests (`planner.md`, `test-writer.md`, `implementer.md`, `reviewer.md`). Configured recursive trailing-slash paths and exact command permissions. Executed comprehensive 8-part boundary probe battery using dummy `.env` and temporary test directories. | `write_file`, `read_file`, `run_command` (`agy --agent <role> -p`), `search_web` | Verified all 4 roles load (`PONG`). Confirmed system-level denial of cross-role writes (including nested paths like `tests/unit/` and `src/lib/`). Confirmed exact command matching prevents command chaining. Documented that shell reads/writes bypass tool-level rules and are governed by `AGENTS.md` instructions. Deleted all temporary probe files and dummy `.env`. |
| 2026-11-05 | Toolchain, Structure, Smoke Test & Verification (Steps 4–8) | Antigravity CLI / Orchestrator | Gemini 3.8 Flash (High) | Scaffolded `package.json` with compatible stable versions (Next 15.5.29, React 19, TS 5.8.2, ESLint 9.20, Vitest 3.2.7), configured `tsconfig.json` (strict), `next.config.ts`, `vitest.config.ts`, `.eslintrc.json`, and minimal app starter. Executed real `npm install`. Created verification skill (`.agents/skills/verify-and-commit/SKILL.md`). Scaffolded modular directory structure (`src/app/api/`, `src/components/`, `src/hooks/`, `src/lib/ingest/`, `src/lib/context/`, `src/lib/realtime/`, `src/types/`) using `.gitkeep` files with zero code stubs (omitted `src/lib/storage/`). Added single smoke test in `tests/smoke.test.ts`. Authored assignment-compliant `README.md`. Verified full health check via `npm run verify` (`tsc` + `next lint` + `vitest`). | `write_file`, `read_file`, `run_command` | Clean toolchain, passing smoke test, zero-code folder skeleton with `.gitkeep`, assignment-compliant `README.md`, verified with `npm run verify`. |
| 2026-11-05 | Slice 1: Ingestion Engine Unit Tests | Test-Writer | Gemini 3.8 Flash (High) | Authored comprehensive test suites and fixtures for Slice 1 (PDF spatial extraction & YouTube transcript ingestion) strictly derived from requirements.md (AC-01, AC-02, AC-03, AC-12) and decisions.md (ADR-01, ADR-02, ADR-03, ADR-12). Established type contracts via shims.d.ts without reading or writing src/. Verified fixtures and TypeScript typechecking. | `read_file`, `write_file`, `run_command` (`npx tsc`, `npx vitest`) | Created `tests/fixtures/ingest-fixtures.ts`, `tests/types/shims.d.ts`, `tests/unit/ingest/youtube.test.ts`, `tests/unit/ingest/pdf.test.ts`, `tests/unit/ingest/cache.test.ts`, and `tests/unit/ingest/fixtures.test.ts`. 12 fixture tests passing, full test suites ready for implementer. |

*(Subsequent agent sessions must append their entries to this table before concluding their turn.)*


## Session: 2026-11-05 (Planner — Independent Audit & Decisions Proposal)
- **Agent**: `planner`
- **Model**: Gemini 4 Argon (High)
- **Task**: Conducted an independent zero-prior audit of `assignment.pdf`, `AGENTS.md`, and `.agents/agents/planner.md`; researched OpenAI Realtime API WebRTC specifications, token limits, and Next.js PDF/YouTube ingestion constraints; authored `docs/memory/planner-proposal.md`.
- **Rationale**: Formulated a comprehensive, one-pass architectural proposal (ADR-01 through ADR-12 with testable acceptance criteria) and isolated the 3 critical deployment/context-limit/API-version decisions requiring user confirmation before updating `docs/memory/decisions.md` and `docs/memory/requirements.md`.

## Session: 2026-11-05 (Planner — ADR Finalization & Acceptance Criteria Specification)
- **Agent**: `planner`
- **Model**: Gemini 4 Argon (High)
- **Task**: Incorporated user approvals and adjustments on `[CRITICAL-1]` (Option 1A: Render/Railway container host + Vercel 4.5 MB note), `[CRITICAL-2]` (Option 2B: full text preview + 48,000-char / ~12,000-token Realtime context cap with warning banner), `[CRITICAL-3]` (Option 3A: `POST /v1/realtime/sessions` with `gpt-4o-realtime-preview`), and `ADR-01` through `ADR-12` (`whisper-1` input transcription, removal of `CONTEXT_TOO_LARGE_FOR_REALTIME` from `IngestionErrorCode`) into `docs/memory/decisions.md`, `docs/memory/requirements.md`, and `docs/memory/open-questions.md`.
- **Rationale**: Locked all architectural decisions (`ADR-01`–`ADR-12`) and authored explicit, verifiable acceptance criteria (`AC-01.1`–`AC-12.1`) so the `test-writer` agent can construct comprehensive unit and integration tests.

## Session: 2026-11-05 (Planner — ADR-02 Spatial PDF Extraction Amendment & Lesson Learned)
- **Agent**: `planner`
- **Model**: Gemini 4 Argon (Medium)
- **Task**: Amended `ADR-02` in `docs/memory/decisions.md` and added `AC-02.6` in `docs/memory/requirements.md` to replace naive stream-order PDF extraction with spatial coordinate-aware extraction (`pdfjs-dist` / `pdfexcavator`), multi-column gutter detection/reading-order reconstruction, and vertical void collapsing (`\n\n`); logged the architectural blind spot and correction in `docs/memory/lessons-learned.md`.
- **Rationale**: Ensure multi-column PDFs do not suffer from horizontal sentence interleaving or blank-line voids around embedded figures, meeting the `"4 - Exceptional"` Ingestion Quality evaluation rubric.

## Session: 2026-11-05 (Test-Writer — Slice 1 Ingestion Engine Unit Test Suites & Implicit Boundary Tests)
- **Agent**: `test-writer`
- **Model**: Gemini 3.8 Flash (High)
- **Task**: Authored full unit test suites, test fixtures, and TypeScript ambient type definitions for Slice 1 (Ingestion Engine: PDF spatial extraction, YouTube transcript ingestion, and in-memory caching) under `tests/unit/ingest/` based strictly on `docs/memory/requirements.md` (AC-01, AC-02, AC-03, AC-12) and `docs/memory/decisions.md` (ADR-01, ADR-02, ADR-03, ADR-12). In response to user direction, identified 5 implicit negative paths and boundary conditions not explicitly stated in the AC:
  1. Malformed request envelopes & type inversion (malformed JSON syntax, non-string `url` types, non-multipart PDF body, wrong form-data key).
  2. Upstream HTTP 200 false positives with empty transcript XML (`<transcript></transcript>`), music/cue-only bodies (`[Music]`, `♪♪♪` < 20 chars), and HTML bot/challenge bodies.
  3. PDF structural anomalies including unclosed/truncated streams, zero-page documents (`/Count 0`), and circular object references.
  4. YouTube URL query parameter pollution (multiple `v=` parameters) and empty route segments (`/shorts/`, `/embed/`, `/live/`).
  5. In-memory cache cross-source namespace isolation (`youtube:` vs `pdf:`) and zero/negative TTL handling.
- **Rationale**: Followed strict test-first separation boundaries: authored tests purely from requirements, specifications, and defensive boundary analysis without reading or writing any files in `src/`. Established explicit contracts in `tests/types/shims.d.ts` so `npx tsc --noEmit` verifies with 0 errors. Verified all 18 fixture tests pass with 100% success rate, ensuring a robust, deterministic test bed for the implementer agent.
