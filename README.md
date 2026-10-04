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

## Local development

### Prerequisites

- Node 20+, `pnpm` 9 (`npm i -g pnpm` if missing)
- Docker (for `supabase start` — the local Postgres + API stack)

### First-time setup

```bash
pnpm install
cp .env.example .env
supabase start        # starts local Postgres, PostgREST, Auth, Studio…
supabase status       # prints the local API URL and anon key
```

Copy the `API URL` and `anon key` from `supabase status` into `.env`:

```
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<anon key from supabase status>
```

### Daily commands

| Command | What it does |
|---|---|
| `pnpm dev` | Start the Vite dev server |
| `supabase start` / `supabase stop` | Start / stop the local Supabase stack |
| `pnpm gen:types` | Regenerate `src/types/database.ts` from the **local** DB — run after every migration |
| `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build` | Quality gates |

Supabase Studio (local dashboard) is at http://127.0.0.1:54323.

### Migrations

Schema changes live **only** in `supabase/migrations/` as timestamped SQL files
(`supabase migration new <name>`). Never edit a migration that has already run —
add a new one. After applying, run `pnpm gen:types`.

## Status

Run 1 complete (2026-10-04): P0-01 repo init. Next: P0-02 Supabase project setup.
