import { render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { Overview } from "./overview";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...props }: ComponentProps<"a"> & { to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/solar/dashboard", () => ({
  percentage: () => "Unavailable",
  useDashboard: () => ({ data: undefined, error: null }),
}));
vi.mock("./workspace", () => ({
  useWorkspace: () => ({
    history: [],
    ready: true,
    healthState: {
      reachable: true,
      models: false,
      state: "offline",
      modelStates: { panels: true, defects: false, classify: true },
    },
  }),
}));

describe("per-model availability", () => {
  it("distinguishes loaded models from an unavailable peer", () => {
    render(<Overview />);
    const card = (name: string) =>
      screen.getByRole("heading", { name }).closest(".model-card") as HTMLElement;
    expect(
      within(card("Solar Panel Detection")).getByText("Loaded", { exact: true }),
    ).toBeInTheDocument();
    expect(
      within(card("Thermal Classification")).getByText("Loaded", { exact: true }),
    ).toBeInTheDocument();
    expect(within(card("Defect Detection")).getAllByText("Unavailable").length).toBeGreaterThan(0);
    expect(
      within(card("Defect Detection")).queryByText("Loaded", { exact: true }),
    ).not.toBeInTheDocument();
  });
});
