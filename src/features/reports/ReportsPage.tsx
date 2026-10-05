import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Download } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { buildCsvContent, csvFilename, downloadCSV } from "@/lib/csv";
import { formatDate, formatDateTime, formatINR, formatNumber } from "@/lib/format";
import {
  defaultReportRange,
  reportRangeSchema,
  type ReportRange,
} from "@/schemas/reports";
import type {
  FoodCostDay,
  UsageRow,
  WastageReasonRow,
} from "@/lib/reports";
import type { PriceChangeReportEvent } from "@/api/reports";
import {
  useFoodCostTrend,
  usePriceChangeReport,
  useUsageReport,
  useWastageReport,
} from "./hooks";
import { cn } from "@/lib/utils";

/**
 * Reports (P5-04): owner/manager only. Four date-filtered reports —
 * usage, wastage by reason, food-cost trend, supplier price changes —
 * each with a chart, a table, an explicit empty state, and a CSV export.
 * Aggregation is client-side over the ledger and price history; the
 * range filters server-side on the Asia/Kolkata wall clock.
 */

type TabId = "usage" | "wastage" | "food-cost" | "price-changes";

const TABS: { id: TabId; label: string }[] = [
  { id: "usage", label: "Usage" },
  { id: "wastage", label: "Wastage by reason" },
  { id: "food-cost", label: "Food cost trend" },
  { id: "price-changes", label: "Supplier price changes" },
];

const REASON_LABELS: Record<string, string> = {
  expired: "Expired",
  spoiled: "Spoiled",
  damaged: "Damaged",
  over_prepared: "Over-prepared",
  other_wastage: "Other wastage",
  kitchen_use: "Kitchen use",
  staff_meal: "Staff meal",
  tasting: "Tasting",
  other_usage: "Other usage",
};

function reasonLabel(code: string): string {
  return REASON_LABELS[code] ?? code;
}

function movementTypeLabel(type: string): string {
  return type === "sale_deduction" ? "Sale deduction" : "Kitchen use";
}

function formatPct(value: number | null): string {
  if (value === null) {
    return "—";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-48 flex-col items-center justify-center rounded-lg border border-dashed text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

function ChartShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <figure aria-label={title} className="rounded-lg border p-4">
      <figcaption className="mb-2 text-sm font-medium">{title}</figcaption>
      <div className="h-72 w-full">{children}</div>
    </figure>
  );
}

