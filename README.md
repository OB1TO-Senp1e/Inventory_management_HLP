# Restaurant Inventory App

Production-grade restaurant inventory and kitchen-flow management (single restaurant, India locale).
Built by an autonomous build loop — see `docs/LOOP_PROMPT.md`.

## State files (source of truth between runs)

- `ARCHITECTURE.md` — stack, data model, conventions, decisions
- `TASKS.md` — ordered task list (one task per run)
- `PROGRESS.md` — append-only run log
- `BLOCKERS.md` — human-only inputs needed
- `ROUTES.md` — every route and its status
- `FEATURE_MATRIX.md` — screen → component → api → DB → test

## Per-run kickoff

> Continue the Restaurant Inventory build. Read ARCHITECTURE.md, TASKS.md, PROGRESS.md, BLOCKERS.md, ROUTES.md and FEATURE_MATRIX.md. Verify the baseline, complete exactly one task as a full vertical slice, pass every quality gate, update all state files, commit, and stop with the 5-line summary.

## Status

Run 0 bootstrap complete (2026-10-04). Next: P0-01 Repo init.
