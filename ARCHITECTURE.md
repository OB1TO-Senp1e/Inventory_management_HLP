# ARCHITECTURE.md — Restaurant Inventory App

> Maintained by the build loop. Record lasting decisions here. The repository is the memory between runs.

## 1. Product summary

Web-hosted PWA for a single restaurant (phone, tablet, desktop) for kitchen staff, managers, owner.
Answers: what is in stock, what was used/wasted, what must be ordered.

**Locale defaults:** India — currency INR (₹), `en-IN` number formatting, timezone `Asia/Kolkata`, optional GST fields on purchases.

## 2. Fixed stack (do not substitute without writing to BLOCKERS.md)

- **Frontend:** React 18 + TypeScript (strict) + Vite, Tailwind CSS, shadcn/ui, React Router, TanStack Query, React Hook Form + Zod, Recharts, lucide-react
- **Backend:** Supabase — PostgreSQL, Auth, Row Level Security, Realtime, Edge Functions. Schema managed **only** through SQL migrations in `supabase/migrations/`
- **Atomic business logic** (receiving, wastage, counts, sales deduction) lives in **Postgres functions (RPC)**, not client code
- **Types:** generated from DB (`supabase gen types typescript`) + Zod schemas in `src/schemas/`. No hand-written duplicates of DB types
- **Tests:** Vitest (unit), Playwright (e2e), pgTAP or SQL test scripts for RPCs and RLS
- **Hosting:** Vercel (frontend), Supabase Cloud (backend, Singapore or Mumbai region)
- **Package manager:** pnpm

## 3. Repository layout

```
/
├─ ARCHITECTURE.md      # decisions, data model, conventions (this file)
├─ TASKS.md             # ordered task list with status
├─ PROGRESS.md          # append-only run log
├─ BLOCKERS.md          # human-only resolutions
├─ ROUTES.md            # every route, component, role access, status
├─ FEATURE_MATRIX.md    # screen → component → api fn → DB object → test
├─ docs/LOOP_PROMPT.md  # the autonomous build loop prompt (source of truth for process)
├─ supabase/
│  ├─ migrations/       # ONLY place schema changes live (timestamped SQL)
│  ├─ seed.sql          # dev-only seed data, never migrations
│  └─ tests/            # pgTAP / SQL tests for RPCs and RLS
├─ scripts/
│  ├─ audit-routes.ts   # crawls ROUTES.md per role (built in P0-06)
│  └─ audit-wiring.ts   # parses FEATURE_MATRIX.md vs code (built in P0-06)
├─ e2e/                 # Playwright specs (mobile 390px + desktop 1280px)
└─ src/
   ├─ api/              # ONLY place that imports the Supabase client
   ├─ components/ui/    # shadcn primitives
   ├─ components/       # shared composed components
   ├─ features/<module>/# pages, hooks, forms per module
   ├─ lib/              # supabase client, formatting, utils
   ├─ hooks/            # shared hooks
   ├─ schemas/          # Zod schemas (mirrors DB types, no duplication)
   ├─ routes/           # route definitions, guards
   └─ main.tsx
```

## 4. Data-flow diagram (text)

```
User (phone/tablet/desktop)
  │  React 18 + Router + TanStack Query + RHF/Zod
  ▼
src/features/<module>/ pages & components
  │  never import supabase directly
  ▼
src/api/<module>.ts  (Zod-validated inputs → typed outputs)
  │  single Supabase client from src/lib/
  ▼
Supabase:  Auth (JWT, role in profiles)
           ├─► RLS policies (per table, per role)
           ├─► RPCs (SECURITY INVOKER): receive_goods, log_wastage,
           │      log_usage, record_sales, apply_stock_count
           └─► Views: current_stock (SUM of ledger)
PostgreSQL ledger (stock_movements, append-only)
  │  Realtime → TanStack Query invalidation → UI refresh
  ▼
Reports / Dashboard (Recharts), CSV import/export
```

All writes that change stock go through RPCs. The client never computes stock; it reads `current_stock` view and the ledger history.

## 5. The ledger principle

- `stock_movements` is **append-only**: no UPDATE/DELETE (enforced by RLS policy + trigger).
- Current stock = `SUM(quantity)` over movements per `(restaurant_id, item_id)`, exposed via `current_stock` view.
- Corrections are **new movements** (e.g. `count_adjustment`), never edits.
- Movement types: `receipt`, `usage`, `sale_deduction`, `wastage`, `count_adjustment`, `transfer_in`, `transfer_out`, `opening_balance`.
- Quantities stored in the item's **base unit**; conversions explicit and tested.
- Costing: **weighted average cost**, recalculated on receipt inside the RPC.
- Money/quantities: `numeric`, never float. `CHECK (qty > 0)` where relevant.
- Every table: `restaurant_id`, `created_at`, `created_by`, `updated_at`. RLS on every table, no exceptions.

## 6. Naming conventions

