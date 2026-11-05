# TalkToMe: Durable Agent Rules

Every agent session operating in this repository MUST comply with these rules.

## 1. Project Memory
- The source of truth resides strictly in version-controlled repository files:
  - `docs/memory/requirements.md`: Functional and non-functional requirements and acceptance criteria.
  - `docs/memory/decisions.md`: Architecture Decision Records (ADRs).
  - `docs/memory/open-questions.md`: Unresolved questions. Never invent requirements.
  - `docs/memory/lessons-learned.md`: Platform and runtime gotchas.
  - `docs/memory/ai-usage-log.md`: Every agent session must log its model, task, and rationale before exiting.

## 2. Session Execution Mode
- Sessions MUST ALWAYS be run in **default permission mode** (e.g. `agy --agent <name>`).
- **NEVER** launch sessions with `--dangerously-skip-permissions` or automated `auto`/`turbo` modes, because unmatched actions run silently without user confirmation in those modes.

## 3. Assignment Constraints & Discipline
- **No Chunking, Summarization, or Retrieval**: The assignment explicitly specifies that extracted context is passed directly to the Realtime session. Do not implement RAG, chunking, or summarization pipelines.
- **No Invented Requirements**: Stick strictly to `assignment.pdf`. Label recommendations as recommendations. Record ambiguities as open questions for the planner.
- **Acceptance Criteria**: For every decision or architectural choice, the planner must document explicit, verifiable acceptance criteria in `docs/memory/requirements.md` so the `test-writer` can write tests against them.
- **Secrets & Credentials**:
  - API keys (`OPENAI_API_KEY`) reside exclusively in server-side environment variables. Never expose keys in client code or browser payloads.
  - Browser WebRTC authenticates exclusively with short-lived ephemeral tokens issued by a backend route; the specific route path and upstream endpoint are decided by the planner after consulting current OpenAI documentation.
  - **No agent may read or print the contents of `.env` or any `.env*` file via any file tool or shell command (e.g. `cat`, `type`, `Get-Content`).**
- **Commit Discipline**:
  - **No agent commits code.** Agents must finish by presenting a suggested conventional commit message (`feat:`, `test:`, `docs:`, `chore:`, `refactor:`). The user reviews and commits manually.
- **Dependency & Config Control**:
  - Agents may not edit `package.json`, `package-lock.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `AGENTS.md`, `.agents/`, `.gitignore`, `.env.example`, `assignment.pdf`, or `README.md`.
  - The implementer must stop and ask the user before installing any dependency.
- **Role Separation**:
  - `planner`: Read-only on code and tests. Formulates plans and acceptance criteria; resolves open questions. Proposes rule changes in `docs/memory/`.
  - `test-writer`: Writes tests in `tests/`. Denied reading or writing files in `src/`.
  - `implementer`: Writes code in `src/`. Denied editing tests in `tests/`.
  - `reviewer`: Read-only on code, tests, and configs. Audits diffs and runs verification.
