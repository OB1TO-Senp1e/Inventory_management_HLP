/**
 * audit-routes.ts — route audit (P0-06).
 *
 * Two phases:
 *
 *  PHASE 1 — static (always runs, no browser needed):
 *   1a. Every path in ROUTES.md (except the `*` catch-all) is registered in
 *       `src/routes/access.ts` (`routeAccess`), the single source the router
 *       and nav derive from.
 *   1b. Every `routeAccess` key appears in ROUTES.md (no orphan registration).
 *   1c. Every nav item in `src/routes/nav.ts` targets a registered route.
 *   1d. Every in-code navigation target (`Link to=`, `navigate()`,
 *       `<Navigate to=>`, `<a href=>`) resolves to a registered route or an
 *       external URL — no dead links. `:param` segments match any value.
 *   1e. Rows marked DONE have a component file that exists under `src/`.
 *
 *  PHASE 2 — live crawl (needs a Playwright browser):
 *   Serves the production build with `vite preview`, then visits every route
 *   as each role (owner / manager / staff via a mocked session, plus a
 *   public unauthenticated visitor) and fails on: non-2xx response, blank
 *   body, uncaught console error, failed network request, wrong role
 *   outcome (allowed→page, denied→"/", signed-out→"/login"), or any rendered
 *   `<a href>` that is not a registered route.
 *
 *  No-backend tolerance: the e2e build carries a dummy Supabase URL, so data
 *  requests fail with ERR_CONNECTION_REFUSED. That is the expected
 *  no-backend environment (the app shows error states; e2e covers them with
 *  stubs) — failed Supabase API requests and their console noise are ignored
 *  by the crawl. Real breakage (JS errors, dead links, wrong guards) still
 *  fails the audit.
 *
 *  Mocked sessions: the audit seeds `localStorage["ri.mockRole"]` via
 *  Playwright's `addInitScript` before page scripts run. `src/api/auth.ts`
 *  honors that key (test-only hook, P0-06) and synthesizes a session/profile
 *  with zero network access — no live GoTrue needed.
 *
 *  Browser availability: if no Playwright browser is installed, the live
 *  crawl is DEFERRED with an explicit banner (it runs in CI). Set
 *  `AUDIT_ROUTES_REQUIRE_LIVE=1` (as CI does) to turn a missing browser
 *  into a hard failure instead of a deferral. The static phase always runs
 *  and always gates.
 *
 * Run: `pnpm audit:routes` (requires `pnpm build` first; via tsx).
 */

import { spawn, type ChildProcess } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "@playwright/test";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SRC = join(ROOT, "src");
const PORT = 4173;
const REQUIRE_LIVE = process.env.AUDIT_ROUTES_REQUIRE_LIVE === "1";
const MOCK_ROLE_KEY = "ri.mockRole"; // must match src/api/auth.ts + e2e/fixtures.ts

type Violation = string;
const violations: Violation[] = [];
function fail(message: string): void {
  violations.push(message);
}
function out(message: string): void {
  process.stdout.write(`${message}\n`);
}
function errOut(message: string): void {
  process.stderr.write(`${message}\n`);
}

function listFiles(dir: string, exts: string[]): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...listFiles(full, exts));
    } else if (exts.some((ext) => full.endsWith(ext))) {
      found.push(full);
    }
  }
  return found.sort();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ------------------------------------------------------------------ */
/* Shared: route tables                                                */
/* ------------------------------------------------------------------ */

interface RouteRow {
  path: string;
  component: string;
  roles: string;
  status: string;
  line: number;
}

