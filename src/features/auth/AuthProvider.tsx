import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  getCurrentProfile,
  getSession,
  onAuthStateChange,
  signOut as apiSignOut,
  type AuthSession,
  type UserProfile,
} from "@/api/auth";
import { ensureCurrentOutlet } from "@/api/outlets";
import { AuthContext, type AuthStatus } from "./AuthContext";

/** Mock profiles (ri.mockRole) never hit the network — skip provisioning. */
function isMockProfile(profile: UserProfile): boolean {
  return profile.id.startsWith("mock-");
}

/**
 * Owns the session lifecycle: restores the persisted session on mount,
 * refreshes the user's profile (role) whenever the session changes, and
 * exposes signOut. Session persistence itself is handled by the Supabase
 * client (localStorage); this provider only mirrors it into React state.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [session, setSession] = useState<AuthSession | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadForSession = useCallback(async (next: AuthSession | null) => {
    setSession(next);
    if (!next) {
      setProfile(null);
      setStatus("signed-out");
      return;
    }
    try {
      let nextProfile = await getCurrentProfile();
      // V2-07: first sign-in after the multi-outlet migration (or any
      // profile without a pinned outlet) provisions "Main outlet" and pins
      // it, so every stock view has an outlet context from the start.
      if (nextProfile && !nextProfile.currentOutletId && !isMockProfile(nextProfile)) {
        try {
          await ensureCurrentOutlet();
          nextProfile = await getCurrentProfile();
        } catch {
          // Provisioning is best-effort here; stock views surface the
          // missing outlet with a retry action if it failed.
        }
      }
      setProfile(nextProfile);
      setStatus(nextProfile ? "signed-in" : "signed-out");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your profile.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void (async () => {
      try {
        const restored = await getSession();
        if (cancelled) {
          return;
        }
        // Subscribe before loading so no auth event is missed.
        unsubscribe = onAuthStateChange((next) => {
          if (!cancelled) {
            void loadForSession(next);
          }
        });
        await loadForSession(restored);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Authentication is unavailable.",
          );
          setStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [loadForSession]);

  const signOut = useCallback(async () => {
    await apiSignOut();
    setSession(null);
    setProfile(null);
    setStatus("signed-out");
  }, []);

  const refreshProfile = useCallback(async () => {
    const nextProfile = await getCurrentProfile();
    setProfile(nextProfile);
  }, []);

  const value = useMemo(
    () => ({ status, session, profile, error, signOut, refreshProfile }),
    [status, session, profile, error, signOut, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
