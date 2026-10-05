import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { Download } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { buildCsvContent, csvFilename, downloadCSV } from "@/lib/csv";
import { formatDate, formatDateTime, formatINR, formatNumber } from "@/lib/format";
import {
  CLASSIFICATION_GUIDANCE,
  CLASSIFICATION_LABELS,
  UNCLASSIFIED_LABELS,
  type DishClassification,
  type MenuEngineeringDishRow,
} from "@/lib/menuEngineering";
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
  useMenuEngineeringReport,
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

type TabId = "usage" | "wastage" | "food-cost" | "price-changes" | "menu-engineering";

const TABS: { id: TabId; label: string }[] = [
  { id: "usage", label: "Usage" },
  { id: "wastage", label: "Wastage by reason" },
  { id: "food-cost", label: "Food cost trend" },
  { id: "price-changes", label: "Supplier price changes" },
  { id: "menu-engineering", label: "Menu engineering" },
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

const CLASSIFICATION_STYLES: Record<DishClassification, string> = {
  star: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  plowhorse: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  puzzle:
    "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200",
  dog: "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300",
};

const CLASSIFICATION_DOT: Record<DishClassification, string> = {
  star: "#f59e0b",
  plowhorse: "#3b82f6",
  puzzle: "#8b5cf6",
  dog: "#78716c",
};

const CLASSIFICATION_ORDER: Record<DishClassification, number> = {
  star: 0,
  plowhorse: 1,
  puzzle: 2,
  dog: 3,
};

function ClassificationBadge({ row }: { row: MenuEngineeringDishRow }) {
  if (row.classification !== null) {
    return (
      <span
        className={cn(
          "inline-block rounded-full px-2.5 py-0.5 text-xs font-medium",
          CLASSIFICATION_STYLES[row.classification],
        )}
      >
        {CLASSIFICATION_LABELS[row.classification]}
      </span>
    );
  }
  return (
    <span className="inline-block rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
      {row.unclassifiedReason !== null
        ? UNCLASSIFIED_LABELS[row.unclassifiedReason]
        : "Unclassified"}
    </span>
  );
}

interface ScatterPoint {
  name: string;
  x: number;
  y: number;
  z: number;
  classification: DishClassification;
}

function paddedDomain(values: number[]): [number, number] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    const pad = Math.abs(min) * 0.2 || 1;
    return [min - pad, max + pad];
  }
  const span = max - min;
  return [min - span * 0.12, max + span * 0.12];
}

function MenuEngineeringTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: ScatterPoint }[];
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) {
    return null;
  }
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="font-medium">{point.name}</p>
      <p className="text-muted-foreground">
        Sold: {formatNumber(point.x)} · Margin: {formatINR(point.y)}/dish
      </p>
      <p className="text-muted-foreground">
        Total contribution: {formatINR(point.z)}
      </p>
      <p className="font-medium">{CLASSIFICATION_LABELS[point.classification]}</p>
    </div>
  );
}

type MenuEngineeringSortKey =
  | "name"
  | "classification"
  | "qtySold"
  | "sellingPrice"
  | "costPerDish"
  | "contributionMargin"
  | "totalContribution"
  | "foodCostPct";

const SORT_LABELS: Record<MenuEngineeringSortKey, string> = {
  name: "Dish",
  classification: "Class",
  qtySold: "Sold",
  sellingPrice: "Price",
  costPerDish: "Cost/dish",
  contributionMargin: "Margin/dish",
  totalContribution: "Total margin",
  foodCostPct: "Food cost %",
};

