/**
 * audit-wiring.ts — static wiring audit (P0-06).
 *
 * Parses FEATURE_MATRIX.md and the source tree, then fails (non-zero exit)
 * when the documented wiring has drifted from the code:
 *
 *  1. No matrix row may have an empty cell. A cell containing only an
 *     em-dash ("—", also accepts "–" / "-") is the documented convention for
 *     "not applicable" (e.g. client-only screens have no API function);
 *     truly empty cells fail.
 *  2. Every export of every `src/api/*.ts` module must be referenced by at
 *     least one other mention in non-test source (dead API surface fails).
 *     "Mention" is textual (word-boundary match), so type-only imports
 *     count; JSDoc prose mentioning the name also counts — see heuristics.
 *  3. Every DB object named in the matrix (backtick-quoted identifiers in the
 *     "DB object" column) must (a) exist — i.e. appear in a CREATE statement
 *     in `supabase/migrations/*.sql`, in the interim DB setup, or in the
 *     generated `src/types/database.ts` — and (b) be consumed by `src/api/`
 *     source. `auth.users` (GoTrue) is consumed by any `supabase.auth`
 *     usage; tables/RPCs/views must be referenced by quoted name.
 *  4. Every `<button>` in `src/features/` and `src/components/` must have an
 *     `onClick` handler or be `type="submit"`; every `<form>` must have an
 *     `onSubmit`; no `<a href="#">` dead links. (Heuristic scan — see below.)
 *  5. Matrix integrity extras: every component path named in the matrix must
 *     resolve to a file under `src/`; every test file named must exist.
 *
 * Heuristics (button/form scan):
 *  - The scan is textual, not a full JSX parse. For each `<button` / `<form`
 *    occurrence it reads the opening tag up to the `>` that closes it while
 *    tracking single/double quotes and `{...}` brace depth, so `=>` inside
 *    handlers does not end the tag early.
 *  - `*.test.*` files are skipped (test buttons don't need handlers).
 *  - A `<button type="submit">` is accepted without `onClick`: submission is
 *    handled by the enclosing form's `onSubmit` (React Hook Form pattern).
 *  - `<a href="#">` is always a dead link and fails.
 *
 * Run: `pnpm audit:wiring` (via tsx — no build step).
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SRC = join(ROOT, "src");

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

/** Recursively list files under `dir` with one of `exts` (e.g. [".ts", ".tsx"]). */
function listFiles(dir: string, exts: string[]): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
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
/* 1. Parse FEATURE_MATRIX.md                                          */
/* ------------------------------------------------------------------ */

interface MatrixRow {
  action: string;
  component: string;
  api: string;
  db: string;
  roles: string;
  test: string;
  line: number;
}

function parseMatrix(): MatrixRow[] {
  const text = readFileSync(join(ROOT, "FEATURE_MATRIX.md"), "utf8");
  const rows: MatrixRow[] = [];
  text.split("\n").forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) {
      return;
    }
    const cells = trimmed
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length !== 6) {
      return; // not the matrix table
    }
    if (/^:?-+:?$/.test(cells[0].replace(/\s/g, ""))) {
      return; // separator row
    }
    if (cells[0].toLowerCase().includes("screen/action")) {
      return; // header row
    }
    rows.push({
      action: cells[0],
      component: cells[1],
      api: cells[2],
      db: cells[3],
      roles: cells[4],
      test: cells[5],
      line: idx + 1,
    });
  });
  return rows;
}

/** Explicit "not applicable" marker — allowed, unlike a truly empty cell. */
function isNaMarker(cell: string): boolean {
  return cell === "—" || cell === "–" || cell === "-";
}

