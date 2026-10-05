import { useEffect, useState } from "react";
import { isOnline } from "./offline";
import { getSyncEntries, subscribeSyncQueue, type SyncEntry } from "./queue";

export interface SyncStatus {
  isOnline: boolean;
  pending: number;
  failed: number;
  syncing: number;
  entries: SyncEntry[];
}

/**
 * Live view of the offline queue. Re-renders on every queue mutation and
 * on online/offline transitions.
 */
export function useSyncStatus(): SyncStatus {
  const [entries, setEntries] = useState<SyncEntry[]>(() => getSyncEntries());
  const [online, setOnline] = useState<boolean>(() => isOnline());

  useEffect(() => subscribeSyncQueue(() => setEntries(getSyncEntries())), []);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  return {
    isOnline: online,
    pending: entries.filter((e) => e.status === "pending").length,
    failed: entries.filter((e) => e.status === "failed").length,
    syncing: entries.filter((e) => e.status === "syncing").length,
    entries,
  };
}
