# AI Usage Log

This document records the use of AI-assisted tools and models throughout the lifecycle of the project. It directly supports the deliverable requirement: *"Notes on AI Use: please briefly note where and how they helped. We're evaluating your workflow and reasoning, not penalizing tool usage."*

---

## Session Log

| Date | Phase / Task | Agent / Tool | Model Used | Action & Reasoning | Tools Exercised | Output / Contribution |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 2026-11-05 | Project Initialization & Setup (Steps 1 & 2) | Antigravity CLI / Orchestrator | Gemini 3.8 Flash (High) | Decomposed `assignment.pdf`, verified Antigravity custom agent schemas and model tier enums, initialized git repository with secret protection (`.gitignore`, `.env.example`), created persistent memory bank (`requirements.md`, `decisions.md`, `open-questions.md`, `lessons-learned.md`, `ai-usage-log.md`). Checked live registry package versions. | `read_file`, `write_file`, `run_command` | Commits `8a4c926` and `024a222`; complete version-controlled memory bank; git branch renamed to `main`. |
| 2026-11-05 | Rules, Custom Agents & Boundary Probes (Step 3) | Antigravity CLI / Orchestrator | Gemini 3.8 Flash (High) | Configured `AGENTS.md` (constraints, default execution mode, commit discipline, no .env reading), `.agents/rules/` (`security.md`, `typing.md`, `testing.md`), and custom agent manifests (`planner.md`, `test-writer.md`, `implementer.md`, `reviewer.md`). Configured recursive trailing-slash paths and exact command permissions. Executed comprehensive 8-part boundary probe battery using dummy `.env` and temporary test directories. | `write_file`, `read_file`, `run_command` (`agy --agent <role> -p`), `search_web` | Verified all 4 roles load (`PONG`). Confirmed system-level denial of cross-role writes (including nested paths like `tests/unit/` and `src/lib/`). Confirmed exact command matching prevents command chaining. Documented that shell reads/writes bypass tool-level rules and are governed by `AGENTS.md` instructions. Deleted all temporary probe files and dummy `.env`. |

*(Subsequent agent sessions must append their entries to this table before concluding their turn.)*