function backtickIdentifiers(cell: string): string[] {
  return [...cell.matchAll(/`([^`]+)`/g)]
    .map((m) => m[1].trim())
    .filter((id) => id.length > 0);
}

/* ------------------------------------------------------------------ */
/* 2. src/api exports                                                  */
/* ------------------------------------------------------------------ */

function apiModules(): { file: string; source: string }[] {
  return listFiles(join(SRC, "api"), [".ts"])
    .filter((f) => !f.endsWith(".test.ts"))
    .map((file) => ({ file, source: readFileSync(file, "utf8") }));
}

function exportedNames(source: string): string[] {
  const names = new Set<string>();
  for (const m of source.matchAll(
    /^export\s+(?:async\s+)?(?:function|const|class|enum)\s+([A-Za-z_$][\w$]*)/gm,
  )) {
    names.add(m[1]);
  }
  for (const m of source.matchAll(/^export\s+(?:interface|type)\s+([A-Za-z_$][\w$]*)/gm)) {
    names.add(m[1]);
  }
  return [...names];
}

/* ------------------------------------------------------------------ */
/* 3. Button / form scan                                               */
/* ------------------------------------------------------------------ */

/**
 * Read the opening tag starting at `start` (index of "<"), returning the tag
 * text including the closing ">". Tracks quotes and {...} depth so that
 * `=>` inside attribute expressions does not end the tag early.
 */
function readOpeningTag(source: string, start: number): string {
  let i = start;
  let quote: string | null = null;
  let depth = 0;
  while (i < source.length) {
    const ch = source[i];
    if (quote) {
      if (ch === quote && source[i - 1] !== "\\") {
        quote = null;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth = Math.max(0, depth - 1);
    } else if (ch === ">" && depth === 0) {
      return source.slice(start, i + 1);
    }
    i += 1;
  }
  return source.slice(start);
}

function checkButtonsAndForms(): void {
  const dirs = [join(SRC, "features"), join(SRC, "components")];
  for (const dir of dirs) {
    for (const file of listFiles(dir, [".tsx"])) {
      if (file.endsWith(".test.tsx")) {
        continue;
      }
      const source = readFileSync(file, "utf8");
      const rel = file.slice(ROOT.length + 1);
      for (const tagName of ["button", "form", "a"]) {
        let i = 0;
        while (true) {
          const at = source.indexOf(`<${tagName}`, i);
          if (at === -1) {
            break;
          }
          const after = source[at + tagName.length + 1] ?? "";
          // Must be a real tag open: "<button " / "<button>" / "<button/".
          if (!/[\s>/]/.test(after)) {
            i = at + 1;
            continue;
          }
          const tag = readOpeningTag(source, at);
          if (tagName === "button") {
            const hasOnClick = /\bonClick\s*=/.test(tag);
            const isSubmit = /\btype\s*=\s*["']submit["']/.test(tag);
            if (!hasOnClick && !isSubmit) {
              fail(`${rel}: <button> without onClick (and not type="submit")`);
            }
          } else if (tagName === "form") {
            if (!/\bonSubmit\s*=/.test(tag)) {
              fail(`${rel}: <form> without onSubmit`);
            }
          } else {
            const href = tag.match(/\bhref\s*=\s*["']([^"']*)["']/);
            if (href && href[1].trim() === "#") {
              fail(`${rel}: dead link <a href="#">`);
            }
          }
          i = at + 1;
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

function main(): void {
  const rows = parseMatrix();
  if (rows.length === 0) {
    fail("FEATURE_MATRIX.md: no data rows parsed — table format changed?");
  }

  /* Check 1: no empty cells. */
  for (const row of rows) {
    const cells: [string, string][] = [
      ["screen/action", row.action],
      ["component", row.component],
      ["api function", row.api],
      ["DB object", row.db],
      ["RLS roles", row.roles],
      ["test file", row.test],
    ];
    for (const [name, cell] of cells) {
      if (cell.trim() === "" && !isNaMarker(cell)) {
        fail(`FEATURE_MATRIX.md:${row.line} (${row.action}): empty "${name}" cell`);
      }
    }
  }

  /* Check 2: every src/api export is referenced somewhere (non-test code). */
  const modules = apiModules();
  const nonTestSources = listFiles(SRC, [".ts", ".tsx"])
    .filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"))
    .map((f) => readFileSync(f, "utf8"));
  for (const { file, source } of modules) {
    const rel = file.slice(ROOT.length + 1);
    for (const name of exportedNames(source)) {
      const pattern = new RegExp(`\\b${escapeRegExp(name)}\\b`, "g");
      const mentions = nonTestSources.reduce(
        (count, text) => count + (text.match(pattern)?.length ?? 0),
        0,
      );
      // One mention is the export declaration itself; anything more means the
      // export is referenced (imported or used) somewhere in the app.
      if (mentions < 2) {
        fail(`${rel}: export "${name}" is not referenced by any non-test source file`);
      }
    }
  }

  /* Check 3: DB objects exist and are consumed by src/api. */
  const migrationSql = listFiles(join(ROOT, "supabase", "migrations"), [".sql"])
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
  const interimSql = readFileSync(join(ROOT, "scripts", "interim-db-setup.sql"), "utf8");
  let generatedTypes = "";
  try {
    generatedTypes = readFileSync(join(SRC, "types", "database.ts"), "utf8");
  } catch {
    generatedTypes = "";
  }
  const apiSource = modules.map((m) => m.source).join("\n");
  for (const row of rows) {
    for (const id of backtickIdentifiers(row.db)) {
      const base = id.replace(/\s*\(.*\)$/, "").trim();
      if (base.length === 0 || isNaMarker(base)) {
        continue;
      }
      if (base === "auth.users") {
        if (!/auth\.users/.test(migrationSql + interimSql)) {
          fail(`FEATURE_MATRIX.md:${row.line}: "auth.users" not referenced by any migration`);
        }
        if (!/\.auth\./.test(apiSource)) {
          fail(`FEATURE_MATRIX.md:${row.line}: "auth.users" has no consumer in src/api/`);
        }
        continue;
      }
      const createPattern = new RegExp(
        `\\bCREATE\\b[^;]*?\\b${escapeRegExp(base)}\\b`,
        "is",
      );
      const exists =
        createPattern.test(migrationSql) ||
        new RegExp(`\\b${escapeRegExp(base)}\\b`).test(generatedTypes);
      if (!exists) {
        fail(
          `FEATURE_MATRIX.md:${row.line} (${row.action}): DB object "${base}" ` +
            `not found in any migration CREATE statement or generated types`,
        );
      }
      const consumed = new RegExp(`["'\`]${escapeRegExp(base)}["'\`]`).test(apiSource);
      if (!consumed) {
        fail(
          `FEATURE_MATRIX.md:${row.line} (${row.action}): DB object "${base}" ` +
            `has no consumer in src/api/`,
        );
      }
    }
  }

  /* Check 4: matrix api-function names must be real src/api exports. */
  const allExports = new Set<string>();
  for (const { source } of modules) {
    for (const name of exportedNames(source)) {
      allExports.add(name);
    }
  }
  for (const row of rows) {
    if (isNaMarker(row.api.trim()) || row.api.trim() === "") {
      continue;
    }
    for (const name of backtickIdentifiers(row.api)) {
      if (!allExports.has(name)) {
        fail(
          `FEATURE_MATRIX.md:${row.line} (${row.action}): api function "${name}" ` +
            `is not exported by any src/api/ module`,
        );
      }
    }
  }

  /* Check 5: component paths and test files named in the matrix exist. */
  for (const row of rows) {
    for (const id of backtickIdentifiers(row.component)) {
      if (!id.includes("/")) {
        continue; // bare component names (e.g. "AppNav") ride with their module
      }
      const base = join(SRC, id);
      const candidates = /\.[tj]sx?$/.test(id) ? [base] : [base + ".tsx", base + ".ts"];
      const exists = candidates.some((candidate) => {
        try {
          statSync(candidate);
          return true;
        } catch {
          return false;
        }
      });
      if (!exists) {
        fail(
          `FEATURE_MATRIX.md:${row.line} (${row.action}): component "${id}" ` +
            `does not resolve to a file under src/`,
        );
      }
    }
    for (const id of backtickIdentifiers(row.test)) {
      if (!/\.(test|spec)\.[tj]sx?$/.test(id)) {
        continue;
      }
      try {
        statSync(join(ROOT, id));
      } catch {
        fail(
          `FEATURE_MATRIX.md:${row.line} (${row.action}): test file "${id}" does not exist`,
        );
      }
    }
  }

  /* Check 6: buttons and forms. */
  checkButtonsAndForms();

  /* Report. */
  if (violations.length > 0) {
    errOut(`audit:wiring: FAILED — ${violations.length} violation(s):`);
    for (const v of violations) {
      errOut(`  - ${v}`);
    }
    process.exit(1);
  }
  out(
    `audit:wiring: OK — ${rows.length} matrix row(s), ` +
      `${modules.length} api module(s), all checks passed`,
  );
}

main();