function sortMenuEngineeringRows(
  rows: MenuEngineeringDishRow[],
  key: MenuEngineeringSortKey,
  dir: "asc" | "desc",
): MenuEngineeringDishRow[] {
  const factor = dir === "asc" ? 1 : -1;
  const value = (row: MenuEngineeringDishRow): number | string => {
    switch (key) {
      case "name":
        return row.name.toLowerCase();
      case "classification":
        // Classified rows first (Star → Dog), unclassified last.
        return row.classification === null
          ? 99
          : CLASSIFICATION_ORDER[row.classification];
      case "qtySold":
        return row.qtySold;
      case "sellingPrice":
        return row.sellingPrice ?? Number.NaN;
      case "costPerDish":
        return row.costPerDish ?? Number.NaN;
      case "contributionMargin":
        return row.contributionMargin ?? Number.NaN;
      case "totalContribution":
        return row.totalContribution ?? Number.NaN;
      case "foodCostPct":
        return row.foodCostPct ?? Number.NaN;
    }
  };
  return [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    // Unknown (null) values always sort last, regardless of direction.
    const aNaN = typeof va === "number" && Number.isNaN(va);
    const bNaN = typeof vb === "number" && Number.isNaN(vb);
    if (aNaN && bNaN) {
      return a.name.localeCompare(b.name);
    }
    if (aNaN) {
      return 1;
    }
    if (bNaN) {
      return -1;
    }
    // Unclassified dishes (classification rank 99) always sort last too.
    if (key === "classification") {
      const aUn = va === 99;
      const bUn = vb === 99;
      if (aUn && bUn) {
        return a.name.localeCompare(b.name);
      }
      if (aUn) {
        return 1;
      }
      if (bUn) {
        return -1;
      }
    }
    if (typeof va === "string" || typeof vb === "string") {
      return factor * String(va).localeCompare(String(vb));
    }
    return factor * (va - vb) || a.name.localeCompare(b.name);
  });
}

