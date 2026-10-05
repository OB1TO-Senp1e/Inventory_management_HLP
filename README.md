# Restaurant Inventory App

Production-grade restaurant inventory and kitchen-flow management for a single
restaurant (India locale, ₹ en-IN). Covers the full loop: items → suppliers →
purchase orders → receiving → stock → recipes → sales → stock counts →
dashboard & reports — as an installable PWA with offline support.

Built by an autonomous build loop — see `docs/LOOP_PROMPT.md`.

## Features

**Inventory & stock**
- Items CRUD with categories, storage locations, units, par/reorder levels
- Append-only stock ledger (every movement recorded, corrections are new movements)
- Goods receiving with batch/expiry tracking and database-side weighted-average cost
- Usage & wastage logging with closed reason codes
- Stock overview with low-stock / expiring-soon filters and per-supplier reorder suggestions
- Stock counts: sessions, mobile-optimised count sheet with auto-save, variance review & approval posting `count_adjustment` movements

**Purchasing**
- Purchase orders: draft → sent → partially received → received (DB-enforced transitions), cancel from draft/sent
- Line prices snapshotted at creation; receiving posts ledger rows at the snapshotted price
- One-click draft PO from reorder suggestions; printable PO document with GST

**Recipes & sales**
- Menu items with recipe builder, yield quantities, and one-hop unit conversion (g↔kg, ml↔L)
- Live cost per dish and food-cost % from weighted-average ingredient costs
- Daily sales entry deducting stock per recipe ingredient; over-sale warning with explicit confirm, movement flagging, and audit entry

**Insights & admin**
- Dashboard: low stock, expiring soon, today's usage/wastage, stock value
- Reports: usage, wastage by reason, food-cost trend, supplier price changes — date filters, charts, CSV export
- Audit log (owner only): over-sales, count applications, with actor/time/details

**PWA & offline**
- Installable (manifest, icons, service worker, install prompt); Lighthouse PWA 1.0
- Offline shell; wastage/usage/receiving queue offline and sync on reconnect with visible sync status

## Tech stack

React 18.3 · strict TypeScript · Vite · Tailwind CSS + shadcn/ui · React Router ·
TanStack Query · React Hook Form + Zod · Recharts · Supabase (PostgreSQL +
PostgREST + GoTrue Auth) · Vitest · Playwright · pnpm

## Roles

| Role | Access |
|---|---|
| Owner | Everything, including audit log, user-facing costs, approvals |
| Manager | Everything except the audit log screen and user management |
| Staff | Fieldwork only: receiving, usage/wastage logging, assigned stock counts. **Staff never see costs** — enforced by RLS and cost-free RPCs, not just hidden UI |

RLS is the authority; the UI only hides what a role can't do.

## Getting started

### Prerequisites

- Node 20+ and pnpm 9 (`npm i -g pnpm@9.12.0`)
- PostgreSQL 16 **or** Docker (for the Supabase local stack)

### Install

```bash
pnpm install
cp .env.example .env
```

### Database — pick one path

**Path A — Supabase local stack (needs Docker):**

```bash
supabase start        # Postgres + PostgREST + Auth + Studio
supabase status       # prints the local API URL and anon key
```

Put the API URL and anon key into `.env`:

```
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<anon key from supabase status>
```

Supabase Studio: http://127.0.0.1:54323.

**Path B — native PostgreSQL (no Docker):**

```bash
# as the postgres OS user, create DB `restaurant_inventory`, then:
pnpm db:seed   # interim setup + all migrations + seed data
```

Interim-only scaffolding (e.g. the stub `auth.users`) lives in
`scripts/interim-db-setup.sql` and is **never** part of `supabase/migrations/`.

### Run

```bash
pnpm dev        # Vite dev server
```

### Migrations & types

Schema changes live **only** in `supabase/migrations/` as timestamped SQL.
Never edit a migration that already ran — add a new one. After applying:

```bash
pnpm gen:types            # from the Supabase local stack
pnpm gen:types:interim    # from the interim native PostgreSQL
```

### Seed data (dev only)

`supabase/seed.sql` loads 1 restaurant, 3 users (one per role), 7 categories,
4 locations, 5 units. Idempotent (`ON CONFLICT DO NOTHING`); never touches the
`auth` schema, so it runs unchanged on Supabase cloud.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Vite dev server |
| `pnpm build` | Typecheck + production build |
| `pnpm typecheck` / `pnpm lint` | `tsc --noEmit` / ESLint (0 warnings allowed) |
| `pnpm test` | Vitest unit suite |
| `pnpm test:db` | PostgreSQL test suite (`supabase/tests/*.sql`, real RLS assertions) |
| `pnpm test:e2e` | Production build with dummy Supabase URL + full Playwright suite |
| `pnpm audit:wiring` | Verifies FEATURE_MATRIX.md rows match code |
| `pnpm audit:routes` | Static route check + live crawl of every route for every role |
| `pnpm db:seed` | Interim DB: setup + migrations + seed |
| `pnpm preview` | Serve the production build locally |

