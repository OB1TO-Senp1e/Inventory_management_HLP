import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { TaxonomySection } from "./TaxonomySection";
import { AlertPreferencesSection } from "@/features/alerts/AlertPreferencesSection";
import { OutletManagementSection } from "@/features/outlets/OutletManagementSection";
import { useAuth } from "@/features/auth/useAuth";
import type { TaxonomyKind } from "./hooks";

type SettingsTab = TaxonomyKind | "alerts" | "outlets";

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "category", label: "Categories" },
  { id: "location", label: "Storage locations" },
  { id: "alerts", label: "Alerts" },
  { id: "outlets", label: "Outlets" },
];

/**
 * Settings page (P1-02, owner/manager only via the route guard): manages
 * item categories and storage locations, smart-alert preferences (V2-03),
 * and outlets (V2-07 — the tab renders for everyone but management itself
 * is owner-only).
 */
export function SettingsPage() {
  const { profile } = useAuth();
  const [tab, setTab] = useState<SettingsTab>("category");
  const visibleTabs =
    profile?.role === "owner" ? TABS : TABS.filter((t) => t.id !== "outlets");

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Manage item categories, storage locations, alert preferences, and outlets."
      />

      <div
        role="tablist"
        aria-label="Settings sections"
        className="mb-6 flex gap-1 overflow-x-auto rounded-lg bg-muted p-1"
      >
        {visibleTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={
              "h-11 flex-1 whitespace-nowrap rounded-md px-4 text-sm font-medium transition-colors " +
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
        ) : tab === "outlets" ? (
          <OutletManagementSection />
        ) : (
          <TaxonomySection kind={tab} />
        )}
      </div>
    </div>
  );
}
