import { Component, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Catches render errors in its subtree and shows a friendly fallback with
 * retry and back-to-home actions. Intentionally logs nothing anywhere —
 * error reporting integrations arrive later; no console output in any env.
 * Remount (via `key`) to clear the error state, e.g. keyed by route path.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(): void {
    // Deliberately empty: no console logging, no external reporting yet.
  }

  private handleRetry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="flex min-h-[40dvh] flex-col items-center justify-center px-4 py-12 text-center"
        >
          <TriangleAlert aria-hidden="true" className="h-10 w-10 text-destructive" />
          <h2 className="mt-4 text-xl font-semibold tracking-tight">
            Something went wrong
          </h2>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            This section hit an unexpected error. Your data is safe — try again
            or head back home.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <Button type="button" size="lg" onClick={this.handleRetry}>
              Try again
            </Button>
            <Button type="button" size="lg" variant="outline" asChild>
              <Link to="/">Back to home</Link>
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
