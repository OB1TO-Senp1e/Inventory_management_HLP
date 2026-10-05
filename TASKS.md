# TASKS.md — Ordered task list

> One line per task: `- [STATUS] ID | Title | depends: <ids> | acceptance: <short testable criteria>`
> Statuses: TODO, IN_PROGRESS, DONE, BLOCKED. One task per run: first TODO whose dependencies are DONE.

## Phase 0 — Foundation

- [DONE] P0-01 | Repo init: Vite + React + TS strict, Tailwind, shadcn/ui, ESLint, Prettier, pnpm scripts, .env.example | depends: — | acceptance: pnpm install && pnpm typecheck && pnpm lint && pnpm build all pass on fresh clone
- [BLOCKED] P0-02 | Supabase project setup: CLI config, migrations folder, type generation script, local dev README | depends: P0-01 | acceptance: supabase start works locally; pnpm gen:types produces src/types/database.ts; README documents local dev
- [DONE] P0-03 | Core schema migration: restaurants, profiles (role), categories, storage locations, units + RLS helpers | depends: P0-02 | acceptance: migration applies cleanly; current_restaurant_id() and has_role() work; RLS denies cross-restaurant reads (db test)
- [DONE] P0-04a | Auth UI + guards (no live GoTrue): sign in/out/reset screens, session persistence wiring, protected routes, role guard | depends: P0-03 | acceptance: guard unit tests pass; protected routes redirect with mocked session; role guard enforces matrix; typecheck/lint/test/build green
- [TODO] P0-04b | Live auth e2e against Supabase cloud (deferred until credentials) | depends: P0-02 | acceptance: sign in/out/reset flows pass on 390px+1280px against real GoTrue; unauthenticated route redirects
- [DONE] P0-05 | AppShell: responsive layout, navigation per role, breadcrumbs, toast system, error boundary, 404 page, theme tokens | depends: P0-04a | acceptance: nav renders per role; 404 page shows on unknown route; no overflow at 360/768/1280
- [DONE] P0-06 | Audit tooling: audit-routes.ts, audit-wiring.ts, Playwright config with 3 role fixtures, CI workflow | depends: P0-05 | acceptance: pnpm audit:routes and pnpm audit:wiring run and fail correctly on a deliberate gap; CI runs all gates
- [DONE] P0-07 | Seed data and test users (one per role) | depends: P0-03 | acceptance: seed.sql loads 1 restaurant, 3 users (owner/manager/staff), sample categories/locations/units; dev login documented

## Phase 1 — Items and suppliers

- [DONE] P1-01 | Items: schema, CRUD UI, categories, units, par and reorder levels, archive | depends: P0-07 | acceptance: create/edit/archive item with validation; list has search/filter/sort/pagination/empty states; RLS per role tested
- [DONE] P1-02 | Storage locations and categories management screens | depends: P1-01 | acceptance: CRUD for locations/categories; item form dropdowns reflect changes; delete blocked when in use (or archived)
- [DONE] P1-03 | Suppliers: schema, CRUD UI, contact details | depends: P0-07 | acceptance: supplier CRUD with validation; list search/filter; archived suppliers hidden from PO prefill
- [DONE] P1-04 | Supplier price list per item (with price history table) | depends: P1-01, P1-03 | acceptance: set price per item/supplier; history shows every change with date; preferred supplier flagged
- [DONE] P1-05 | CSV import/export for items and suppliers with validation preview and error report | depends: P1-01, P1-03 | acceptance: import CSV previews row errors before commit; export downloads valid CSV; malformed file shows useful errors

## Phase 2 — Stock ledger

- [DONE] P2-01 | stock_movements schema, append-only enforcement, current_stock view, opening balance entry | depends: P1-01 | acceptance: UPDATE/DELETE on movements rejected (trigger+policy test); current_stock sums correctly; opening balance posts via RPC
- [DONE] P2-02 | RPC receive_goods (batch, expiry, cost, weighted average) + receiving UI (ad hoc) | depends: P2-01 | acceptance: ad hoc receipt posts ledger rows, updates avg cost, shows batch/expiry; e2e receipt flow passes both viewports
- [DONE] P2-03 | RPC log_wastage / log_usage with reason codes + UI | depends: P2-01 | acceptance: wastage/usage with reason code posts movement; staff can log; invalid qty rejected; reason required
- [DONE] P2-04 | Item detail page: stock level, ledger history, batches, expiry | depends: P2-02, P2-03 | acceptance: detail shows live stock, paginated ledger, batch/expiry list; realtime update on new movement
- [DONE] P2-05 | Stock overview screen: filter by category/location/low/expiring, realtime updates | depends: P2-04 | acceptance: filters combine correctly; low/expiring badges; realtime insert updates list without refresh

## Phase 3 — Purchasing

- [DONE] P3-01 | Purchase orders: schema, create/edit draft, line items, supplier prefill from price list | depends: P1-04, P2-01 | acceptance: draft PO with lines created; supplier prefill pulls latest price; totals in ₹ en-IN
- [DONE] P3-02 | PO lifecycle: send, partial receive, full receive via receive_goods, cancel | depends: P3-01, P2-02 | acceptance: status transitions draft→sent→partially_received→received→cancelled enforced; partial receive updates remaining qty
- [DONE] P3-03 | Reorder suggestions: items at/below reorder point grouped by preferred supplier, one-click draft PO | depends: P3-01, P2-05 | acceptance: suggestions list matches low-stock items; one click creates draft PO per supplier with correct lines
- [DONE] P3-04 | PO print/PDF view | depends: P3-02 | acceptance: print view renders PO with totals/GST; browser print produces clean single-doc output