- **DB:** snake_case tables/columns. Tables plural (`items`, `suppliers`, `purchase_orders`, `stock_movements`). RPCs snake_case verbs (`receive_goods`, `log_wastage`, `record_sales`, `apply_stock_count`). Views prefixed descriptively (`current_stock`, `low_stock_alerts`).
- **Migrations:** `supabase/migrations/YYYYMMDDHHMMSS_<slug>.sql`, one concern per file, never edit a merged migration — new migration to fix.
- **Frontend:** `src/features/<module>/` kebab-case folders; components PascalCase one-per-file; hooks `useX`; api fns camelCase (`listItems`, `receiveGoods`); Zod schemas `<Name>Schema` in `src/schemas/`.
- **Routes:** kebab-case paths (`/items`, `/purchase-orders`, `/stock-counts/:id`). Route ids match TASKS.md module slugs.
- **Tests:** `*.test.ts` (Vitest) next to code; `e2e/<module>.spec.ts` (Playwright); `supabase/tests/<rpc>_test.sql`.

## 7. Role matrix

| Capability                            | owner | manager           | staff                      |
| ------------------------------------- | ----- | ----------------- | -------------------------- |
| User management                       | ✅    | ❌                | ❌                         |
| Audit log / reports / costs           | ✅    | ✅ (no user mgmt) | ❌ (no costs, no reports)  |
| Items, suppliers, price lists         | ✅    | ✅                | ❌                         |
| Purchase orders (create/send/receive) | ✅    | ✅                | ❌                         |
| Receive stock (ad hoc + against PO)   | ✅    | ✅                | ✅                         |
| Log usage / wastage                   | ✅    | ✅                | ✅                         |
| Recipes & menu items                  | ✅    | ✅                | ❌                         |
| Sales entry                           | ✅    | ✅                | ❌                         |
| Stock counts (perform assigned)       | ✅    | ✅                | ✅ (assigned only)         |
| Approve count adjustments             | ✅    | ✅                | ❌                         |
| Dashboard & reports                   | ✅    | ✅                | ❌ (limited ops view only) |
| CSV import/export                     | ✅    | ✅                | ❌                         |

Enforcement: **RLS is the authority**. UI hides disallowed actions per role, but every table/RPC has role-keyed policies tested for all three roles.

Helper functions (P0-03): `current_restaurant_id()`, `has_role(required)`.

## 8. Planned RPCs (atomic, tested, SECURITY INVOKER unless documented)

1. `receive_goods(p_po_id, p_lines jsonb)` — inserts receipt movements with batch/expiry/unit-cost, recalculates weighted avg cost, transitions PO status (partially_received / received). Idempotent via client-supplied idempotency key.
2. `log_wastage(p_item_id, p_qty, p_reason, p_note)` / `log_usage(...)` — validates qty > 0, base-unit conversion, inserts movement.
3. `record_sales(p_lines jsonb)` — explodes recipes → ingredient deductions as `sale_deduction` movements; handles insufficient stock per policy (warn + allow with negative flag + audit).
4. `apply_stock_count(p_count_id)` — posts `count_adjustment` movements for approved variances; only owner/manager.
5. `create_opening_balance(p_item_id, p_qty, p_unit_cost)` — one-time `opening_balance` movement.

Views: `current_stock`, `low_stock_alerts` (≤ reorder point), `expiring_soon` (batches by expiry), `stock_valuation` (qty × avg cost, owner/manager only).

## 9. Frontend conventions

- Only `src/api/` imports the Supabase client.
- Lists: search, filter, sort, pagination, empty/skeleton/error-with-retry states.
- Forms: Zod + RHF, inline errors, disabled-while-submitting, toasts, unsaved-changes guard.
- Destructive actions: confirmation dialog; prefer soft delete (`active=false` / `archived_at`).
- Layout: single `AppShell` (sidebar desktop, bottom nav/drawer mobile), one page-header pattern, one spacing scale.
- Responsive: mobile-first 360px, verify 768px & 1280px. Touch targets ≥ 44px. No horizontal scroll.
- a11y: labels, focus states, keyboard-navigable dialogs, `aria-live` toasts, contrast.
- Numbers: `en-IN` formatting, ₹, units always beside quantities.

## 10. Code quality & gates

- TS strict, no `any`, no `@ts-ignore` without comment. No `console.log`, no commented-out code, no `TODO` in code (defer → TASKS.md).
- No new dependency without one-line justification here.
- Quality gates per task (see LOOP_PROMPT §5): typecheck, lint, unit, db tests, build, route audit, wiring audit, e2e (390px + 1280px), manual checklist.

## 11. Decisions log

