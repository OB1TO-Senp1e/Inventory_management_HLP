# PROGRESS.md — Append-only run log

> One entry per run. Never rewrite history; append only.

## Run 0 — 2026-10-04 — Bootstrap

- What changed: Created repo skeleton and state files (ARCHITECTURE.md, TASKS.md, PROGRESS.md, BLOCKERS.md, ROUTES.md, FEATURE_MATRIX.md); stored loop prompt at docs/LOOP_PROMPT.md; initialised git repo. No application code (per Run 0 rules).
- Gates: n/a (bootstrap only)
- Decisions made: Single-restaurant v1; fixed stack as specified; ledger + RPC architecture; India locale defaults (INR, en-IN, Asia/Kolkata).
- Next task: P0-01 (Repo init)

## Run 1 — 2026-10-04 — P0-01 Repo init

- What changed: Scaffolded Vite + React 18.3 + TS strict app via pnpm. Added Tailwind 3.4 (+ shadcn/ui theme tokens, Button primitive, components.json), React Router 7, TanStack Query 5, React Hook Form + Zod, Recharts, lucide-react, Supabase JS client factory (src/lib/supabase.ts). ESLint 9 flat config (0 errors/0 warnings enforced) + Prettier. Scripts: dev, build, typecheck, lint, test (vitest), preview. .env.example with Supabase placeholders. Minimal starter UI (SetupStatus) + formatINR unit test. State files kept at repo root.
- Gates: typecheck ✅ lint ✅ (0 errors, 0 warnings) test ✅ (3 passed) build ✅
- Decisions made: React pinned to 18.3 (fixed stack; template defaulted to 19); TypeScript 5.7 (template's 6.x unsupported by tooling — dropped erasableSyntaxOnly); shadcn wired manually (no CLI) with one documented eslint-disable for buttonVariants; pnpm 9.12.0.
- Next task: P0-02 (Supabase project setup)

## Run 2 — 2026-10-04 — P0-02 Supabase project setup (BLOCKED)

- What changed: Installed Supabase CLI 2.119.0 project-local (`pnpm add -D supabase`); added `pnpm gen:types` script (`supabase gen types typescript --local > src/types/database.ts`); created `supabase/config.toml` (project_id `restaurant-inventory`, cloud-region note Singapore/Mumbai); `.gitkeep` in `supabase/migrations/`, `supabase/tests/`, `src/types/`; `.env.example` and README gained local-dev docs (supabase start/stop/status, gen:types, Studio URL, migration conventions).
- Gates: typecheck ✅ lint ✅ (0 errors, 0 warnings) test ✅ (3 passed) build ✅ — all runnable gates green. DB-dependent acceptance (`supabase start`, `gen:types` against local DB) not runnable here — see B-002.
- Decisions made: Local-first Supabase per B-001 workaround; CLI as devDependency (project-local, not global).
- Blockers: B-002 (new) — `supabase start` impossible in this VM: Docker 29.1.3 installs but `dockerd` fails, kernel `7.0.0-39-generic` lacks netfilter NAT modules (`xt_addrtype`, `iptable_nat`, `xt_MASQUERADE`); 3 honest attempts made. Needs a Docker-capable host.
- Next task: P0-02 stays BLOCKED until Docker works; P0-03 (core schema migration) is next in line — its migration SQL can be authored without a running DB if the loop owner chooses.

## Run 2b — 2026-10-04 — Decision: complete the project before Supabase credentials arrive

- User: "Complete the project first. .env can be configured later."
- Decision: continue the loop from P0-03 using native local PostgreSQL 16 as the interim verification DB (documented in B-002 and ARCHITECTURE.md). P0-02 remains BLOCKED per loop rules (its acceptance needs `supabase start`/cloud link). Anything needing GoTrue/cloud (auth e2e in P0-04, deploy in P6-06) gets deferred verification until credentials arrive; everything else proceeds with full gates.
- Next task: P0-03 (Core schema migration)

## Run 3 — 2026-10-04 — P0-03 Core schema migration

- What changed: `supabase/migrations/20261004151129_core_schema.sql` — restaurants, profiles (FK auth.users, role check owner/manager/staff), item_categories, storage_locations, units; every table has restaurant_id (except restaurants), created_at/created_by (no FK, audit only)/updated_at + set_updated_at() trigger; RLS enabled on all tables with tenant-isolation policies (all roles read own restaurant; master-data writes owner/manager; profile writes owner-only); helpers current_restaurant_id()/has_role() (SECURITY INVOKER, read request.jwt.claims GUC — Supabase-identical); indexes on all FKs; grants to authenticated. `scripts/interim-db-setup.sql` (INTERIM ONLY, never a migration: stub auth.users, anon/authenticated roles, root peer-auth role). `supabase/tests/p0_03_core_rls_test.sql` (30 assertions, single rolled-back transaction). `scripts/test-db.sh` + `pnpm test:db`. `gen:types:interim` script; generated `src/types/database.ts` (never hand-written).
- Gates: typecheck ✅ lint ✅ (0 errors, 0 warnings) test ✅ (3 passed) test:db ✅ (30 assertions) build ✅ — migration applies cleanly; RLS tests run as non-superuser `authenticated`
- Decisions made: CLI type-gen needs keyword/value --db-url over unix socket (URL form rejected); test files staged to /tmp via `install -m 644` (postgres OS user can't traverse /home/hatch; repo files are 660). Noted in ~/TOOLS.md.
- Next task: P0-04 (Auth)

## Run 4 — 2026-10-04 — P0-04a Auth UI + guards (no live GoTrue)

- What changed: `src/schemas/{role,auth}.ts` (Zod: role enum, sign-in/reset inputs); `src/api/auth.ts` — the only module touching supabase auth (`signIn`, `signOut`, `resetPassword`, `getSession`, `getCurrentProfile`, `onAuthStateChange`), Zod-validated inputs, typed outputs; `src/features/auth/` — `AuthProvider` (session restore via Supabase client persistence, profile/role load, error state for missing .env), `AuthContext`/`useAuth`, `LoginPage` (RHF+Zod, inline errors, disabled-while-submitting, error toast, `from`-destination redirect), `ResetPasswordPage` (success state + toast), `SignOutButton`, interim aria-live `Toast`; `src/routes/` — `ProtectedRoute` (→ /login preserving destination), `RoleGuard` (matrix enforcement, denied → /), `access.ts` route→roles map, `AuthLoading`; `AppRoutes` wires `/login` + `/reset-password` as public under `AuthProvider`. Tests: `src/api/auth.test.ts` (13), `src/routes/guards.test.tsx` (11), `src/features/auth/LoginPage.test.tsx` (4) — all with mocked client, zero network. ROUTES.md `/login`+`/reset-password` → DONE (e2e deferred to P0-04b); FEATURE_MATRIX.md auth rows added.
- Gates: typecheck ✅ lint ✅ (0 errors, 0 warnings) test ✅ (31 passed) build ✅
- Decisions made: jsdom + Testing Library added (justified in ARCHITECTURE.md §12); vitest `environment: jsdom` + setup file with per-test cleanup; jest-dom types via tsconfig `types`; interim Toast replaced by P0-05's toast system; `userRoleSchema` is the client role source of truth; live GoTrue e2e split to P0-04b (needs cloud credentials).
- Blockers: none new. B-002 still open (no Docker in VM; interim native PG16 in use); P0-04b waits on Supabase cloud credentials (B-001).
- Next task: P0-05 (AppShell)

## Run 5 — 2026-10-04 — P0-05 AppShell

- What changed: `src/components/layout/AppShell.tsx` (fixed sidebar on lg+, slide-over drawer + top bar on mobile, breadcrumbs, role badge, sign-out), `AppNav.tsx`, `Breadcrumbs.tsx`; `src/routes/nav.ts` (nav items derived from `routeAccess` — single source with guards); `src/components/toast/` (`ToastProvider`, `useToast`, `ToastContext`: aria-live polite, success/error variants, 5s auto-dismiss, stack cap 4) — replaced the interim auth Toast everywhere (LoginPage/ResetPasswordPage migrated, `features/auth/Toast.tsx` deleted); `src/components/ErrorBoundary.tsx` (per-section, keyed by path, retry + home link, zero logging); `src/components/NotFoundPage.tsx`; `src/components/PageHeader.tsx` (the one header pattern); `src/features/home/HomePage.tsx` (role-aware landing, section cards); `src/routes/index.tsx` rewired (public routes outside shell; protected layout with AppShell; every planned section registered with RoleGuard — unbuilt ones render the designed 404 until their feature task ships a page); `src/App.tsx` wraps everything in ToastProvider; deleted `src/components/SetupStatus.tsx`. ROUTES.md `*` → DONE; FEATURE_MATRIX.md shell rows added.
- Gates: typecheck ✅ lint ✅ (0 errors, 0 warnings) test ✅ (60 passed, 29 new) build ✅
- Decisions made: drawer over bottom nav (14 sections don't fit a bottom bar for all roles); nav+guards share `routeAccess`; unbuilt sections → honest 404 (no "coming soon" filler); neutral theme verified, B-001 branding still open.
- Manual checklist: no dead links (nav targets all resolve; unbuilt sections intentionally 404 until their task), no placeholder text; loading (AuthLoading), empty (HomePage), error (ErrorBoundary), success states all exist; role nav verified per role in tests (owner 15 items incl. Users/Audit Log, manager 13, staff 4); back/forward/deep links via react-router.
- Responsive: no headless browser in this VM (no chromium/playwright package) — verified via (1) jsdom assertions on breakpoint classes (`hidden lg:flex` sidebar, `lg:hidden` mobile bar/drawer, `max-w-[85vw]` drawer), (2) static scan: no fixed layout widths, `min-w-0`/`truncate`/`flex-wrap` on text containers, touch targets ≥44px. Full Playwright 360/768/1280 runs land in P0-06.
- Blockers: none new. B-001 (branding), B-002 (Docker) still open.
- Next task: P0-06 (Audit tooling)

## Run 6 — 2026-10-04 — P0-06 Audit tooling

- What changed:
  - `scripts/audit-wiring.ts` (new, via `pnpm audit:wiring`): static audit parsing FEATURE_MATRIX.md — no empty cells ("—" is the documented N/A marker), every `src/api/*` export referenced by non-test code, every DB object exists in migrations/generated types AND is consumed by `src/api/`, matrix api names are real exports, matrix component paths/test files exist, heuristic `<button>`/`<form>` handler scan (`onClick` or `type="submit"`; `onSubmit`; no `<a href="#">`). Heuristics documented in the file header. Exits non-zero listing violations.
  - `scripts/audit-routes.ts` (new, via `pnpm audit:routes`): phase 1 static (ROUTES.md ↔ `routeAccess` ↔ nav ↔ in-code `to=`/`navigate()`/`<a href>` targets ↔ DONE components exist; `:param` segments match any value) always gates; phase 2 Playwright live crawl per role (owner/manager/staff mocked sessions + public visitor) checks HTTP 2xx, non-blank body, no console errors, no failed requests, role-correct outcomes (allowed→page, denied→"/", signed-out→/login), and rendered `<a href>` targets. Requires `pnpm build` first; serves via `vite preview` on :4173 (SPA fallback verified).
  - Test-only `ri.mockRole` localStorage hook in `src/api/auth.ts` (+ 3 unit tests): `getSession()`/`getCurrentProfile()` synthesize session/profile with zero network when set; only ever set by Playwright fixtures/audit via `addInitScript`. RLS stays the real enforcement.
  - `playwright.config.ts` (mobile 390px + desktop 1280px projects), `e2e/fixtures.ts` (role option fixture), `e2e/smoke.spec.ts` (8 specs: login render, /login redirect, 404, role nav/guard behavior — 16 runs across projects; `playwright test --list` verified).
  - `.github/workflows/ci.yml`: install → typecheck → lint → test → test:db (postgres:16 service; `scripts/test-db.sh` now honors PGHOST/PGUSER/PGPASSWORD/PGDATABASE for TCP, keeps peer-auth locally) → build → audit:wiring → playwright install → audit:routes with AUDIT_ROUTES_REQUIRE_LIVE=1 → test:e2e.
  - `src/routes/access.ts`: registered `/items/:id`, `/purchase-orders/:id`, `/stock-counts/:id` (were documented in ROUTES.md but unregistered — genuine gap found by the new audit, fixed rather than weakening the check).
  - `ROUTES.md`: added missing `/` (HomePage) row; `*` row e2e spec → `e2e/smoke.spec.ts`.
  - `tsconfig.e2e.json` (new; bundler resolution for specs), `vite.config.ts` excludes `e2e/` from vitest, eslint override disabling react-hooks rules for e2e/scripts (Playwright fixture `use` false-positive).
  - package.json scripts: `audit:routes`, `audit:wiring`, `test:e2e`; typecheck/build now cover all three tsconfigs.
- Gates: typecheck ✅ (app+node+e2e) · lint ✅ (0 errors, 0 warnings) · test ✅ (12 files, 63 passed) · test:db ✅ · build ✅ · audit:wiring ✅ (green, fully static) · audit:routes static ✅ (21 routes, 20 registered); live crawl DEFERRED (see below — explicit banner, never a fake pass).
- Negative-test evidence (acceptance): (1) temp unused export `__wiringAuditProbeUnused` in src/api/auth.ts → `audit:wiring` FAILED listing it; (2) temp matrix row with empty api cell → FAILED (`empty "api function" cell` + missing test file); (3) temp `/ghost-route` row in ROUTES.md → `audit:routes` FAILED (`"/ghost-route" is not registered in src/routes/access.ts`). All gaps removed afterwards; both audits green again.
- Decisions made: static phases always gate locally; live crawl deferred locally but hard-required in CI (AUDIT_ROUTES_REQUIRE_LIVE=1); `tsx` + `@playwright/test` justified in ARCHITECTURE.md §12; `AUDIT_ROUTES_CHROMIUM_PATH` env lets the script use a system chromium where Playwright's download is unavailable.
- Blockers: B-003 (new) — no runnable headless browser in this VM after 5 honest attempts: `npx playwright install chromium` hung on a prompt / then TLS-timed-out twice (~5 min each) via the egress proxy; `apt-get install chromium` yields a snap shim (no snapd); direct curl of the browser zip hits the proxy's `GatewayExceptionResponse` (CDN 307-redirects to playwright.download.prss.microsoft.com, unreachable). Live crawl + `test:e2e` run for real in CI instead.
- Next task: P0-07 (Seed data and test users)

## Run 7 — 2026-10-04 — P0-07 Seed data and test users

- What changed: `supabase/seed.sql` (new, DEV ONLY, idempotent via `ON CONFLICT DO NOTHING`) — 1 restaurant ("Demo Restaurant", fixed UUID), 3 profiles (owner/manager/staff, fixed UUIDs), 7 item categories (Vegetables, Dairy, Spices & Masalas, Grains & Pulses, Meat & Poultry, Beverages, Packaging & Housekeeping), 4 storage locations (Dry Store, Cold Room, Freezer, Kitchen Counter), 5 units (kg, g, L, ml, pcs); self-checking DO block raises on missing rows. Stub `auth.users` rows for the 3 profile UUIDs added to `scripts/interim-db-setup.sql` (interim-only section — seed.sql stays auth-schema-free for Supabase cloud). `scripts/db-seed.sh` + `pnpm db:seed` (same /tmp-staging and PGHOST/peer-auth conventions as `test-db.sh`). README: new "Seed data" + "Test users" sections (roles, fixed UUIDs, suggested login emails, role-matrix link, honest note that real GoTrue passwords arrive with B-001; `ri.mockRole` hook for role-based UI dev until then). ARCHITECTURE.md decisions log updated.
- Gates: typecheck ✅ lint ✅ (0 errors, 0 warnings) test ✅ (63 passed) test:db ✅ (30 assertions) build ✅ + seed loads cleanly into interim DB (1 restaurant, 3 profiles / 3 distinct roles, 7 categories, 4 locations, 5 units) and re-runs idempotently.
- Decisions made: fixed UUIDs (documented, matchable by future GoTrue users and e2e fixtures); `created_by` seeded as the owner UUID (audit metadata, no FK); neutral sample data per B-001 workaround.
- Next task: P1-01 (Items: schema, CRUD UI, categories, units, par and reorder levels, archive)
