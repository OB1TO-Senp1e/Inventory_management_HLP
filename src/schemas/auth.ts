import { z } from "zod";

const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Email is required")
  .email("Enter a valid email address");

export const signInSchema = z.object({
  email: emailField,
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export type SignInInput = z.infer<typeof signInSchema>;

export const resetPasswordSchema = z.object({
  email: emailField,
});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
