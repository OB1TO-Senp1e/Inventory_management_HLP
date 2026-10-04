import { describe, expect, it, vi, afterEach } from "vitest";
import {
  buildCsvContent,
  csvFilename,
  downloadCSV,
  isCsvFilename,
  parseCsvFile,
  parseCsvText,
} from "./csv";

describe("isCsvFilename", () => {
  it("accepts .csv in any case", () => {
    expect(isCsvFilename("items.csv")).toBe(true);
    expect(isCsvFilename("ITEMS.CSV")).toBe(true);
    expect(isCsvFilename("my items.Csv")).toBe(true);
  });

  it("rejects non-csv names", () => {
    expect(isCsvFilename("items.txt")).toBe(false);
    expect(isCsvFilename("items.csv.bak")).toBe(false);
    expect(isCsvFilename("csv")).toBe(false);
  });
});

describe("buildCsvContent", () => {
  it("builds a header + rows grid", () => {
    const out = buildCsvContent(["name", "price"], [["Tomato", "40"]]);
    expect(out).toBe("\uFEFFname,price\r\nTomato,40\r\n");
  });

  it("quotes cells containing commas, quotes or newlines", () => {
    const out = buildCsvContent(
      ["name", "notes"],
      [['Fresh "desi" tomatoes', "line1\nline2"], ["Salt, fine", "plain"]],
    );
    expect(out).toContain('"Fresh ""desi"" tomatoes"');
    expect(out).toContain('"line1\nline2"');
    expect(out).toContain('"Salt, fine"');
  });

  it("starts with a UTF-8 BOM so Excel opens it correctly", () => {
    expect(buildCsvContent(["a"], []).charCodeAt(0)).toBe(0xfeff);
  });
});

describe("csvFilename", () => {
  it("prefixes with the given name and today's date", () => {
    expect(csvFilename("items")).toMatch(/^items-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});

describe("downloadCSV", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("creates a blob URL and clicks a download anchor", () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:mock-url");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    let appended: HTMLElement | null = null;
    vi.spyOn(document.body, "appendChild").mockImplementation((node) => {
      appended = node as HTMLElement;
      return node;
    });
    vi.spyOn(document.body, "removeChild").mockImplementation((node) => node);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    downloadCSV("items-2026-10-04.csv", "\uFEFFname\r\nTomato\r\n");

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(click).toHaveBeenCalledTimes(1);
    expect(appended).toBeInstanceOf(HTMLAnchorElement);
    expect((appended as unknown as HTMLAnchorElement).download).toBe(
      "items-2026-10-04.csv",
    );
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });
});

describe("parseCsvText", () => {
  it("parses a simple csv into header-keyed rows", () => {
    const result = parseCsvText("name,unit\nTomato,kg\nOnion,kg\n");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.headers).toEqual(["name", "unit"]);
    expect(result.rows).toEqual([
      { name: "Tomato", unit: "kg" },
      { name: "Onion", unit: "kg" },
    ]);
  });

  it("trims headers and handles quoted commas", () => {
    const result = parseCsvText(' name , notes \n"a,b","x""y"\n');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.headers).toEqual(["name", "notes"]);
    expect(result.rows[0]).toEqual({ name: "a,b", notes: 'x"y' });
  });

  it("skips blank lines", () => {
    const result = parseCsvText("name\nTomato\n\n\nOnion\n");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(2);
  });

  it("strips a leading BOM from the first header", () => {
    const result = parseCsvText("\uFEFFname,unit\nTomato,kg\n");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.headers).toEqual(["name", "unit"]);
  });

  it("rejects empty text", () => {
    const result = parseCsvText("   \n  ");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/empty/i);
  });

  it("rejects binary garbage", () => {
    const result = parseCsvText("a,b\n\x00\x01\x02\n");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/binary/i);
  });

  it("rejects content with no header row", () => {
    const result = parseCsvText(",,,\n,,,\n");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/header/i);
  });
});

describe("parseCsvFile", () => {
  it("rejects non-csv filenames without reading", async () => {
    const file = new File(["name\nTomato\n"], "items.txt", {
      type: "text/plain",
    });
    const result = await parseCsvFile(file);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not a \.csv file/i);
  });

  it("rejects empty files", async () => {
    const file = new File([], "empty.csv", { type: "text/csv" });
    const result = await parseCsvFile(file);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/empty/i);
  });

  it("parses a real File object", async () => {
    const file = new File(["name,unit\nTomato,kg\n"], "items.csv", {
      type: "text/csv",
    });
    const result = await parseCsvFile(file);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toEqual([{ name: "Tomato", unit: "kg" }]);
  });
});
