import { createContext } from "react";
import type { AuthSession, UserProfile } from "@/api/auth";

export type AuthStatus = "loading" | "signed-in" | "signed-out" | "error";

export interface AuthContextValue {
  status: AuthStatus;
  session: AuthSession | null;
  profile: UserProfile | null;
  /** Human-readable message when status is "error" (e.g. missing .env config). */
  error: string | null;
  signOut: () => Promise<void>;
  /** Re-fetch the profile row (V2-07: after switch_outlet() pins a new outlet). */
  refreshProfile: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
