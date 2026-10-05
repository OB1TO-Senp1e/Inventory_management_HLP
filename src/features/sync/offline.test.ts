import { describe, expect, it, vi } from "vitest";
import { isNetworkError, isOnline } from "./offline";

describe("isOnline", () => {
  it("reflects navigator.onLine", () => {
    expect(isOnline()).toBe(navigator.onLine);
  });
});

describe("isNetworkError", () => {
  it("treats fetch rejections (TypeError) as network errors", () => {
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkError(new TypeError("Load failed"))).toBe(true);
  });

  it("treats aborts as network errors", () => {
    expect(isNetworkError(new DOMException("aborted", "AbortError"))).toBe(true);
  });

  it("does NOT treat server rejections as network errors", () => {
    // The api layer throws these for PostgREST/RPC errors — those are
    // conflicts, and must mark the entry failed rather than requeue it.
    expect(isNetworkError(new Error("Item is archived"))).toBe(false);
    expect(isNetworkError(new Error("duplicate key value"))).toBe(false);
    expect(isNetworkError(new Error("JWT expired"))).toBe(false);
  });

  it("matches common browser network messages", () => {
    expect(isNetworkError(new Error("net::ERR_INTERNET_DISCONNECTED"))).toBe(true);
    expect(isNetworkError("Network request failed")).toBe(true);
  });

  it("handles non-error values without throwing", () => {
    expect(isNetworkError(undefined)).toBe(false);
    expect(isNetworkError(null)).toBe(false);
    expect(vi.fn()).toBeDefined();
  });
});
