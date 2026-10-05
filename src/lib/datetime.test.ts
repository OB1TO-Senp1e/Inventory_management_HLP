import { describe, expect, it } from "vitest";
import {
  endOfDayIST,
  startOfDayIST,
  startOfTodayIST,
  toISTDateString,
  todayISODateIST,
} from "./datetime";

describe("todayISODateIST", () => {
  it("returns YYYY-MM-DD for the current Asia/Kolkata date", () => {
    const expected = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    expect(todayISODateIST()).toBe(expected);
    expect(todayISODateIST()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("startOfTodayIST", () => {
  it("pins the IST day start with the fixed +05:30 offset", () => {
    expect(startOfTodayIST()).toBe(`${todayISODateIST()}T00:00:00+05:30`);
  });
});

describe("startOfDayIST / endOfDayIST", () => {
  it("bounds an arbitrary IST day for PostgREST range filters", () => {
    expect(startOfDayIST("2026-10-01")).toBe("2026-10-01T00:00:00+05:30");
    expect(endOfDayIST("2026-10-01")).toBe("2026-10-01T23:59:59.999+05:30");
    // The bounds bracket the whole IST day in UTC.
    expect(new Date(startOfDayIST("2026-10-01")).getTime()).toBeLessThan(
      new Date(endOfDayIST("2026-10-01")).getTime(),
    );
  });
});

describe("toISTDateString", () => {
  it("buckets a UTC timestamp onto the Asia/Kolkata calendar date", () => {
    // 2026-10-04T20:00:00Z is 2026-10-05 01:30 in IST.
    expect(toISTDateString("2026-10-04T20:00:00.000Z")).toBe("2026-10-05");
    // 2026-10-04T18:00:00Z is 2026-10-04 23:30 in IST.
    expect(toISTDateString("2026-10-04T18:00:00.000Z")).toBe("2026-10-04");
  });
});
