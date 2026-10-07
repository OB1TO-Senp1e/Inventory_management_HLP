import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { signIn } from "@/api/auth";
import { signInSchema, type SignInInput } from "@/schemas/auth";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/toast/useToast";

const inputClass =
  "h-11 w-full rounded-md border border-input bg-background px-3 text-sm " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { error: notifyError } = useToast();

  const rawFrom = (location.state as { from?: string } | null)?.from;
  const from = rawFrom && rawFrom !== "/login" && rawFrom !== "/reset-password" ? rawFrom : "/";

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignInInput>({ resolver: zodResolver(signInSchema) });

  const onSubmit = async (values: SignInInput) => {
    try {
      await signIn(values);
      navigate(from, { replace: true });
    } catch (err) {
      notifyError(
        err instanceof Error ? err.message : "Sign in failed. Please try again.",
      );
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[radial-gradient(ellipse_at_top,hsl(var(--gold-soft))_0%,transparent_55%)] px-4 py-8">
      <div className="lux-card w-full max-w-sm rounded-2xl p-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Use your restaurant account to continue.
        </p>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-6 space-y-4">
          <div>
            <label htmlFor="login-email" className="mb-1 block text-sm font-medium">
              Email
            </label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              aria-invalid={errors.email ? "true" : undefined}
              aria-describedby={errors.email ? "login-email-error" : undefined}
              className={inputClass}
              {...register("email")}
            />
            {errors.email && (
              <p id="login-email-error" role="alert" className="mt-1 text-sm text-destructive">
                {errors.email.message}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="login-password" className="mb-1 block text-sm font-medium">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              aria-invalid={errors.password ? "true" : undefined}
              aria-describedby={errors.password ? "login-password-error" : undefined}
              className={inputClass}
              {...register("password")}
            />
            {errors.password && (
              <p id="login-password-error" role="alert" className="mt-1 text-sm text-destructive">
                {errors.password.message}
              </p>
            )}
          </div>

          <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <p className="mt-4 text-center text-sm">
          <Link to="/reset-password" className="text-primary underline-offset-4 hover:underline">
            Forgot your password?
          </Link>
        </p>
      </div>
    </main>
  );
}
