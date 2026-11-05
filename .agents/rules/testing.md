# Testing Discipline

1. **Test-First Separation**:
   - Unit and integration tests in `tests/` are authored by `test-writer` based strictly on requirements and acceptance criteria in `docs/memory/requirements.md` and ADRs in `docs/memory/decisions.md`.
   - `test-writer` does not read `src/` to ensure tests evaluate requirements, not current implementation.
2. **Implementer Boundaries**:
   - `implementer` must write code to satisfy existing tests and may not modify, weaken, or delete tests to force a pass.
3. **Execution**:
   - All tests run via Vitest (`npm test`).
   - Mock external network requests in unit and integration test suites.
