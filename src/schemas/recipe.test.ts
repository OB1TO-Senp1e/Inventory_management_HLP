import { describe, expect, it } from "vitest";
import {
  createMenuItemSchema,
  listMenuItemsSchema,
  recipeIngredientInputSchema,
  updateMenuItemSchema,
} from "./recipe";

describe("createMenuItemSchema", () => {
  it("accepts a valid menu item", () => {
    const result = createMenuItemSchema.safeParse({
      name: "Butter Chicken",
      description: "Creamy tomato curry",
      yieldQuantity: 4,
      yieldUnit: "servings",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty name", () => {
    const result = createMenuItemSchema.safeParse({
      name: "  ",
      yieldQuantity: 4,
      yieldUnit: "servings",
    });
    expect(result.success).toBe(false);
  });

  it("rejects zero or negative yield", () => {
    for (const yieldQuantity of [0, -2]) {
      const result = createMenuItemSchema.safeParse({
        name: "Dal",
        yieldQuantity,
        yieldUnit: "servings",
      });
      expect(result.success).toBe(false);
    }
  });

  it("rejects an empty yield unit", () => {
    const result = createMenuItemSchema.safeParse({
      name: "Dal",
      yieldQuantity: 4,
      yieldUnit: "  ",
    });
    expect(result.success).toBe(false);
  });

  it("coerces numeric strings", () => {
    const result = createMenuItemSchema.safeParse({
      name: "Dal",
      yieldQuantity: "4",
      yieldUnit: "servings",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.yieldQuantity).toBe(4);
    }
  });
});

describe("updateMenuItemSchema", () => {
  it("accepts partial updates", () => {
    const result = updateMenuItemSchema.safeParse({ name: "New name" });
    expect(result.success).toBe(true);
  });

  it("accepts an empty object", () => {
    expect(updateMenuItemSchema.safeParse({}).success).toBe(true);
  });
});

describe("recipeIngredientInputSchema", () => {
  const valid = {
    itemId: "b0000000-0000-0000-0000-000000000001",
    quantity: 500,
    unitId: "a0000000-0000-0000-0000-000000000001",
  };

  it("accepts a valid ingredient line", () => {
    expect(recipeIngredientInputSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects zero or negative quantity", () => {
    for (const quantity of [0, -1]) {
      expect(
        recipeIngredientInputSchema.safeParse({ ...valid, quantity }).success,
      ).toBe(false);
    }
  });

  it("rejects non-UUID identifiers", () => {
    expect(
      recipeIngredientInputSchema.safeParse({ ...valid, itemId: "nope" })
        .success,
    ).toBe(false);
    expect(
      recipeIngredientInputSchema.safeParse({ ...valid, unitId: "nope" })
        .success,
    ).toBe(false);
  });
});

describe("listMenuItemsSchema", () => {
  it("accepts empty filters", () => {
    expect(listMenuItemsSchema.safeParse({}).success).toBe(true);
  });

  it("accepts search and active flag", () => {
    const result = listMenuItemsSchema.safeParse({
      search: "chicken",
      active: true,
    });
    expect(result.success).toBe(true);
  });
});
