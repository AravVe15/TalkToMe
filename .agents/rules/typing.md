# TypeScript Rules

1. **Strict Type Safety**:
   - Strict mode is enabled in `tsconfig.json`.
   - Never use `any`. Use `unknown` with type guards where data shape is uncertain.
   - Do not disable compiler rules using `@ts-ignore` or `@ts-nocheck` without explicit user approval.