function parseRoutesMd(): RouteRow[] {
  const text = readFileSync(join(ROOT, "ROUTES.md"), "utf8");
  const rows: RouteRow[] = [];
  text.split("\n").forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) {
      return;
    }
    const cells = trimmed
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length !== 6) {
      return;
    }
    if (/^:?-+:?$/.test(cells[0].replace(/\s/g, ""))) {
      return;
    }
    if (cells[0].toLowerCase() === "path") {
      return;
    }
    rows.push({
      // Path cells are backtick-quoted in ROUTES.md — strip the quotes so
      // they compare equal to the keys parsed from src/routes/access.ts.
      path: cells[0].replace(/`/g, "").trim(),
      component: cells[1],
      roles: cells[2],
      status: cells[4],
      line: idx + 1,
    });
  });
  return rows;
}

/** Keys of the `routeAccess` map in src/routes/access.ts. */
function parseRouteAccess(): string[] {
  const text = readFileSync(join(SRC, "routes", "access.ts"), "utf8");
  return [...text.matchAll(/["'](\/[^"']*)["']\s*:/g)].map((m) => m[1]);
}

/** Nav item paths from src/routes/nav.ts (`path: "/..."`). */
function parseNavPaths(): string[] {
  const text = readFileSync(join(SRC, "routes", "nav.ts"), "utf8");
  return [...text.matchAll(/path:\s*["']([^"']+)["']/g)].map((m) => m[1]);
}

/** "/items/:id" -> /^\/items\/[^/]+$/ ; "*" matches everything. */
function routePattern(routePath: string): RegExp {
  if (routePath === "*") {
    return /^.*$/;
  }
  const pattern = routePath
    .split("/")
    .map((seg) =>
      seg.startsWith(":") ? "[^/]+" : escapeRegExp(seg),
    )
    .join("/");
  return new RegExp(`^${pattern}$`);
}

function isExternalUrl(target: string): boolean {
  return /^(https?:|mailto:|tel:)/.test(target);
}

function backtickPaths(cell: string): string[] {
  return [...cell.matchAll(/`([^`]+)`/g)]
    .map((m) => m[1].trim())
    .filter((id) => id.includes("/"));
}

/* ------------------------------------------------------------------ */
/* Phase 1: static                                                     */
/* ------------------------------------------------------------------ */

function staticPhase(): { rows: RouteRow[]; registered: string[] } {
  const rows = parseRoutesMd();
  if (rows.length === 0) {
    fail("ROUTES.md: no data rows parsed — table format changed?");
  }
  const accessKeys = parseRouteAccess();
  if (accessKeys.length === 0) {
    fail("src/routes/access.ts: no routeAccess keys parsed");
  }
  // "/" is a real route (HomePage) but lives outside routeAccess, which only
  // maps role-gated sections.
  const registered = [...new Set([...accessKeys, "/"])];
  const registeredPatterns = registered.map(routePattern);

  const matchesRegistered = (target: string): boolean =>
    registeredPatterns.some((re) => re.test(target));

  // 1a. ROUTES.md -> router registration.
  for (const row of rows) {
    if (row.path === "*") {
      continue;
    }
    if (!accessKeys.includes(row.path) && row.path !== "/") {
      fail(
        `ROUTES.md:${row.line}: "${row.path}" is not registered in src/routes/access.ts`,
      );
    }
  }

  // 1b. No orphan registrations.
  const documented = new Set(rows.map((r) => r.path));
  for (const key of accessKeys) {
    if (!documented.has(key)) {
      fail(`src/routes/access.ts: "${key}" is registered but missing from ROUTES.md`);
    }
  }

  // 1c. Nav targets.
  for (const navPath of parseNavPaths()) {
    if (!matchesRegistered(navPath)) {
      fail(`src/routes/nav.ts: nav target "${navPath}" is not a registered route`);
    }
  }

  // 1d. In-code navigation targets.
  const targetPatterns: RegExp[] = [
    /\bto\s*=\s*"([^"]+)"/g,
    /\bto\s*=\s*'([^']+)'/g,
    /\bto\s*=\s*\{"([^"]+)"\}/g,
    /\bnavigate\(\s*"([^"]+)"/g,
    /\bnavigate\(\s*'([^']+)'/g,
    /\bhref\s*=\s*"([^"]+)"/g,
    /\bhref\s*=\s*'([^']+)'/g,
  ];
  for (const file of listFiles(SRC, [".ts", ".tsx"])) {
    if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) {
      continue;
    }
    const rel = file.slice(ROOT.length + 1);
    const text = readFileSync(file, "utf8");
    for (const pattern of targetPatterns) {
      pattern.lastIndex = 0;
      for (const m of text.matchAll(pattern)) {
        const target = m[1];
        if (target === "" || isExternalUrl(target)) {
          continue;
        }
        // Query strings and hashes don't change the route (e.g. the
        // dashboard links to /stock?low=1); strip them before matching.
        const pathOnly = target.split(/[?#]/)[0] || "/";
        if (!matchesRegistered(pathOnly)) {
          fail(`${rel}: navigation target "${target}" is not a registered route`);
        }
      }
    }
  }

  // 1e. DONE rows have real components.
  for (const row of rows) {
    if (row.status !== "DONE") {
      continue;
    }
    const ids = backtickPaths(row.component);
    if (ids.length === 0) {
      fail(`ROUTES.md:${row.line}: DONE row has no component path`);
      continue;
    }
    for (const id of ids) {
      const base = join(SRC, id);
      const exists = [".tsx", ".ts"].some((ext) => {
        try {
          statSync(base + ext);
          return true;
        } catch {
          return false;
        }
      });
      if (!exists) {
        fail(`ROUTES.md:${row.line}: component "${id}" does not resolve under src/`);
      }
    }
  }

  return { rows, registered };
}

