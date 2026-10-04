import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link } from "react-router-dom";
import { resetPassword } from "@/api/auth";
import { resetPasswordSchema, type ResetPasswordInput } from "@/schemas/auth";
import { Button } from "@/components/ui/button";
import { Toast, type ToastKind } from "./Toast";

const inputClass =
  "h-11 w-full rounded-md border border-input bg-background px-3 text-sm " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function ResetPasswordPage() {
  const [toast, setToast] = useState<{ kind: ToastKind; message: string } | null>(null);
  const [sent, setSent] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({ resolver: zodResolver(resetPasswordSchema) });

  const onSubmit = async (values: ResetPasswordInput) => {
    setToast(null);
    try {
      await resetPassword(values);
      setSent(true);
      setToast({ kind: "success", message: "If that email is registered, a reset link is on its way." });
    } catch (err) {
      setToast({
        kind: "error",
        message: err instanceof Error ? err.message : "Could not send the reset email. Please try again.",
      });
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Reset password</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Enter your account email and we&apos;ll send you a reset link.
        </p>

        {sent ? (
          <p role="status" className="mt-6 rounded-md border border-input bg-card px-4 py-3 text-sm">
            Check your inbox for the reset link. It expires after a short time.
          </p>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-6 space-y-4">
            <div>
              <label htmlFor="reset-email" className="mb-1 block text-sm font-medium">
                Email
              </label>
              <input
                id="reset-email"
                type="email"
                autoComplete="email"
                aria-invalid={errors.email ? "true" : undefined}
                aria-describedby={errors.email ? "reset-email-error" : undefined}
                className={inputClass}
                {...register("email")}
              />
              {errors.email && (
                <p id="reset-email-error" role="alert" className="mt-1 text-sm text-destructive">
                  {errors.email.message}
                </p>
              )}
            </div>

            <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? "Sending…" : "Send reset link"}
            </Button>
          </form>
        )}

        <p className="mt-4 text-center text-sm">
          <Link to="/login" className="text-primary underline-offset-4 hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>

      {toast && (
        <Toast kind={toast.kind} message={toast.message} onDismiss={() => setToast(null)} />
      )}
    </main>
  );
}
