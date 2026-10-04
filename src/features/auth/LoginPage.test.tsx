import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { signIn } from "@/api/auth";
import { ToastProvider } from "@/components/toast/ToastProvider";
import { LoginPage } from "./LoginPage";

vi.mock("@/api/auth", () => ({ signIn: vi.fn() }));

const mockedSignIn = vi.mocked(signIn);

function renderLogin() {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<div>Home page</div>} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

describe("LoginPage", () => {
  it("renders labelled email and password fields", () => {
    renderLogin();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("shows inline errors and never calls signIn for invalid input", async () => {
    renderLogin();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "bad" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Enter a valid email address")).toBeInTheDocument();
    expect(await screen.findByText("Password must be at least 8 characters")).toBeInTheDocument();
    expect(mockedSignIn).not.toHaveBeenCalled();
  });

  it("signs in and navigates home on success", async () => {
    mockedSignIn.mockResolvedValue({ userId: "u1", email: "a@b.com" });
    renderLogin();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Home page")).toBeInTheDocument();
    expect(mockedSignIn).toHaveBeenCalledWith({
      email: "a@b.com",
      password: "password123",
    });
  });

  it("shows an error toast when sign in fails", async () => {
    mockedSignIn.mockRejectedValue(new Error("Invalid login credentials"));
    renderLogin();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Invalid login credentials");
    expect(screen.queryByText("Home page")).not.toBeInTheDocument();
  });
});