function MenuEngineeringPanel({ range }: { range: ReportRange }) {
  const query = useMenuEngineeringReport(range);
  const report = query.data;
  const rows = report?.dishes ?? [];
  const [sortKey, setSortKey] =
    useState<MenuEngineeringSortKey>("totalContribution");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const sorted = sortMenuEngineeringRows(rows, sortKey, sortDir);

  const toggleSort = (key: MenuEngineeringSortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" || key === "classification" ? "asc" : "desc");
    }
  };

  const classified = rows.filter((row) => row.classification !== null);
  const points: ScatterPoint[] = classified.map((row) => ({
    name: row.name,
    x: row.qtySold,
    y: row.contributionMargin ?? 0,
    z: Math.max(row.totalContribution ?? 0, 0),
    classification: row.classification as DishClassification,
  }));
  const xDomain = paddedDomain([0, ...points.map((p) => p.x)]);
  const yDomain = paddedDomain(points.map((p) => p.y));

  const onExport = () =>
    exportCsv(
      "menu-engineering",
      [
        "Dish",
        "Classification",
        "Dishes sold",
        "Selling price (INR)",
        "Cost per dish (INR)",
        "Contribution margin (INR)",
        "Total contribution (INR)",
        "Food cost %",
      ],
      rows.map((row) => [
        row.name,
        row.classification !== null
          ? CLASSIFICATION_LABELS[row.classification]
          : row.unclassifiedReason !== null
            ? UNCLASSIFIED_LABELS[row.unclassifiedReason]
            : "",
        String(row.qtySold),
        row.sellingPrice === null ? "" : row.sellingPrice.toFixed(2),
        row.costPerDish === null ? "" : row.costPerDish.toFixed(2),
        row.contributionMargin === null
          ? ""
          : row.contributionMargin.toFixed(2),
        row.totalContribution === null ? "" : row.totalContribution.toFixed(2),
        row.foodCostPct === null ? "" : row.foodCostPct.toFixed(1),
      ]),
    );

  return (
    <section aria-label="Menu engineering report" className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Each dish sold in the range is plotted by popularity (dishes sold)
        against profitability (selling price minus live recipe cost). The
        axes cross at the average of each — Stars are above average on
        both. Costs and prices are the <em>current</em> values: a dish sold
        before a price change is evaluated at today&apos;s cost and price.
      </p>
      {query.isLoading ? (
        <div
          className="h-48 animate-pulse rounded-lg border bg-muted/40"
          aria-label="Loading menu engineering report"
        />
      ) : query.isError ? (
        <EmptyState message="Could not load the menu engineering report. Try again." />
      ) : rows.length === 0 ? (
        <EmptyState message="No sales recorded in this date range." />
      ) : (
        <>
          {classified.length > 0 && report !== undefined ? (
            <>
              <ChartShell title="Popularity vs profitability (bubble = total contribution ₹)">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ left: 8, right: 16, top: 12 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      type="number"
                      dataKey="x"
                      name="Dishes sold"
                      domain={xDomain}
                      tick={{ fontSize: 12 }}
                      label={{
                        value: "Dishes sold",
                        position: "insideBottomRight",
                        offset: -4,
                        fontSize: 12,
                      }}
                    />
                    <YAxis
                      type="number"
                      dataKey="y"
                      name="Margin/dish"
                      domain={yDomain}
                      tick={{ fontSize: 12 }}
                      tickFormatter={(value: number) => `₹${value}`}
                    />
                    <ZAxis type="number" dataKey="z" range={[80, 500]} />
                    <Tooltip
                      content={<MenuEngineeringTooltip />}
                      cursor={{ strokeDasharray: "3 3" }}
                    />
                    <ReferenceLine
                      x={report.avgPopularity}
                      stroke="hsl(var(--muted-foreground))"
                      strokeDasharray="4 4"
                      label={{
                        value: "avg sold",
                        position: "insideTopRight",
                        fontSize: 11,
                      }}
                    />
                    <ReferenceLine
                      y={report.avgMargin}
                      stroke="hsl(var(--muted-foreground))"
                      strokeDasharray="4 4"
                      label={{
                        value: "avg margin",
                        position: "insideTopRight",
                        fontSize: 11,
                      }}
                    />
                    {(
                      Object.keys(CLASSIFICATION_LABELS) as DishClassification[]
                    ).map((c) => (
                      <Scatter
                        key={c}
                        name={CLASSIFICATION_LABELS[c]}
                        data={points.filter((p) => p.classification === c)}
                        fill={CLASSIFICATION_DOT[c]}
                        fillOpacity={0.75}
                      />
                    ))}
                  </ScatterChart>
                </ResponsiveContainer>
              </ChartShell>
              <ul
                aria-label="Quadrant guide"
                className="grid gap-2 sm:grid-cols-2"
              >
                {(
                  Object.keys(CLASSIFICATION_LABELS) as DishClassification[]
                ).map((c) => (
                  <li
                    key={c}
                    className="flex items-start gap-2 rounded-lg border p-3 text-sm"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-1.5 h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: CLASSIFICATION_DOT[c] }}
                    />
                    <span>
                      <strong>{CLASSIFICATION_LABELS[c]}.</strong>{" "}
                      {CLASSIFICATION_GUIDANCE[c]}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <EmptyState message="Sales exist in this range, but no dish could be classified — set selling prices and recipes to see the quadrants." />
          )}
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Menu engineering: dishes sold with profitability classification
              </caption>
              <thead>
                <tr className="border-b bg-muted/50 text-left text-muted-foreground">
                  {(
                    Object.keys(SORT_LABELS) as MenuEngineeringSortKey[]
                  ).map((key) => (
                    <th
                      key={key}
                      scope="col"
                      aria-sort={
                        sortKey === key
                          ? sortDir === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                      className={cn(
                        "whitespace-nowrap px-4 py-2 font-medium",
                        key !== "name" &&
                          key !== "classification" &&
                          "text-right",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(key)}
                        aria-label={`Sort by ${SORT_LABELS[key]}`}
                        className="inline-flex items-center gap-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {SORT_LABELS[key]}
                        <span aria-hidden="true" className="text-xs">
                          {sortKey === key ? (sortDir === "asc" ? "▲" : "▼") : "△"}
                        </span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => (
                  <tr
                    key={`${row.menuItemId ?? "unknown"}|${row.name}`}
                    className="border-b last:border-0"
                  >
                    <Cell>
                      <span className="font-medium">{row.name}</span>
                      {row.active === false && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          (archived)
                        </span>
                      )}
                    </Cell>
                    <Cell>
                      <ClassificationBadge row={row} />
                    </Cell>
                    <Cell numeric>{formatNumber(row.qtySold)}</Cell>
                    <Cell numeric>
                      {row.sellingPrice === null
                        ? "—"
                        : formatINR(row.sellingPrice)}
                    </Cell>
                    <Cell numeric>
                      {row.costPerDish === null ? "—" : formatINR(row.costPerDish)}
                    </Cell>
                    <Cell numeric>
                      {row.contributionMargin === null ? (
                        "—"
                      ) : (
                        <span
                          className={cn(
                            row.contributionMargin < 0 && "text-destructive",
                          )}
                        >
                          {formatINR(row.contributionMargin)}
                        </span>
                      )}
                    </Cell>
                    <Cell numeric>
                      {row.totalContribution === null
                        ? "—"
                        : formatINR(row.totalContribution)}
                    </Cell>
                    <Cell numeric>
                      {row.foodCostPct === null
                        ? "—"
                        : `${row.foodCostPct.toFixed(1)}%`}
                    </Cell>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
        description="Usage, wastage, food cost, supplier prices and menu engineering over a date range."
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
      {tab === "menu-engineering" && <MenuEngineeringPanel range={range} />}
    </div>
  );
}