## Phase 4 — Recipes, costing, sales

- [DONE] P4-01 | Menu items and recipes: schema, builder UI, yield, unit conversion | depends: P1-01 | acceptance: recipe builder adds ingredients with qty/unit; yield set; unit conversion validated and tested
- [DONE] P4-02 | Recipe costing: live cost per dish, food-cost %, selling price field | depends: P4-01, P2-02 | acceptance: cost per dish updates as ingredient costs change; food-cost % = cost/price; en-IN ₹ formatting
- [DONE] P4-03 | RPC record_sales deducting stock via recipes + sales entry UI (per dish, per day) | depends: P4-01, P2-01 | acceptance: sales entry posts sale_deduction movements per ingredient; daily entry aggregates; e2e passes
- [DONE] P4-04 | Insufficient stock handling on sale deduction (warn, allow with negative flag, audit) | depends: P4-03 | acceptance: selling beyond stock shows warning, allows with explicit confirm, flags movement and audit log entry

## Phase 5 — Counts and reporting

- [DONE] P5-01 | Stock counts: create, count sheet UI (mobile-optimised), save progress | depends: P2-05 | acceptance: count created and assigned; mobile sheet saves progress offline-tolerant; progress visible to manager
- [DONE] P5-02 | Variance review and approval → RPC apply_stock_count posts adjustments | depends: P5-01, P2-01 | acceptance: variance = counted − expected shown; approve posts count_adjustment movements; staff cannot approve
- [DONE] P5-03 | Dashboard: low stock, expiring soon, today's usage and wastage, stock value (owner/manager) | depends: P2-05, P2-03 | acceptance: dashboard cards match underlying queries; staff sees no costs; loads < 2s on seeded data
- [DONE] P5-04 | Reports: usage, wastage by reason, food cost trend, supplier price changes; date filters; CSV export | depends: P4-02, P2-03 | acceptance: each report filters by date; CSV export downloads; charts render with empty state
- [DONE] P5-05 | Audit log screen (owner only) | depends: P0-04a | acceptance: sensitive actions listed with actor/time; staff/manager blocked by RLS; filter by action/date
- [TODO] P5-06 | User management (owner): invite, change role, deactivate | depends: P0-04b | acceptance: owner invites/changes role/deactivates; deactivated user cannot sign in; audit entry written

## Phase 6 — Production hardening

- [x] P6-01 | PWA: manifest, icons, service worker, install prompt, offline shell | depends: P0-05 | acceptance: Lighthouse PWA checks pass; install prompt works; offline shell loads cached app shell
- [x] P6-02 | Offline queue for wastage/usage/receiving with conflict-safe sync and visible sync status | depends: P6-01, P2-02, P2-03 | acceptance: actions queued offline sync on reconnect; conflicts resolved safely; sync status visible
- [x] P6-03 | Performance pass: indexes review, query review, bundle splitting, Lighthouse ≥ 90 on mobile | depends: P5-04 | acceptance: Lighthouse mobile ≥ 90; slow queries have indexes; bundle split verified in build output
- [TODO] P6-04 | Security pass: RLS review for every table and RPC, input validation, rate limiting on edge functions, dependency audit | depends: P5-06 | acceptance: RLS matrix re-tested for all roles; pnpm audit clean or documented; validation fuzz passes
- [TODO] P6-05 | Full regression: every route, every role, every flow, on mobile and desktop | depends: P6-04 | acceptance: all route + wiring audits green; e2e suite passes on 390px and 1280px for all roles
- [TODO] P6-06 | Deployment: Vercel project, Supabase production project, env config, migration runbook, backup policy, README | depends: P6-05 | acceptance: production URL live; migrations runbook executed once cleanly; README covers setup+deploy+rollback
- [TODO] P6-07 | Handover: user guide per role (short, with screenshots), admin guide, known limitations | depends: P6-06 | acceptance: guides exist in docs/ per role; screenshots current; limitations listed honestly

## Phase 7 — V2 features (no cloud credentials required)

- [DONE] V2-01 | Barcode scanning on receiving & stock counts | depends: P2-02, P5-01 | acceptance: items have optional unique-per-restaurant barcode; camera scan resolves item on /receiving and count sheet; manual entry fallback; UI polished; e2e passes
- [DONE] V2-02 | Menu engineering report | depends: P4-02, P5-04 | acceptance: dish profitability stars/dogs from recipe cost + sales; report tab with chart + empty state; UI polished; e2e passes
- [DONE] V2-03 | Smart alerts: low-stock & expiry notifications | depends: P2-05 | acceptance: manager/owner get low-stock and expiring-soon alerts (in-app + local push when app open); alert preferences; UI polished; e2e passes
- [DONE] V2-04 | Invoice photo capture → draft receipt | depends: P2-02 | acceptance: photo of supplier bill OCRs into draft receipt lines; review/edit before posting; UI polished; e2e passes

## Phase 8 — V2 features (need external accounts)

- [DONE] V2-05 | Send POs via WhatsApp/email | depends: P3-02 | acceptance: PO sent to supplier via pluggable provider; stub provider for tests; live send needs WhatsApp/email account; UI polished; e2e passes
- [DONE] V2-06 | POS integration: sales auto-import | depends: P4-03 | acceptance: sales import from POS provider into record_sales flow; pluggable provider; live import needs POS credentials; UI polished; e2e passes
- [TODO] V2-07 | Multi-outlet support | depends: P2-05 | acceptance: outlets under restaurant; outlet-scoped stock; inter-outlet transfers post movements; UI polished; e2e passes
