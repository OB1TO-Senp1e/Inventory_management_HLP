import { describe, expect, it } from "vitest";
import { EXPIRY_SOON_DAYS, expiryStatus } from "./expiry";

function iso(daysFromToday: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}

describe("expiryStatus", () => {
  it("returns none for a missing expiry", () => {
    expect(expiryStatus(null)).toBe("none");
  });

  it("returns expired for a past date", () => {
    expect(expiryStatus(iso(-1))).toBe("expired");
    expect(expiryStatus(iso(-30))).toBe("expired");
  });

  it("returns soon for today and dates within the threshold", () => {
    expect(expiryStatus(iso(0))).toBe("soon");
    expect(expiryStatus(iso(1))).toBe("soon");
    expect(expiryStatus(iso(EXPIRY_SOON_DAYS))).toBe("soon");
  });

  it("returns ok for dates beyond the threshold", () => {
    expect(expiryStatus(iso(EXPIRY_SOON_DAYS + 1))).toBe("ok");
    expect(expiryStatus(iso(90))).toBe("ok");
  });
});
