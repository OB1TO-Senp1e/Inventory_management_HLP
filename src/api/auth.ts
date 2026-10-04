import { z } from "zod";
import { getSupabaseClient } from "@/lib/supabase";
import {
  resetPasswordSchema,
  signInSchema,
  type ResetPasswordInput,
  type SignInInput,
} from "@/schemas/auth";
import { userRoleSchema, type UserRole } from "@/schemas/role";

/**
 * Auth API — the ONLY module allowed to touch `supabase.auth` or the
 * `profiles` table directly. All inputs are Zod-validated before any
 * client call; all outputs are typed. No network calls are made here
 * without validated input.
 */

export interface AuthSession {
  userId: string;
  email: string | null;
}

export interface UserProfile {
  id: string;
  restaurantId: string;
  role: UserRole;
}

const profileRowSchema = z.object({
  id: z.string(),
  restaurant_id: z.string(),
  role: userRoleSchema,
});

function parseOrThrow<T>(schema: z.ZodSchema<T>, input: unknown, what: string): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new Error(first?.message ?? `Invalid ${what}.`);
  }
  return result.data;
}

/** Sign in with email + password. Throws a human-readable Error on failure. */
export async function signIn(input: SignInInput): Promise<AuthSession> {
  const parsed = parseOrThrow(signInSchema, input, "credentials");
  const client = getSupabaseClient();
  const { data, error } = await client.auth.signInWithPassword({
    email: parsed.email,
    password: parsed.password,
  });
  if (error) {
    throw new Error(error.message);
  }
  const user = data.session?.user;
  if (!user) {
    throw new Error("Sign in failed: no session was returned.");
  }
  return { userId: user.id, email: user.email ?? null };
}

/** Sign out the current session. */
export async function signOut(): Promise<void> {
  const client = getSupabaseClient();
  const { error } = await client.auth.signOut();
  if (error) {
    throw new Error(error.message);
  }
}

/** Send a password-reset email. Never reveals whether the email exists. */
export async function resetPassword(input: ResetPasswordInput): Promise<void> {
  const parsed = parseOrThrow(resetPasswordSchema, input, "email");
  const client = getSupabaseClient();
  const { error } = await client.auth.resetPasswordForEmail(parsed.email, {
    redirectTo: `${window.location.origin}/reset-password`,
  });
  if (error) {
    throw new Error(error.message);
  }
}

/** The currently persisted session, or null when signed out. */
export async function getSession(): Promise<AuthSession | null> {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.getSession();
  if (error) {
    throw new Error(error.message);
  }
  const user = data.session?.user;
  if (!user) {
    return null;
  }
  return { userId: user.id, email: user.email ?? null };
}

/**
 * The signed-in user's profile row (role + restaurant). Returns null when
 * there is no session. Throws when the row is missing or the role is unknown.
 */
export async function getCurrentProfile(): Promise<UserProfile | null> {
  const session = await getSession();
  if (!session) {
    return null;
  }
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("profiles")
    .select("id, restaurant_id, role")
    .eq("id", session.userId)
    .single();
  if (error) {
    throw new Error(error.message);
  }
  const parsed = profileRowSchema.parse(data);
  return { id: parsed.id, restaurantId: parsed.restaurant_id, role: parsed.role };
}

/**
 * Subscribe to auth state changes. Returns an unsubscribe function.
 * The callback receives the mapped session (or null on sign-out).
 */
export function onAuthStateChange(callback: (session: AuthSession | null) => void): () => void {
  const client = getSupabaseClient();
  const { data } = client.auth.onAuthStateChange((_event, session) => {
    const user = session?.user;
    callback(user ? { userId: user.id, email: user.email ?? null } : null);
  });
  return () => {
    data.subscription.unsubscribe();
  };
}
