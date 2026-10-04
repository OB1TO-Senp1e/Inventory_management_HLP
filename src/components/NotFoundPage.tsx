import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

/**
 * Friendly 404. Rendered inside the AppShell for signed-in users who hit an
 * unknown path (or a planned section whose page hasn't landed yet — each
 * feature task swaps in its real page). Signed-out visitors are redirected
 * to /login by ProtectedRoute instead.
 */
export function NotFoundPage() {
  return (
    <div className="flex min-h-[50dvh] flex-col items-center justify-center px-4 py-12 text-center">
      <p
        aria-hidden="true"
        className="text-6xl font-bold tracking-tight text-muted-foreground"
      >
        404
      </p>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        The page you&apos;re looking for doesn&apos;t exist or hasn&apos;t been
        built yet.
      </p>
      <Button asChild size="lg" className="mt-6">
        <Link to="/">Back to home</Link>
      </Button>
    </div>
  );
}
