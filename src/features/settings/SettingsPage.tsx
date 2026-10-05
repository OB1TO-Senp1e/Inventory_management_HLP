import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { TaxonomySection } from "./TaxonomySection";
import { AlertPreferencesSection } from "@/features/alerts/AlertPreferencesSection";
import type { TaxonomyKind } from "./hooks";

type SettingsTab = TaxonomyKind | "alerts";

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "category", label: "Categories" },
  { id: "location", label: "Storage locations" },
  { id: "alerts", label: "Alerts" },
];

/**
 * Settings page (P1-02, owner/manager only via the route guard): manages
 * item categories and storage locations, plus smart-alert preferences
 * (V2-03). Changes invalidate the item-form dropdown queries, so the item
 * form reflects them immediately.
 */
export function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>("category");

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Manage item categories, storage locations, and alert preferences."
      />

      <div
        role="tablist"
        aria-label="Settings sections"
        className="mb-6 flex gap-1 rounded-lg bg-muted p-1"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={
              "h-11 flex-1 rounded-md px-4 text-sm font-medium transition-colors " +
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
              (tab === t.id
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === "alerts" ? (
          <AlertPreferencesSection />
        ) : (
          <TaxonomySection kind={tab} />
        )}
      </div>
    </div>
  );
}
