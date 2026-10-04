import { describe, expect, it, vi, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CsvImportDialog, type ValidatedRow } from "./CsvImportDialog";
import type { CsvColumnDef } from "@/features/importExport/csvTypes";

vi.mock("@/lib/csv", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/csv")>();
  return { ...original, downloadCSV: vi.fn() };
});

const columns: CsvColumnDef[] = [
  { header: "name", required: true, description: "Item name." },
  { header: "unit", required: true, description: "Unit name or symbol." },
];

interface TestInput {
  name: string;
}

function validateRecords(
  records: Record<string, string>[],
): ValidatedRow<TestInput>[] {
  return records.map((raw, i) =>
    raw["name"] && raw["name"].trim() !== ""
      ? {
          index: i + 1,
          raw,
          result: { ok: true as const, input: { name: raw["name"] } },
        }
      : {
          index: i + 1,
          raw,
          result: { ok: false as const, errors: ["Enter an item name."] },
        },
  );
}

function renderDialog(overrides: Record<string, unknown> = {}) {
  const importRows = vi
    .fn()
    .mockResolvedValue({ imported: 1, failures: [] });
  const props = {
    open: true,
    onClose: vi.fn(),
    title: "Import items",
    description: "Add many items at once.",
    templateFilename: "items-template.csv",
    columns,
    lookupsStatus: "ready" as const,
    onRetryLookups: vi.fn(),
    validateRecords,
    importRows,
    ...overrides,
  };
  const utils = render(<CsvImportDialog<TestInput> {...props} />);
  return { ...utils, props, importRows };
}

function pickFile(name: string, content: string, type = "text/csv") {
  const input = screen.getByLabelText(/choose a csv file/i);
  const file = new File([content], name, { type });
  fireEvent.change(input, { target: { files: [file] } });
}

describe("CsvImportDialog", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders nothing when closed", () => {
    const { container } = renderDialog({ open: false });
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the template download, column help and file picker", () => {
    renderDialog();
    expect(
      screen.getByRole("heading", { name: "Import items" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /download template/i }),
    ).toBeVisible();
    expect(screen.getByText("Expected columns")).toBeVisible();
    expect(screen.getByLabelText(/choose a csv file/i)).toBeInTheDocument();
  });

  it("downloads the template with the column headers", async () => {
    const { downloadCSV } = await import("@/lib/csv");
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /download template/i }));
    expect(downloadCSV).toHaveBeenCalledTimes(1);
    const [filename, content] = (
      downloadCSV as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0] as [string, string];
    expect(filename).toBe("items-template.csv");
    expect(content).toContain("name,unit");
  });

  it("rejects a non-csv file with a useful error", async () => {
    renderDialog();
    pickFile("items.txt", "name,unit\nTomato,kg\n", "text/plain");
    expect(await screen.findByText(/couldn't read this file/i)).toBeVisible();
    expect(screen.getByText(/not a \.csv file/i)).toBeVisible();
  });

  it("previews rows with per-row ok/error statuses before importing", async () => {
    renderDialog();
    pickFile("items.csv", "name,unit\nTomato,kg\n,kg\n");
    expect(await screen.findByText(/2 rows:/)).toBeVisible();
    expect(screen.getByText("Enter an item name.")).toBeVisible();
    const importButton = screen.getByRole("button", {
      name: /import 1 valid row/i,
    });
    expect(importButton).toBeEnabled();
  });

  it("imports only valid rows and reports the result", async () => {
    const { importRows } = renderDialog();
    pickFile("items.csv", "name,unit\nTomato,kg\n,kg\n");
    const importButton = await screen.findByRole("button", {
      name: /import 1 valid row/i,
    });
    fireEvent.click(importButton);

    await waitFor(() => {
      expect(importRows).toHaveBeenCalledTimes(1);
    });
    const call = importRows.mock.calls[0][0] as {
      rows: { index: number; input: TestInput }[];
    };
    expect(call.rows).toEqual([{ index: 1, input: { name: "Tomato" } }]);

    expect(await screen.findByText(/imported 1 row\./i)).toBeVisible();
  });

  it("disables import when no rows are valid", async () => {
    renderDialog();
    pickFile("items.csv", "name,unit\n,kg\n");
    const importButton = await screen.findByRole("button", {
      name: /import 0 valid rows/i,
    });
    expect(importButton).toBeDisabled();
  });

  it("reports missing required columns", async () => {
    renderDialog();
    pickFile("items.csv", "name\nTomato\n");
    expect(await screen.findByText(/missing required columns/i)).toBeVisible();
    expect(screen.getByText(/"unit"/)).toBeVisible();
  });

  it("waits for reference data and offers a retry on error", async () => {
    const onRetryLookups = vi.fn();
    const { rerender } = renderDialog({
      lookupsStatus: "loading",
      onRetryLookups,
    });
    pickFile("items.csv", "name,unit\nTomato,kg\n");
    expect(await screen.findByText(/loading reference data/i)).toBeVisible();

    rerender(
      <CsvImportDialog<TestInput>
        open
        onClose={vi.fn()}
        title="Import items"
        description="Add many items at once."
        templateFilename="items-template.csv"
        columns={columns}
        lookupsStatus="error"
        onRetryLookups={onRetryLookups}
        validateRecords={validateRecords}
        importRows={vi.fn()}
      />,
    );
    expect(
      await screen.findByText(/couldn't load reference data/i),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetryLookups).toHaveBeenCalledTimes(1);
  });
});
