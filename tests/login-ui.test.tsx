// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LoginForm } from "@/components/login-form";
import { AreaBadge } from "@/components/decision-card";

vi.mock("@/app/actions", () => ({
  signInWithPassword: vi.fn(),
}));
afterEach(cleanup);

describe("login form", () => {
  it("offers email and password sign-in only", () => {
    render(<LoginForm />);
    expect(screen.getByLabelText("Your email")).toBeTruthy();
    expect(screen.getByLabelText("Password").getAttribute("type")).toBe("password");
    expect(screen.getByRole("button", { name: /^Sign in/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /sign-in link/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Google/ })).toBeNull();
  });
});

describe("area badge", () => {
  it("renders configured areas that have no dedicated icon or color", () => {
    render(<AreaBadge area="Elus Food" />);
    const badge = screen.getByText("Elus Food");
    expect(badge.className).toMatch(/area-tone-[0-3]/);
    expect(badge.querySelector("svg")).toBeTruthy();
  });
});
