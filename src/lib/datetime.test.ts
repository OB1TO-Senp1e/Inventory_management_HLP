import { describe, expect, it } from "vitest";
import { startOfTodayIST, todayISODateIST } from "./datetime";

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
