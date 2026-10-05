import { describe, expect, it } from "vitest";
import {
  MAX_PRECACHE_BYTES,
  buildServiceWorkerSource,
  selectPrecacheAssets,
  type EmittedBundleFile,
} from "./vite-pwa-plugin.js";

describe("buildServiceWorkerSource", () => {
  const assets = ["assets/index-abc123.js", "assets/index-def456.css"];

  it("precaches the app shell, manifest, icons and build assets", () => {
    const source = buildServiceWorkerSource(assets);
    for (const url of [
      "/",
      "/index.html",
      "/manifest.webmanifest",
      "/icons/icon-192.png",
      "/icons/icon-512.png",
      "/icons/icon-maskable-512.png",
      "/assets/index-abc123.js",
      "/assets/index-def456.css",
    ]) {
      expect(source).toContain(`"${url}"`);
    }
  });

  it("versions the cache by the asset list", () => {
    const a = buildServiceWorkerSource(assets);
    const b = buildServiceWorkerSource([...assets].reverse());
    const c = buildServiceWorkerSource([...assets, "assets/extra-000.js"]);
    const nameOf = (s: string) => s.match(/const CACHE_NAME = "([^"]+)"/)?.[1];
    expect(nameOf(a)).toBe(nameOf(b));
    expect(nameOf(a)).not.toBe(nameOf(c));
  });

  it("keeps API traffic network-only and navigations on the offline shell", () => {
    const source = buildServiceWorkerSource(assets);
    expect(source).toContain('url.pathname.startsWith("/rest/")');
    expect(source).toContain('request.mode === "navigate"');
    expect(source).toContain('caches.match("/index.html")');
    expect(source).toContain("self.skipWaiting()");
    // Claim takes control of open pages; written as a chained call so it
    // runs before cache maintenance in the activate handler.
    expect(source).toMatch(/self\.clients\s*\n?\s*\.claim\(\)/);
    // Vary: Origin would otherwise make precached responses unmatchable
    // for the page's CORS-mode module scripts.
    expect(source).toContain("ignoreVary: true");
    // The worker must never cache itself or updates would pin forever.
    expect(source).toContain('url.pathname === "/sw.js"');
  });
});

describe("selectPrecacheAssets", () => {
  const chunk = (fileName: string, bytes: number): EmittedBundleFile => ({
    type: "chunk",
    fileName,
    code: "x".repeat(bytes),
  });
  const asset = (fileName: string, bytes: number): EmittedBundleFile => ({
    type: "asset",
    fileName,
    source: "x".repeat(bytes),
  });

  it("splits small assets to install precache and oversized ones to lazy", () => {
    const bundle = {
      "assets/app-abc.js": chunk("assets/app-abc.js", 1024),
      "assets/big-def.js": chunk("assets/big-def.js", MAX_PRECACHE_BYTES + 1),
      "assets/app-ghi.css": asset("assets/app-ghi.css", 2048),
      "sw.js": asset("sw.js", 512),
    };
    const { precache, lazy } = selectPrecacheAssets(bundle);
    expect(precache.sort()).toEqual(["assets/app-abc.js", "assets/app-ghi.css"]);
    expect(lazy).toEqual(["assets/big-def.js"]);
  });

  it("keeps assets at exactly the size limit in the install precache", () => {
    const bundle = {
      "assets/edge.js": chunk("assets/edge.js", MAX_PRECACHE_BYTES),
    };
    const { precache, lazy } = selectPrecacheAssets(bundle);
    expect(precache).toEqual(["assets/edge.js"]);
    expect(lazy).toEqual([]);
  });
});

describe("buildServiceWorkerSource lazy urls", () => {
  it("emits LAZY_URLS and caches them during activate", () => {
    const source = buildServiceWorkerSource(
      ["assets/app-abc.js"],
      ["assets/big-def.js"],
    );
    expect(source).toContain('"/assets/big-def.js"');
    expect(source).toContain("LAZY_URLS");
    // The lazy cache must not fail activation (e.g. updating while offline).
    expect(source).toContain(".catch(() => undefined)");
  });
});