- 2026-10-04 (Run 0): Fixed stack adopted as specified. Single-restaurant v1; no POS/barcode/multi-outlet. Ledger + RPC architecture chosen for auditability. Locale India defaults.
- 2026-10-04: Interim dev DB = native local PostgreSQL 16 (Docker unavailable in this VM; Supabase local stack can't run). RLS helpers (`current_restaurant_id()`, `has_role()`) read `current_setting('request.jwt.claims', true)` — the same mechanism Supabase uses to populate `auth.jwt()` — so migrations and RLS verify identically locally and on Supabase cloud. Interim-only scaffolding (stub `auth.users`) lives in `scripts/interim-db-setup.sql`, never in migrations. User authorized completing the project before Supabase credentials arrive (".env can be configured later"); re-verify all migrations against cloud on credential arrival.
- 2026-10-04 (Run 1 / P0-01): React pinned to 18.3 (template defaulted to 19); TypeScript 5.7 (dropped `erasableSyntaxOnly`, a 5.8+ option); shadcn/ui wired manually without CLI; ESLint 9 flat config with `--max-warnings 0`; pnpm 9.12.0. All deps are fixed-stack items — no new dependency justifications needed.
- 2026-10-04 (Run 3 / P0-03): `pnpm test:db` runs `supabase/tests/*.sql` against the interim DB (fails non-zero on error); `gen:types:interim` generates `src/types/database.ts` via the project-local CLI over unix-socket peer auth (`--db-url` keyword/value form — the CLI rejects the URL form for sockets). DB types are never hand-written.
- 2026-10-04 (Run 4 / P0-04a): Auth UI + guards with no live GoTrue. `src/api/auth.ts` is the only module touching `supabase.auth`/`profiles`; session persistence stays in the Supabase client, mirrored into React state by `AuthProvider`. Role guard enforces the §7 matrix via `src/routes/access.ts` (mirrors ROUTES.md); denied roles redirect to `/`, which P0-05 turns into a role-aware landing. `features/auth/Toast.tsx` is an interim aria-live toast — the app-wide toast system lands in P0-05 and replaces it. Live GoTrue e2e split out as P0-04b (needs cloud credentials). `userRoleSchema` (Zod enum) is the client source of truth for roles; generated DB type is a plain string, so no duplication.
- 2026-10-04 (Run 5 / P0-05): AppShell — mobile uses a slide-over drawer (not bottom nav) so all 14 planned sections work uniformly for every role; nav derived from `routeAccess` (single source shared with RoleGuard, can't drift); per-section ErrorBoundary keyed by path (remount clears errors on navigation); planned-but-unbuilt sections render the designed 404 until their feature task swaps in a real page; interim auth Toast replaced by app-wide ToastProvider (aria-live polite, 5s auto-dismiss, stack cap 4); neutral shadcn theme tokens verified (B-001 branding still open); responsive verified via breakpoint-class assertions + static overflow scan (no headless browser in this VM — full Playwright viewport runs land in P0-06).
- 2026-10-04 (Run 6 / P0-06): Audit tooling. `audit:wiring` is pure static analysis (matrix↔code↔DB↔tests + button/form handler scan) and runs green locally. `audit:routes` has a static phase (ROUTES.md ↔ routeAccess ↔ nav ↔ in-code link targets ↔ DONE components, always gating) plus a Playwright live crawl per role; the crawl needs a browser — deferred with an explicit banner when none is available, hard-required in CI via AUDIT_ROUTES_REQUIRE_LIVE=1. Test-only `ri.mockRole` localStorage hook in `src/api/auth.ts` lets fixtures/audit synthesize sessions with zero network (RLS stays the real enforcement). Detail routes (`/items/:id` etc.) registered in routeAccess so ROUTES.md ↔ router can't drift. e2e/ excluded from vitest (Playwright owns it); `tsconfig.e2e.json` uses bundler resolution for spec files. Browser situation: no runnable browser in this VM after 5 honest attempts (B-003); live crawl runs in CI instead.
- 2026-10-04 (Run 7 / P0-07): Seed data. `supabase/seed.sql` is dev-only, idempotent (`ON CONFLICT DO NOTHING`), and auth-schema-free so it runs unchanged on Supabase cloud. Fixed UUIDs for the demo restaurant + 3 role profiles (documented in README "Test users") so GoTrue users and e2e fixtures can match them later. Interim stub `auth.users` rows for those UUIDs live in `scripts/interim-db-setup.sql` (never in seed.sql, never in migrations). `pnpm db:seed` (`scripts/db-seed.sh`) applies the seed to the interim DB with the same /tmp-staging + PGHOST conventions as `test-db.sh`. Real login passwords/GoTrue users deferred to cloud credential arrival (B-001); until then role-based UI dev uses the test-only `ri.mockRole` hook.
- _(append new decisions here, newest last)_

## 12. Dependency justifications

- `@testing-library/react` + `@testing-library/jest-dom` + `jsdom` (dev): component unit tests for guards and auth forms — the standard Vitest companion for React 18 (added P0-04a).
- `tsx` (dev): runs the TypeScript audit scripts (`scripts/audit-routes.ts`, `scripts/audit-wiring.ts`) directly with no build step (added P0-06).
- `@playwright/test` (dev): end-to-end tests and the route audit's live browser crawl — mobile 390px + desktop 1280px projects per the quality gates (added P0-06).