function ReportTable({
  caption,
  headers,
  rows,
}: {
  caption: string;
  headers: string[];
  rows: React.ReactNode[];
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b bg-muted/50 text-left text-muted-foreground">
            {headers.map((header) => (
              <th key={header} scope="col" className="px-4 py-2 font-medium">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b last:border-0">
              {row}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cell({ children, numeric }: { children: React.ReactNode; numeric?: boolean }) {
  return (
    <td className={cn("px-4 py-2", numeric && "text-right tabular-nums")}>
      {children}
    </td>
  );
}

function exportCsv(filenamePrefix: string, headers: string[], rows: string[][]) {
  downloadCSV(csvFilename(filenamePrefix), buildCsvContent(headers, rows));
}

function UsagePanel({ range }: { range: ReportRange }) {
  const query = useUsageReport(range);
  const rows = query.data ?? [];
  const chartData = rows.slice(0, 8).map((row) => ({
    name: `${row.itemName} (${movementTypeLabel(row.movementType)})`,
    value: Math.round(row.value * 100) / 100,
  }));

  const onExport = () =>
    exportCsv(
      "usage-report",
      ["Item", "Type", "Lines", "Quantity", "Unit", "Value (INR)"],
      rows.map((row) => [
        row.itemName,
        movementTypeLabel(row.movementType),
        String(row.lines),
        String(row.quantity),
        row.unitSymbol,
        row.value.toFixed(2),
      ]),
    );

  return (
    <section aria-label="Usage report" className="space-y-4">
      {query.isLoading ? (
        <div className="h-48 animate-pulse rounded-lg border bg-muted/40" aria-label="Loading usage report" />
      ) : query.isError ? (
        <EmptyState message="Could not load the usage report. Try again." />
      ) : rows.length === 0 ? (
        <EmptyState message="No usage recorded in this date range." />
      ) : (
        <>
          <ChartShell title="Usage value by item (₹)">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tickFormatter={(value: number) => `₹${value}`} />
                <YAxis type="category" dataKey="name" width={160} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(value: unknown) => formatINR(Number(value ?? 0))} />
                <Bar dataKey="value" fill="hsl(var(--primary))" />
              </BarChart>
            </ResponsiveContainer>
          </ChartShell>
          <ReportTable
            caption="Usage per item and movement type"
            headers={["Item", "Type", "Lines", "Quantity", "Value (₹)"]}
            rows={rows.map((row: UsageRow) => (
              <>
                <Cell>{row.itemName}</Cell>
                <Cell>{movementTypeLabel(row.movementType)}</Cell>
                <Cell numeric>{row.lines}</Cell>
                <Cell numeric>
                  {formatNumber(row.quantity)} {row.unitSymbol}
                </Cell>
                <Cell numeric>{formatINR(row.value)}</Cell>
              </>
            ))}
          />
        </>
      )}
      <div>
        <Button variant="outline" onClick={onExport} disabled={rows.length === 0}>
          <Download aria-hidden="true" className="mr-2 h-4 w-4" />
          Export CSV
        </Button>
      </div>
    </section>
  );
}

function WastagePanel({ range }: { range: ReportRange }) {
  const query = useWastageReport(range);
  const rows = query.data ?? [];
  const chartData = rows.map((row) => ({
    name: reasonLabel(row.reasonCode),
    value: Math.round(row.value * 100) / 100,
  }));

  const onExport = () =>
    exportCsv(
      "wastage-report",
      ["Reason", "Lines", "Quantity", "Value lost (INR)"],
      rows.map((row) => [
        reasonLabel(row.reasonCode),
        String(row.lines),
        String(row.quantity),
        row.value.toFixed(2),
      ]),
    );

  return (
    <section aria-label="Wastage by reason report" className="space-y-4">
      {query.isLoading ? (
        <div className="h-48 animate-pulse rounded-lg border bg-muted/40" aria-label="Loading wastage report" />
      ) : query.isError ? (
        <EmptyState message="Could not load the wastage report. Try again." />
      ) : rows.length === 0 ? (
        <EmptyState message="No wastage recorded in this date range." />
      ) : (
        <>
          <ChartShell title="Value lost by reason (₹)">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ left: 8, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} interval={0} angle={-20} dy={8} height={56} />
                <YAxis tickFormatter={(value: number) => `₹${value}`} />
                <Tooltip formatter={(value: unknown) => formatINR(Number(value ?? 0))} />
                <Bar dataKey="value" fill="hsl(var(--primary))" />
              </BarChart>
            </ResponsiveContainer>
          </ChartShell>
          <ReportTable
            caption="Wastage grouped by reason code"
            headers={["Reason", "Lines", "Quantity", "Value lost (₹)"]}
            rows={rows.map((row: WastageReasonRow) => (
              <>
                <Cell>{reasonLabel(row.reasonCode)}</Cell>
                <Cell numeric>{row.lines}</Cell>
                <Cell numeric>{formatNumber(row.quantity)}</Cell>
                <Cell numeric>{formatINR(row.value)}</Cell>
              </>
            ))}
          />
        </>
      )}
      <div>
        <Button variant="outline" onClick={onExport} disabled={rows.length === 0}>
          <Download aria-hidden="true" className="mr-2 h-4 w-4" />
          Export CSV
        </Button>
      </div>
    </section>
  );
}

function FoodCostPanel({ range }: { range: ReportRange }) {
  const query = useFoodCostTrend(range);
  const days = query.data ?? [];
  const chartData = days.map((day) => ({
    date: day.date,
    label: formatDate(day.date),
    foodCost: Math.round(day.foodCost * 100) / 100,
  }));

  const onExport = () =>
    exportCsv(
      "food-cost-trend",
      ["Date", "Food cost (INR)"],
      days.map((day) => [day.date, day.foodCost.toFixed(2)]),
    );

  return (
    <section aria-label="Food cost trend report" className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Daily ingredient cost of dishes sold (sale deductions × average unit
        cost). Revenue is not captured in v1, so the trend is in ₹ — the live
        food-cost % per dish stays on the recipes page.
      </p>
      {query.isLoading ? (
        <div className="h-48 animate-pulse rounded-lg border bg-muted/40" aria-label="Loading food cost trend" />
      ) : query.isError ? (
        <EmptyState message="Could not load the food cost trend. Try again." />
      ) : days.length === 0 ? (
        <EmptyState message="No sales recorded in this date range." />
      ) : (
        <>
          <ChartShell title="Food cost per day (₹)">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ left: 8, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={(value: number) => `₹${value}`} />
                <Tooltip formatter={(value: unknown) => formatINR(Number(value ?? 0))} />
                <Bar dataKey="foodCost" fill="hsl(var(--primary))" />
              </BarChart>
            </ResponsiveContainer>
          </ChartShell>
          <ReportTable
            caption="Daily food cost"
            headers={["Date", "Food cost (₹)"]}
            rows={days.map((day: FoodCostDay) => (
              <>
                <Cell>{formatDate(day.date)}</Cell>
                <Cell numeric>{formatINR(day.foodCost)}</Cell>
              </>
            ))}
          />
        </>
      )}
      <div>
        <Button variant="outline" onClick={onExport} disabled={days.length === 0}>
          <Download aria-hidden="true" className="mr-2 h-4 w-4" />
          Export CSV
        </Button>
      </div>
    </section>
  );
}

function PriceChangesPanel({ range }: { range: ReportRange }) {
  const query = usePriceChangeReport(range);
  const events = query.data?.events ?? [];
  const summaries = query.data?.summaries ?? [];
  const chartData = summaries.slice(0, 10).map((summary) => ({
    name: `${summary.itemName} · ${summary.supplierName}`,
    changePct:
      summary.changePct === null
        ? 0
        : Math.round(summary.changePct * 10) / 10,
    hasChange: summary.changePct !== null,
  }));

  const onExport = () =>
    exportCsv(
      "supplier-price-changes",
      ["Date", "Supplier", "Item", "Old price (INR)", "New price (INR)", "Change %"],
      events.map((event) => [
        event.date,
        event.supplierName,
        event.itemName,
        event.oldPrice === null ? "" : event.oldPrice.toFixed(2),
        event.newPrice === null ? "" : event.newPrice.toFixed(2),
        event.changePct === null ? "" : event.changePct.toFixed(1),
      ]),
    );

  return (
    <section aria-label="Supplier price changes report" className="space-y-4">
      {query.isLoading ? (
        <div className="h-48 animate-pulse rounded-lg border bg-muted/40" aria-label="Loading price changes" />
      ) : query.isError ? (
        <EmptyState message="Could not load the price changes. Try again." />
      ) : events.length === 0 ? (
        <EmptyState message="No supplier price changes in this date range." />
      ) : (
        <>
          <ChartShell title="Net price change per item (%)">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tickFormatter={(value: number) => `${value}%`} />
                <YAxis type="category" dataKey="name" width={180} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(value: unknown) => formatPct(typeof value === "number" ? value : null)} />
                <Bar dataKey="changePct" fill="hsl(var(--primary))" />
              </BarChart>
            </ResponsiveContainer>
          </ChartShell>
          <ReportTable
            caption="Supplier price change events, newest first"
            headers={["Date", "Supplier", "Item", "Old (₹)", "New (₹)", "Change"]}
            rows={events.map((event: PriceChangeReportEvent) => (
              <>
                <Cell>{formatDateTime(event.date)}</Cell>
                <Cell>{event.supplierName}</Cell>
                <Cell>{event.itemName}</Cell>
                <Cell numeric>
                  {event.oldPrice === null ? "—" : formatINR(event.oldPrice)}
                </Cell>
                <Cell numeric>
                  {event.newPrice === null ? "—" : formatINR(event.newPrice)}
                </Cell>
                <Cell numeric>
                  <span
                    className={cn(
                      event.changePct !== null &&
                        (event.changePct > 0
                          ? "text-destructive"
                          : event.changePct < 0
                            ? "text-green-600 dark:text-green-400"
                            : ""),
                    )}
                  >
                    {formatPct(event.changePct)}
                  </span>
                </Cell>
              </>
            ))}
          />
        </>
      )}
      <div>
        <Button variant="outline" onClick={onExport} disabled={events.length === 0}>
          <Download aria-hidden="true" className="mr-2 h-4 w-4" />
          Export CSV
        </Button>
      </div>
    </section>
  );
}

export function ReportsPage() {
  const [range, setRange] = useState<ReportRange>(() => defaultReportRange());
  const [draft, setDraft] = useState({ from: range.from, to: range.to });
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("usage");

  const applyRange = () => {
    const parsed = reportRangeSchema.safeParse(draft);
    if (!parsed.success) {
      setRangeError(
        parsed.error.issues[0]?.message ?? "Enter a valid date range.",
      );
      return;
    }
    setRangeError(null);
    setRange(parsed.data);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Usage, wastage, food cost and supplier prices over a date range."
      />

      <div className="flex flex-wrap items-end gap-3" aria-label="Date range filter">
        <div className="space-y-1">
          <label htmlFor="reports-from" className="text-sm font-medium">
            From
          </label>
          <input
            id="reports-from"
            type="date"
            value={draft.from}
            max={draft.to}
            onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
            className="block rounded-md border bg-background px-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="reports-to" className="text-sm font-medium">
            To
          </label>
          <input
            id="reports-to"
            type="date"
            value={draft.to}
            min={draft.from}
            onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
            className="block rounded-md border bg-background px-3 py-2 text-sm"
          />
        </div>
        <Button onClick={applyRange}>Apply</Button>
        {rangeError && (
          <p role="alert" className="text-sm text-destructive">
            {rangeError}
          </p>
        )}
      </div>

      <div role="tablist" aria-label="Reports" className="flex flex-wrap gap-2 border-b pb-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "rounded-md px-3 py-2 text-sm font-medium",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              tab === t.id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "usage" && <UsagePanel range={range} />}
      {tab === "wastage" && <WastagePanel range={range} />}
      {tab === "food-cost" && <FoodCostPanel range={range} />}
      {tab === "price-changes" && <PriceChangesPanel range={range} />}
    </div>
  );
}
