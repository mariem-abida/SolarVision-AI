import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Health } from "@/lib/solar/api";
import { SettingsPage } from "./settings-page";

const mocks = vi.hoisted(() => ({
  health: vi.fn(),
  updatePreferences: vi.fn(),
  clearHistory: vi.fn(),
  savedHealth: {
    state: "online",
    reachable: true,
    models: true,
    latency: 12,
    lastSuccess: null,
    error: null,
    errors: 0,
  },
}));
vi.mock("@/lib/solar/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/solar/api")>()),
  health: mocks.health,
}));
vi.mock("./workspace", () => ({
  useWorkspace: () => ({
    preferences: { apiUrl: "http://127.0.0.1:8000", theme: "dark", mode: "panels", threshold: 0.5 },
    updatePreferences: mocks.updatePreferences,
    history: [],
    clearHistory: mocks.clearHistory,
    healthState: mocks.savedHealth,
    historyError: null,
  }),
}));
beforeEach(() => {
  mocks.health.mockReset();
  mocks.updatePreferences.mockReset();
  mocks.clearHistory.mockReset();
  Object.assign(mocks.savedHealth, { state: "online", reachable: true, models: true });
});
afterEach(cleanup);
function enterUrl(value: string) {
  fireEvent.change(screen.getByLabelText("API Base URL"), { target: { value } });
}
function deferred() {
  let resolve!: (value: Health) => void;
  const promise = new Promise<Health>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("Settings API connection", () => {
  it("reports an API reachable saved connection when inference models are unavailable", () => {
    Object.assign(mocks.savedHealth, { state: "offline", reachable: true, models: false });
    render(<SettingsPage />);
    const saved = screen.getByText(/Saved workspace connection:/);
    expect(saved).toHaveTextContent("Status: API reachable");
    expect(saved).toHaveTextContent("Models: unavailable");
  });
  it("tests the entered URL without requiring it to be saved", async () => {
    mocks.health.mockResolvedValue({ status: "healthy", models_loaded: true });
    render(<SettingsPage />);
    enterUrl(" http://localhost:8123/// ");
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText("Connected. API healthy; models loaded.")).toBeInTheDocument();
    expect(mocks.health).toHaveBeenCalledWith("http://localhost:8123");
    expect(mocks.updatePreferences).not.toHaveBeenCalled();
    expect(screen.getByText(/Tested URL: http:\/\/localhost:8123/)).toHaveTextContent(
      "Response latency:",
    );
    expect(screen.getByText(/Saved workspace connection:/)).toHaveTextContent(
      "http://127.0.0.1:8000",
    );
  });
  it("distinguishes a reachable API from models that are not ready", async () => {
    mocks.health.mockResolvedValue({
      status: "starting",
      models_loaded: false,
      explanation: "Model loading is in progress.",
    });
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(
      await screen.findByText(/API reachable. Status: starting; models unavailable/),
    ).toHaveTextContent("Model loading is in progress.");
    expect(screen.queryByText("Connected. API healthy; models loaded.")).not.toBeInTheDocument();
  });
  it("rejects unsafe or invalid URL configuration before making a request", () => {
    render(<SettingsPage />);
    enterUrl("http://localhost:8000/?token=secret");
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "without credentials, query parameters, or a fragment",
    );
    fireEvent.click(screen.getByRole("button", { name: "Save connection" }));
    expect(mocks.health).not.toHaveBeenCalled();
    expect(mocks.updatePreferences).not.toHaveBeenCalled();
  });
  it("saves the normalized address and reports the completed save", () => {
    render(<SettingsPage />);
    enterUrl(" http://localhost:8123/// ");
    fireEvent.click(screen.getByRole("button", { name: "Save connection" }));
    expect(mocks.updatePreferences).toHaveBeenCalledWith({ apiUrl: "http://localhost:8123" });
    expect(screen.getByRole("status")).toHaveTextContent("API URL saved.");
    expect(screen.queryByText(/Checking connection…/)).not.toBeInTheDocument();
  });
  it("reports a failed connection and clears that result when the address changes", async () => {
    mocks.health.mockRejectedValue(new Error("Cannot reach the FastAPI service."));
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Cannot reach the FastAPI service.");
    enterUrl("http://localhost:8123");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("ignores an old test result after the entered URL changes", async () => {
    const first = deferred();
    mocks.health.mockReturnValueOnce(first.promise);
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(screen.getByText("Testing connection…")).toBeInTheDocument();
    enterUrl("http://localhost:8123");
    await act(async () => {
      first.resolve({ status: "healthy", models_loaded: true });
      await first.promise;
    });
    expect(screen.queryByText("Connected. API healthy; models loaded.")).not.toBeInTheDocument();
    expect(screen.queryByText(/Tested URL:/)).not.toBeInTheDocument();
  });
});
