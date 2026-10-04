import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cachedClient: SupabaseClient | null = null;

/**
 * Lazily creates the Supabase client from Vite env vars.
 * Throws a descriptive error when the vars are missing (see .env.example).
 * This is the only place the Supabase client is constructed; all data access
 * goes through src/api/ (added in later tasks).
 */
export function getSupabaseClient(): SupabaseClient {
  if (cachedClient) {
    return cachedClient;
  }
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Missing Supabase configuration. Copy .env.example to .env and set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.",
    );
  }
  cachedClient = createClient(url, anonKey, {
    // postgrest-js retries idempotent requests internally (3x with backoff).
    // React Query is the designated retry layer (see main.tsx), so disable
    // the hidden one — otherwise failures take ~35s (3x3 retries) to surface
    // instead of ~7s, in the app and in e2e.
    db: { retry: false },
  });
  return cachedClient;
}
