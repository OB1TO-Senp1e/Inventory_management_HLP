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
