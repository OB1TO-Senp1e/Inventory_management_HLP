import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecipeDialog } from "./RecipeDialog";

// All data hooks are mocked; these tests verify the builder's line
// management, unit filtering, and validation with zero network.
vi.mock("./hooks", () => ({
  useMenuItem: vi.fn(() => ({ data: undefined, isLoading: false, isError: false })),
  useCreateMenuItem: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useUpdateMenuItem: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useAddIngredient: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useUpdateIngredient: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useRemoveIngredient: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useUnits: vi.fn(),
  useUnitConversions: vi.fn(),
}));

vi.mock("@/features/items/hooks", () => ({
  useItems: vi.fn(),
}));

import { useUnitConversions, useUnits } from "./hooks";
import { useItems } from "@/features/items/hooks";

const mockedUseItems = vi.mocked(useItems);
const mockedUseUnits = vi.mocked(useUnits);
const mockedUseUnitConversions = vi.mocked(useUnitConversions);

const tomato = {
  id: "item-tomato",
  name: "Tomato",
  unitId: "unit-kg",
  unitSymbol: "kg",
};
const milk = {
  id: "item-milk",
  name: "Milk",
  unitId: "unit-l",
  unitSymbol: "L",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedUseItems.mockReturnValue({
    data: { items: [tomato, milk], total: 2 },
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof useItems>);
  mockedUseUnits.mockReturnValue({
    data: [
      { id: "unit-kg", name: "kilogram", symbol: "kg" },
      { id: "unit-g", name: "gram", symbol: "g" },
      { id: "unit-l", name: "litre", symbol: "L" },
    ],
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof useUnits>);
  mockedUseUnitConversions.mockReturnValue({
    data: [{ fromUnitId: "unit-g", toUnitId: "unit-kg", factor: 0.001 }],
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof useUnitConversions>);
});

function renderDialog() {
  render(<RecipeDialog menuItemId={null} onClose={vi.fn()} />);
}

describe("RecipeDialog", () => {
  it("adds an ingredient line with the item's base unit preselected", () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText("Add ingredient"), {
      target: { value: "item-tomato" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByText("Tomato")).toBeInTheDocument();
    // Unit select offers the base unit (kg) plus the convertible unit (g).
    const unitSelect = screen.getByLabelText("Unit for Tomato");
    const options = Array.from(
      (unitSelect as HTMLSelectElement).options,
    ).map((o) => o.textContent);
    expect(options).toEqual(["kg", "g"]);
  });

  it("limits unit choices to convertible units only", () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText("Add ingredient"), {
      target: { value: "item-milk" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const unitSelect = screen.getByLabelText("Unit for Milk");
    const options = Array.from(
      (unitSelect as HTMLSelectElement).options,
    ).map((o) => o.textContent);
    // Litre has no conversions, so only the base unit is offered.
    expect(options).toEqual(["L"]);
  });

  it("prevents adding the same item twice", () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText("Add ingredient"), {
      target: { value: "item-tomato" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const addSelect = screen.getByLabelText(
      "Add ingredient",
    ) as HTMLSelectElement;
    const options = Array.from(addSelect.options).map((o) => o.value);
    expect(options).not.toContain("item-tomato");
    expect(options).toContain("item-milk");
  });

  it("requires at least one ingredient on save", async () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText("Dish name"), {
      target: { value: "Test Dish" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Create recipe" }),
    );
    await waitFor(() => {
      expect(
        screen.getByText("Add at least one ingredient."),
      ).toBeInTheDocument();
    });
  });

  it("removes an ingredient line", () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText("Add ingredient"), {
      target: { value: "item-tomato" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByText("Tomato")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove Tomato" }));
    expect(screen.queryByText("Tomato")).not.toBeInTheDocument();
  });
});
