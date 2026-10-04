import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const stackItems: string[] = [
  "Vite + React 18 + TypeScript (strict)",
  "Tailwind CSS + shadcn/ui theme tokens",
  "React Router + TanStack Query",
  "React Hook Form + Zod",
  "Recharts + lucide-react",
  "Supabase client (env-configured)",
];

export function SetupStatus() {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <section
        aria-labelledby="setup-heading"
        className="w-full max-w-md rounded-lg border bg-card p-8 text-card-foreground shadow-sm"
      >
        <div className="flex items-center gap-3">
          <CheckCircle2 className="size-8 text-primary" aria-hidden="true" />
          <div>
            <h1 id="setup-heading" className="text-xl font-semibold">
              Restaurant Inventory
            </h1>
            <p className="text-sm text-muted-foreground">Foundation ready — P0-01 complete</p>
          </div>
        </div>
        <div className="mt-6">
          <Button
            type="button"
            variant="outline"
            onClick={() => setShowDetails((visible) => !visible)}
            aria-expanded={showDetails}
          >
            {showDetails ? "Hide stack details" : "Show stack details"}
          </Button>
        </div>
        {showDetails && (
          <ul className="mt-4 space-y-2 text-sm">
            {stackItems.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