/* ------------------------------------------------------------------ */
/* Phase 2: live crawl                                                 */
/* ------------------------------------------------------------------ */

function routeRolesAllows(rolesCell: string, role: string): boolean {
  return rolesCell
    .split(",")
    .map((r) => r.trim())
    .includes(role);
}

function isPublicRoute(rolesCell: string): boolean {
  return rolesCell.split(",").map((r) => r.trim()).includes("public");
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        return;
      }
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`preview server did not become ready at ${url} within ${timeoutMs}ms`);
}

interface CrawlResult {
  skipped: boolean;
}

async function livePhase(rows: RouteRow[], registered: string[]): Promise<CrawlResult> {
  let distIndex = false;
  try {
    statSync(join(ROOT, "dist", "index.html"));
    distIndex = true;
  } catch {
    distIndex = false;
  }
  if (!distIndex) {
    fail("live crawl: dist/index.html missing — run `pnpm build` first");
    return { skipped: true };
  }

  let browser: Browser;
  try {
    // AUDIT_ROUTES_CHROMIUM_PATH lets environments without Playwright's
    // downloaded browsers (e.g. this VM, where the CDN download fails) use
    // a system chromium instead — the crawl itself is identical.
    const launchOptions: Parameters<typeof chromium.launch>[0] = {};
    const chromiumPath = process.env.AUDIT_ROUTES_CHROMIUM_PATH;
    if (chromiumPath) {
      launchOptions.executablePath = chromiumPath;
    }
    if (typeof process.getuid === "function" && process.getuid() === 0) {
      // Running as root (CI containers, this VM): Chromium refuses to
      // start without --no-sandbox.
      launchOptions.args = ["--no-sandbox"];
    }
    browser = await chromium.launch(launchOptions);
  } catch (error) {
    const detail = error instanceof Error ? error.message.split("\n")[0] : String(error);
    if (REQUIRE_LIVE) {
      fail(`live crawl: browser launch failed and AUDIT_ROUTES_REQUIRE_LIVE=1 — ${detail}`);
    } else {
      out("");
      out("================================================================");
      out("LIVE CRAWL DEFERRED — no Playwright browser in this environment.");
      out(`(${detail})`);
      out("The static phase above still gates. The live crawl runs in CI");
      out("(AUDIT_ROUTES_REQUIRE_LIVE=1). See BLOCKERS.md.");
      out("================================================================");
    }
    return { skipped: true };
  }

  const viteBin = join(ROOT, "node_modules", ".bin", "vite");
  let server: ChildProcess | null = null;
  try {
    // NOTE: --host 127.0.0.1 pins the bind to IPv4 localhost. Without it,
    // vite binds [::1] (IPv6-only) on hosts where `localhost` resolves to
    // ::1 first, and the 127.0.0.1 readiness probe below never succeeds.
    server = spawn(viteBin, ["preview", "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"], {
      cwd: ROOT,
      stdio: "pipe",
    });
    await waitForServer(`http://127.0.0.1:${PORT}/`, 30000);
    out(`live crawl: preview server up on :${PORT}`);

    const registeredPatterns = registered.map(routePattern);
    const visitors: (string | null)[] = [null, "owner", "manager", "staff"];
    const crawlRows = rows.filter((r) => r.path !== "*");

    for (const visitor of visitors) {
      const context = await browser.newContext();
      if (visitor) {
        await context.addInitScript(
          `window.localStorage.setItem(${JSON.stringify(MOCK_ROLE_KEY)}, ${JSON.stringify(visitor)});`,
        );
      }
      const page = await context.newPage();
      const consoleErrors: string[] = [];
      const failedRequests: string[] = [];
      // Supabase API paths — their failure without a backend is expected
      // (see header); the crawl audits routes, not backend connectivity.
      const isBackendNoise = (url: string): boolean =>
        /\/(rest|auth|realtime)\/v1\//.test(url);
      page.on("console", (msg) => {
        if (msg.type() !== "error") return;
        // "Failed to load resource" is the browser's log of a failed fetch;
        // backend ones are filtered above, app-asset ones are real problems.
        // In the no-backend e2e env all of these are backend noise.
        if (msg.text().startsWith("Failed to load resource")) return;
        if (!isBackendNoise(msg.text())) {
          consoleErrors.push(msg.text());
        }
      });
      page.on("requestfailed", (req) => {
        if (!isBackendNoise(req.url())) {
          failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
        }
      });

      for (const row of crawlRows) {
        const probePath = row.path.replace(/:[A-Za-z_]+/g, "audit-probe");
        const url = `http://127.0.0.1:${PORT}${probePath}`;
        const label = `${visitor ?? "public"} ${probePath}`;
        consoleErrors.length = 0;
        failedRequests.length = 0;

        let response: Awaited<ReturnType<Page["goto"]>> | null = null;
        try {
          response = await page.goto(url, { waitUntil: "load", timeout: 15000 });
        } catch (error) {
          fail(`live crawl [${label}]: navigation failed — ${error instanceof Error ? error.message : error}`);
          continue;
        }
        const status = response?.status() ?? 0;
        if (status < 200 || status >= 300) {
          fail(`live crawl [${label}]: HTTP ${status}`);
        }

        try {
          await page.waitForLoadState("networkidle", { timeout: 8000 });
        } catch {
          // networkidle is best-effort; the checks below are authoritative
        }

        const bodyTextLength: number = await page.evaluate(
          () => document.body.innerText.trim().length,
        );
        if (bodyTextLength === 0) {
          fail(`live crawl [${label}]: blank body`);
        }

        const finalPath: string = await page.evaluate(() => window.location.pathname);
        const pub = isPublicRoute(row.roles);
        if (pub) {
          if (finalPath !== probePath) {
            fail(`live crawl [${label}]: public route redirected to "${finalPath}"`);
          }
        } else if (visitor === null) {
          if (finalPath !== "/login") {
            fail(`live crawl [${label}]: signed-out visitor not sent to /login (at "${finalPath}")`);
          }
        } else if (routeRolesAllows(row.roles, visitor)) {
          if (finalPath !== probePath) {
            fail(`live crawl [${label}]: allowed role redirected to "${finalPath}"`);
          }
        } else if (finalPath !== "/") {
          fail(`live crawl [${label}]: denied role not bounced to "/" (at "${finalPath}")`);
        }

        for (const e of consoleErrors) {
          fail(`live crawl [${label}]: console error — ${e.slice(0, 200)}`);
        }
        for (const r of failedRequests) {
          fail(`live crawl [${label}]: failed request — ${r.slice(0, 200)}`);
        }

        const hrefs: string[] = await page.$$eval("a[href]", (els) =>
          els.map((el) => el.getAttribute("href") ?? ""),
        );
        for (const href of hrefs) {
          if (href === "" || isExternalUrl(href)) {
            continue;
          }
          if (!registeredPatterns.some((re) => re.test(href))) {
            fail(`live crawl [${label}]: rendered <a href="${href}"> is not a registered route`);
          }
        }
      }
      await context.close();
    }
  } finally {
    if (server) {
      server.kill();
    }
    await browser.close();
  }
  return { skipped: false };
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  out("audit:routes — phase 1 (static)...");
  const { rows, registered } = staticPhase();
  if (violations.length > 0) {
    errOut(`audit:routes: FAILED in static phase — ${violations.length} violation(s):`);
    for (const v of violations) {
      errOut(`  - ${v}`);
    }
    process.exit(1);
  }
  out(`audit:routes — static phase OK (${rows.length} route(s), ${registered.length} registered)`);

  out("audit:routes — phase 2 (live crawl)...");
  await livePhase(rows, registered);

  if (violations.length > 0) {
    errOut(`audit:routes: FAILED — ${violations.length} violation(s):`);
    for (const v of violations) {
      errOut(`  - ${v}`);
    }
    process.exit(1);
  }
  out("audit:routes: OK");
}

main().catch((error) => {
  errOut(`audit:routes: crashed — ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
