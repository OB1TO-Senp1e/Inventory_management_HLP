import { z } from "zod";
import {
  syncEntrySchema,
  newSyncEntrySchema,
  type EnqueueInput,
  type NewSyncEntry,
  type SyncEntry,
  type SyncEntryStatus,
} from "./types";

export type { SyncEntry, SyncEntryType, SyncEntryStatus } from "./types";

/**
 * The offline queue store (P6-02).
 *
 * Storage choice: localStorage, not IndexedDB. Queued payloads are small
 * (a receipt line is < 1KB; the whole queue is capped at 200 entries), and
 * localStorage is synchronous — the enqueue path never needs to await a
 * database round-trip, which keeps the mutation wrapper simple. Entries
 * survive reloads and are re-validated with Zod on load; corrupt entries
 * are dropped rather than replayed.
 *
 * All mutations go through the functions below and notify subscribers, so
 * React state stays in sync via `useSyncStatus`.
 */

const STORAGE_KEY = "ri.offlineQueue.v1";
const MAX_ENTRIES = 200;

const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 10 * 60_000;

/** Backoff before the next retry: 30s, 1m, 2m, 4m … capped at 10m. */
export function backoffDelayMs(attempts: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), BACKOFF_MAX_MS);
}

function storageAvailable(): boolean {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}

/** Raw read — drops corrupt entries instead of failing the whole queue. */
function readQueue(): SyncEntry[] {
  if (!storageAvailable()) {
    return [];
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = z.array(syncEntrySchema).safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // A failing subscriber must not break the store.
    }
  }
}

function writeQueue(entries: SyncEntry[]): void {
  if (storageAvailable()) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
      // Storage full or blocked — subscribers still see the update for this
      // session; the entries just won't survive a reload.
    }
  }
  notify();
}

/** Subscribe to queue changes. Returns an unsubscribe function. */
export function subscribeSyncQueue(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Cross-tab: another tab's write refreshes this tab's view.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) {
      notify();
    }
  });
}

/** All entries, oldest first. */
export function getSyncEntries(): SyncEntry[] {
  return readQueue().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Entries eligible for a drain pass: pending, or failed whose backoff
 * window has elapsed. Syncing entries are left alone (another pass owns
 * them).
 */
export function getPendingSyncEntries(now: Date = new Date()): SyncEntry[] {
  const nowIso = now.toISOString();
  return getSyncEntries().filter(
    (entry) =>
      entry.status === "pending" ||
      (entry.status === "failed" &&
        entry.nextRetryAt !== null &&
        entry.nextRetryAt <= nowIso),
  );
}

/** Validate + stamp + persist a new entry. Throws on invalid input. */
export function enqueueSyncEntry(input: EnqueueInput): SyncEntry {
  const parsed: NewSyncEntry = newSyncEntrySchema.parse(input);
  const stamped = {
    id: crypto.randomUUID(),
    restaurantId: parsed.restaurantId,
    createdAt: new Date().toISOString(),
    attempts: 0,
    nextRetryAt: null as string | null,
    status: "pending" as const,
    error: null as string | null,
  };
  // Per-branch construction keeps the discriminated union correlated.
  let entry: SyncEntry;
  switch (parsed.type) {
    case "wastage":
      entry = { ...stamped, type: "wastage", payload: parsed.payload };
      break;
    case "usage":
      entry = { ...stamped, type: "usage", payload: parsed.payload };
      break;
    case "receiving":
      entry = { ...stamped, type: "receiving", payload: parsed.payload };
      break;
  }
  const entries = [...readQueue(), entry].slice(-MAX_ENTRIES);
  writeQueue(entries);
  return entry;
}

/** Remove an entry (after a successful replay, or an explicit discard). */
export function removeSyncEntry(id: string): void {
  writeQueue(readQueue().filter((entry) => entry.id !== id));
}

function patchSyncEntry(id: string, patch: Partial<SyncEntry>): void {
  writeQueue(
    readQueue().map((entry) =>
      entry.id === id ? syncEntrySchema.parse({ ...entry, ...patch }) : entry,
    ),
  );
}

/** Mark an entry as being replayed. */
export function markSyncEntrySyncing(id: string): void {
  patchSyncEntry(id, { status: "syncing" satisfies SyncEntryStatus });
}

/** The connection dropped mid-drain — back to pending, no error recorded. */
export function markSyncEntryPending(id: string): void {
  patchSyncEntry(id, { status: "pending" satisfies SyncEntryStatus });
}

/**
 * Explicit user retry: clears the error/backoff so the next drain pass
 * picks the entry up immediately.
 */
export function resetSyncEntryForRetry(id: string): void {
  patchSyncEntry(id, {
    status: "pending" satisfies SyncEntryStatus,
    error: null,
    nextRetryAt: null,
  });
}

/**
 * The replay raised a non-network error (validation, archived item, RLS,
 * …). The entry is KEPT with the error text and a backoff window — never
 * silently dropped.
 */
export function markSyncEntryFailed(id: string, error: string): void {
  const entry = readQueue().find((e) => e.id === id);
  const attempts = (entry?.attempts ?? 0) + 1;
  patchSyncEntry(id, {
    status: "failed" satisfies SyncEntryStatus,
    error,
    attempts,
    nextRetryAt: new Date(Date.now() + backoffDelayMs(attempts)).toISOString(),
  });
}

/** Test helper — clears the whole queue. */
export function clearSyncQueue(): void {
  writeQueue([]);
}