## Testing

- **Unit** — `pnpm test` (Vitest, jsdom): schemas, API modules, hooks, components.
- **Database** — `pnpm test:db`: pgTAP-style assertions in `supabase/tests/`
  covering RLS per role, RPC guards, triggers, tenant isolation, append-only
  enforcement. This is where security is actually proven.
- **E2E** — `pnpm test:e2e`: Playwright against a production build with a dummy
  Supabase URL; `e2e/stub-backend.ts` serves deterministic canned responses.
  Live-backend specs are gated behind `E2E_LIVE_SUPABASE=1` and skipped otherwise.

## Project structure

```
src/
  api/            # Supabase data-access modules (Zod-validated, one per domain)
  components/     # Shared UI (layout, dialogs, tables, toasts)
  features/       # Feature slices: api-adjacent hooks + pages
    auth/ items/ suppliers/ stock/ purchasing/ recipes/ sales/
    counts/ dashboard/ reports/ admin/ pwa/ sync/ settings/ home/
  lib/            # Pure helpers (units, costing, csv, datetime, …)
  routes/         # Router, guards, role access map, nav
  schemas/        # Zod schemas shared by forms and API
  types/          # Generated Supabase types (database.ts)
supabase/
  migrations/     # Timestamped SQL — the only place schema changes
  tests/          # DB test suite (run via pnpm test:db)
  seed.sql        # Dev seed data
e2e/              # Playwright specs + stub-backend.ts
scripts/          # audit tooling, db setup, PWA service-worker plugin
docs/             # Build-loop prompt and notes
```

## Architecture highlights

- **Append-only ledger** — `stock_movements` rejects UPDATE/DELETE via trigger;
  receiving, sales, wastage, and count adjustments are all movements.
- **Database-enforced business rules** — PO status transitions, recipe unit
  guards, count status machine, over-sale flagging live in PostgreSQL, not just
  the UI.
- **SECURITY DEFINER RPCs** (`receive_goods`, `log_wastage`, `log_usage`,
  `record_sales`, `apply_stock_count`, …) enforce tenant and role internally.
- **Costs** — weighted-average `avg_unit_cost` per item, updated database-side
  on every receipt; recipe costs recompute live from it.
- **Offline** — service worker caches the app shell; the sync engine queues
  wastage/usage/receiving in localStorage and replays at-least-once on
  reconnect (entries are only removed after success; replay failures stay
  visible with retry/discard).

## Test users

Three fixed users, one per role (created by `pnpm db:seed`):

| Role | UUID | Suggested login email |
|---|---|---|
| owner | `11111111-1111-4111-8111-111111111111` | `owner@demo.local` |
| manager | `22222222-2222-4222-8222-222222222222` | `manager@demo.local` |
| staff | `33333333-3333-4333-333333333333` | `staff@demo.local` |

Real GoTrue users don't exist yet — the Supabase cloud project hasn't been
created (see Status). Until then, role-based UI development uses the test-only
`ri.mockRole` localStorage hook in `src/api/auth.ts` (set by Playwright
fixtures and `pnpm audit:routes`; never shipped to production). RLS stays the
real enforcement in the database.

## CSV import/export

Items and Suppliers pages (owner/manager) support **Export** (UTF-8 with BOM for
Excel) and **Import** (validate → preview → confirm; per-row error report;
downloadable template). Reports pages support CSV export of every tab.

## Status

All credential-independent work is complete and green: 744 unit tests, full DB
suite, e2e 258 passed / 0 failed, Lighthouse mobile 0.97, PWA 1.0.

Blocked on cloud credentials (Supabase project + Vercel): live auth E2E, user
management (invite/change role/deactivate), final security pass, full
regression, deployment, handover guides. See `BLOCKERS.md`.

State files are the source of truth between build runs: `ARCHITECTURE.md`
(stack, data model, decisions), `TASKS.md` (ordered task list), `PROGRESS.md`
(append-only run log), `BLOCKERS.md` (human-only inputs), `ROUTES.md` (every
route), `FEATURE_MATRIX.md` (screen → component → api → DB → test).

---

© 2026 Biswajit Dey. All rights reserved.
