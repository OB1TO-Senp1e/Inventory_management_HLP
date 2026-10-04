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

### Seed data (dev only)

`supabase/seed.sql` loads sample data for development — 1 restaurant, 3 users
(one per role), sample categories, locations, and units. It is idempotent
(`ON CONFLICT DO NOTHING`), dev-only, and never touches the `auth` schema, so
it runs unchanged on Supabase cloud.

| Command | What it does |
|---|---|
| `pnpm db:seed` | Apply the seed to the interim local DB (native PostgreSQL) |
| `supabase db reset` | On real Supabase: re-applies migrations + `seed.sql` automatically |
| SQL editor | On Supabase cloud: paste `supabase/seed.sql` into the SQL editor |

## Test users

Three fixed test users, one per role (created by `pnpm db:seed`):

| Role | UUID | Suggested login email |
|---|---|---|
| owner | `11111111-1111-4111-8111-111111111111` | `owner@demo.local` |
| manager | `22222222-2222-4222-8222-222222222222` | `manager@demo.local` |
| staff | `33333333-3333-4333-8333-333333333333` | `staff@demo.local` |

What each role can do is defined by the role matrix in `ARCHITECTURE.md` §7
(RLS is the authority; the UI only hides what a role can't do).

**Honest note:** real login passwords and GoTrue users don't exist yet — the
Supabase cloud project hasn't been created (B-001). When it arrives: sign the
three users up with the emails above, then insert matching `profiles` rows via
the SQL editor using the UUIDs from their `auth.users` records (or the fixed
UUIDs above, if you create the auth users with those IDs). Until then, role-based
UI development uses the test-only `ri.mockRole` localStorage hook in
`src/api/auth.ts` (set by Playwright fixtures and `pnpm audit:routes`; never
shipped to production) — RLS stays the real enforcement in the database.

## CSV import/export

The Items and Suppliers pages (owner/manager only) have **Export** and
**Import** actions.

- **Export** downloads every active record as CSV (`items-YYYY-MM-DD.csv`),
  UTF-8 with BOM so Excel opens it correctly.
- **Import** opens a dialog: pick a `.csv` file → every row is validated and
  shown in a preview table (ready / error with reason) → press
  **Import N valid rows** to save. Nothing is committed before you confirm.
  Rows that fail at save time (e.g. duplicate names) are listed in a result
  report; the rest still import.
- A **Download template** button in the dialog produces a header-only CSV.
  Headers are matched case-insensitively; extra columns are ignored.

**Items columns:** `name` (required, unique), `category` (optional — category
name, must already exist under Settings), `unit` (required — unit name or
symbol, e.g. `kg`), `storage_location` (optional — location name, must exist
under Settings), `par_level` (optional number, default 0), `reorder_point`
(optional number, default 0).

**Suppliers columns:** `name` (required, unique), `contact_person`, `phone`,
`email`, `address`, `gstin` (15-character), `notes` — all optional.

## Status

Runs 0–11 complete (2026-10-04): bootstrap, P0-01 repo init, P0-02 Supabase setup
(BLOCKED — B-002, no Docker in this VM), P0-03 core schema, P0-04a auth UI +
guards, P0-05 AppShell, P0-06 audit tooling, P0-07 seed data and test users,
P1-01 items, P1-02 locations/categories, P1-03 suppliers, P1-04 supplier price
lists. Next: P1-05 CSV import/export.
