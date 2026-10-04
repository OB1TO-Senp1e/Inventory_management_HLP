# BLOCKERS.md — Human-only resolutions

> Each entry: what is needed, from whom, what is blocked, workaround used.
> The loop writes here and stops when a human input is required. Never guess on these.

## B-001 — Project kickoff inputs (open)

- **Needed from:** owner (you)
- **What:** Restaurant name and logo file; brand colours (or approve a neutral default); current item/ingredient list (CSV or spreadsheet); supplier list with contacts; units used in the kitchen (e.g. kg, g, L, ml, pcs); Supabase project URL + anon key (and who creates the cloud project, Singapore or Mumbai region); Vercel account/project for hosting.
- **Blocks:** P0-02 (Supabase cloud project), P0-05 (branding/theme), P0-07 (realistic seed data), P6-06 (deployment).
- **Workaround:** Proceed with neutral default theme, local Supabase, and sample seed data until provided.

_(Add new blockers below, newest last. Mark resolved with date when cleared.)_

## B-003 — No runnable headless browser in this VM (open; P0-06 live crawl deferred to CI)

- **What:** `pnpm audit:routes` phase 2 (Playwright live crawl) and `pnpm test:e2e` need a Chromium binary. Five honest attempts made 2026-10-04: (1) `npx playwright install chromium` hung on an interactive prompt — killed; (2) piped non-interactive retry — download started, then TLS socket timeout after ~5 min; (3) `apt-get install -y chromium` — installs a snap shim, and snapd is unavailable in this VM; (4) second download retry — same TLS timeout; (5) direct `curl` of the browser zip from cdn.playwright.dev — the CDN 307-redirects to `playwright.download.prss.microsoft.com`, which the egress proxy refuses (`GatewayExceptionResponse`).
- **Blocks:** local live execution of the route crawl and e2e specs.
- **Workaround:** the audit scripts are complete and correct; the static phases gate locally (`audit:wiring` fully, `audit:routes` phase 1). The live crawl prints an explicit DEFERRED banner (never a fake pass) and runs for real in CI, where `AUDIT_ROUTES_REQUIRE_LIVE=1` turns a missing browser into a hard failure. `npx playwright test --list` verified the specs load (16 tests across mobile 390px + desktop 1280px).

## B-002 — `supabase start` cannot run in this VM (open; P0-02 blocked)

- **Status 2026-10-04:** user chose the Supabase cloud project path — awaiting project URL, anon key, and DB password. Plan: `supabase link`, verify connectivity, `pnpm gen:types` against cloud DB, then mark P0-02 DONE and continue to P0-03.
- **Interim workaround 2026-10-04:** user said "Complete the project first. .env can be configured later." Native local PostgreSQL 16 is used as interim verification DB: migrations applied via psql, RLS tested via the `request.jwt.claims` GUC, types via `supabase gen types --db-url`. RLS helpers read `current_setting('request.jwt.claims', true)` — the same mechanism Supabase's `auth.jwt()` uses — so migrations verify identically locally and on Supabase cloud. P0-02 stays BLOCKED per loop rules (its acceptance needs `supabase start`/cloud link); all migrations get re-verified against cloud on credential arrival.
- **Needed from:** human/infra — a dev environment where Docker bridge networking works (kernel with netfilter NAT modules), e.g. Docker Desktop or a standard cloud VM.
- **What:** `supabase start` needs the Docker daemon. Three honest attempts made 2026-10-04: (1) installed Docker 29.1.3 via apt (was missing) — OK; (2) started `dockerd` — fails: `failed to add jump rules to ipv4 NAT table … Extension addrtype revision 0 not supported, missing kernel module?`; (3) `modprobe xt_addrtype iptable_nat xt_MASQUERADE` — modules not shipped for this kernel (`7.0.0-39-generic`), cannot be fixed from inside the VM. Without kernel NAT, no port publishing is possible, so the local Supabase stack cannot serve host ports.
- **Blocks:** P0-02 acceptance (`supabase start` works; `pnpm gen:types` against the local DB). P0-03+ need the local DB to apply/test migrations and RLS.
- **Workaround:** All non-Docker P0-02 deliverables are committed (CLI project-local, `supabase/config.toml`, `gen:types` script, local-dev README). On any Docker-capable machine: `supabase start && pnpm gen:types` unblocks fully. CI (P0-06) can also run Supabase-dependent gates where Docker is available.
