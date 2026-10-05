import { describe, expect, it } from "vitest";
import { bestItemMatch, matchItemsByName } from "./fuzzyMatch";

const DISHES = [
  { id: "1", name: "Butter Chicken", unitSymbol: "" },
  { id: "2", name: "Dal Makhani", unitSymbol: "" },
  { id: "3", name: "Paneer Tikka", unitSymbol: "" },
];

describe("matchItemsByName (shared matcher)", () => {
  it("matches exact names case-insensitively", () => {
    expect(bestItemMatch("butter chicken", DISHES)?.id).toBe("1");
  });

  it("matches prefix and substring variants", () => {
    expect(matchItemsByName("Butter", DISHES)[0]).toMatchObject({
      item: { id: "1" },
      score: 80,
    });
  });

  it("returns null when nothing matches", () => {
    expect(bestItemMatch("Sushi Platter", DISHES)).toBeNull();
    expect(matchItemsByName("Sushi Platter", DISHES)).toEqual([]);
  });

  it("returns an empty list for blank input", () => {
    expect(matchItemsByName("   ", DISHES)).toEqual([]);
  });
});
