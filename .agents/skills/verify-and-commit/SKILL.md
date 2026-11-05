---
name: verify-and-commit
description: Run the standardized cross-platform verification routine (typecheck, lint, test) and prepare a suggested conventional commit message.
---

# Verify and Commit Skill

This skill documents the standard verification routine that agents and developers run to ensure code health and repository integrity before committing changes.

## 1. Automated Verification Gate

Run the unified cross-platform verification script from the repository root:

```bash
npm run verify
```

This script executes the three essential health checks in sequence:
1. `npm run typecheck` (`tsc --noEmit`): Confirms strict TypeScript type safety.
2. `npm run lint` (`next lint`): Confirms zero ESLint errors or rule violations.
3. `npm test` (`vitest run`): Executes all unit and integration test suites.

> [!IMPORTANT]
> If any step of `npm run verify` fails, stop immediately. Resolve all type errors, lint warnings, or broken tests before proceeding.

---

## 2. Pre-Commit Review & Hygiene Checklist

Before concluding your task:
1. **Secret Leak Audit**:
   - Inspect `git status` and `git diff`.
   - Confirm that no `.env` or credential files are staged.
   - Confirm no API keys or tokens are hardcoded.
2. **File Boundary Audit**:
   - Verify that changes conform strictly to your role boundaries:
     - `test-writer` must only have modified files in `tests/` and `docs/memory/ai-usage-log.md`.
     - `implementer` must only have modified files in `src/` and allowed memory logs.
     - `planner` must only have modified documentation in `docs/memory/`.
3. **Staging Discipline**:
   - Stage only the specific files relevant to your task (e.g. `git add path/to/file`). Avoid indiscriminate `git add .` if untracked temporary files are present.

---

## 3. Conventional Commit Suggestion

Per project rules in `AGENTS.md`, **no agent commits code directly**. Conclude your session by presenting a suggested conventional commit message formatted as:

```text
<type>(<scope>): <short imperative summary>

- Detailed bullet point 1
- Detailed bullet point 2
```

Valid types: `feat`, `fix`, `test`, `docs`, `refactor`, `chore`, `perf`.
