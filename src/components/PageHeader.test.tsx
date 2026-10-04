import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageHeader } from "./PageHeader";

describe("PageHeader", () => {
  it("renders title, description and actions", () => {
    render(
      <PageHeader
        title="Items"
        description="Everything in your kitchen."
        actions={<button type="button">Add item</button>}
      />,
    );
    expect(screen.getByRole("heading", { name: "Items" })).toBeInTheDocument();
    expect(screen.getByText("Everything in your kitchen.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add item" })).toBeInTheDocument();
  });

  it("renders title alone", () => {
    render(<PageHeader title="Home" />);
    expect(screen.getByRole("heading", { name: "Home" })).toBeInTheDocument();
  });
});
