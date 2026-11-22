import { render, screen, within, fireEvent } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { Shell, navigation } from "./shell";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...props }: ComponentProps<"a"> & { to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useRouterState: ({
    select,
  }: {
    select: (state: { location: { pathname: string } }) => unknown;
  }) => select({ location: { pathname: "/mlops" } }),
}));
vi.mock("./workspace", () => ({
  useWorkspace: () => ({
    preferences: { theme: "dark" },
    updatePreferences: vi.fn(),
    healthState: { state: "online", reachable: true },
    storageError: null,
  }),
}));

describe("workspace navigation accessibility", () => {
  it("keeps every link named when its visual text is hidden on mobile", () => {
    render(<Shell>Content</Shell>);
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    nav.querySelectorAll("span").forEach((element) => {
      element.style.display = "none";
    });
    for (const item of navigation) {
      expect(within(nav).getByRole("link", { name: item.label })).toHaveAttribute("href", item.to);
    }
    expect(within(nav).getByRole("link", { name: "MLOps Center" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(screen.getByRole("link", { name: "SolarVision AI home" })).toHaveAttribute("href", "/");
  });

  it("preserves link names through collapse and expand", () => {
    render(<Shell>Content</Shell>);
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(screen.getByRole("link", { name: "AI Inspection" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(screen.getByRole("button", { name: "Collapse sidebar" })).toBeInTheDocument();
  });
});
