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
  cachedClient = createClient(url, anonKey);
  return cachedClient;
}
