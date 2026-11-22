import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceProvider, useWorkspace } from "./workspace";
import type { Inspection } from "@/lib/solar/domain";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";

const api = vi.hoisted(() => ({
  health: vi.fn(),
  inspectionHistory: vi.fn(),
  importHistory: vi.fn(),
}));
const runtime = vi.hoisted(() => ({ apiUrl: "http://127.0.0.1:28001" }));
vi.mock("@/lib/solar/runtime-config", () => ({
  getDefaultApiUrl: () => runtime.apiUrl,
  getBuildApiUrl: () => "http://127.0.0.1:8002",
}));
vi.mock("@/lib/solar/api", async (original) => ({
  ...(await original<typeof import("@/lib/solar/api")>()),
  ...api,
}));
const A = "http://127.0.0.1:28001";
const B = "http://127.0.0.1:28002";
const sample = (id: string): Inspection => ({
  id,
  date: "2026-11-21T00:00:00Z",
  filename: `${id}.png`,
  mode: "panels",
  duration: 12,
  status: "Completed",
  result: { model: "YOLO", count: 0, detections: [], inference_ms: 12 },
});
function Probe() {
  const workspace = useWorkspace();
  return (
    <>
      <output aria-label="History IDs">
        {workspace.history.map((record) => record.id).join(",")}
      </output>
      <button onClick={() => workspace.updatePreferences({ apiUrl: B })}>Switch B</button>
      <button onClick={() => workspace.updatePreferences({ apiUrl: A })}>Switch A</button>
      <output aria-label="Ready">{String(workspace.ready)}</output>
    </>
  );
}
beforeEach(() => {
  runtime.apiUrl = A;
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  });
  api.health.mockReset().mockResolvedValue({ status: "healthy", models_loaded: true });
  api.inspectionHistory.mockReset();
  api.importHistory.mockReset().mockResolvedValue(undefined);
  localStorage.setItem(
    "solarvision-preferences",
    JSON.stringify({ apiUrl: A, theme: "dark", mode: "panels", threshold: 0.5 }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("Backend scoped inspection cache", () => {
  it.each([undefined, B])(
    "hydrates a differing runtime without mismatches, preserving saved API %s",
    async (savedApi) => {
      localStorage.clear();
      if (savedApi)
        localStorage.setItem("solarvision-preferences", JSON.stringify({ apiUrl: savedApi }));
      api.inspectionHistory.mockResolvedValue([]);
      function Connection() {
        return <output>{useWorkspace().preferences.apiUrl}</output>;
      }
      runtime.apiUrl = "http://127.0.0.1:8002";
      const serverMarkup = renderToString(
        <WorkspaceProvider>
          <Connection />
        </WorkspaceProvider>,
      );
      runtime.apiUrl = "http://127.0.0.1:18800";
      const container = document.createElement("div");
      container.innerHTML = serverMarkup;
      document.body.append(container);
      const recoverableErrors: unknown[] = [];
      let root: Root | undefined;
      try {
        await act(async () => {
          root = hydrateRoot(
            container,
            <WorkspaceProvider>
              <Connection />
            </WorkspaceProvider>,
            {
              onRecoverableError: (error) => recoverableErrors.push(error),
            },
          );
        });
        expect(container).toHaveTextContent(savedApi || "http://127.0.0.1:18800");
        expect(recoverableErrors).toEqual([]);
      } finally {
        await act(async () => root?.unmount());
        container.remove();
      }
    },
  );
  it("still displays server records when the scoped cache is invalid, without overwriting it", async () => {
    const key = `solarvision-history:v2:${encodeURIComponent(A)}`;
    const invalid = JSON.stringify([null]);
    localStorage.setItem(key, invalid);
    api.inspectionHistory.mockResolvedValue([sample("server-a")]);
    render(
      <WorkspaceProvider>
        <Probe />
      </WorkspaceProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText("History IDs")).toHaveTextContent("server-a"));
    expect(localStorage.getItem(key)).toBe(invalid);
  });
  it("preserves an unreadable destination cache while switching and still loads its server", async () => {
    const key = `solarvision-history:v2:${encodeURIComponent(B)}`;
    localStorage.setItem(key, "{invalid");
    api.inspectionHistory.mockImplementation(async (url: string) => [
      sample(url === A ? "server-a" : "server-b"),
    ]);
    render(
      <WorkspaceProvider>
        <Probe />
      </WorkspaceProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText("History IDs")).toHaveTextContent("server-a"));
    fireEvent.click(screen.getByText("Switch B"));
    await waitFor(() => expect(screen.getByLabelText("History IDs")).toHaveTextContent("server-b"));
    expect(localStorage.getItem(key)).toBe("{invalid");
  });
  it("does not copy A history into B when the saved API changes, preserving the untouched legacy cache", async () => {
    const legacy = [sample("from-a")];
    localStorage.setItem("solarvision-history", JSON.stringify(legacy));
    api.inspectionHistory.mockImplementation(async (url: string) => (url === A ? legacy : []));
    render(
      <WorkspaceProvider>
        <Probe />
      </WorkspaceProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText("History IDs")).toHaveTextContent("from-a"));
    fireEvent.click(screen.getByText("Switch B"));
    await waitFor(() => expect(api.inspectionHistory).toHaveBeenCalledWith(B));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByLabelText("History IDs")).toHaveTextContent(/^$/);
    expect(
      api.importHistory.mock.calls.filter(([url, records]) => url === B && records.length),
    ).toEqual([]);
    expect(JSON.parse(localStorage.getItem("solarvision-history") || "null")).toEqual(legacy);
    fireEvent.click(screen.getByText("Switch A"));
    await waitFor(() => expect(screen.getByLabelText("History IDs")).toHaveTextContent("from-a"));
  });
  it("loads and synchronizes only the matching backend cache", async () => {
    localStorage.setItem(
      `solarvision-history:v2:${encodeURIComponent(A)}`,
      JSON.stringify([sample("a-cache")]),
    );
    localStorage.setItem(
      `solarvision-history:v2:${encodeURIComponent(B)}`,
      JSON.stringify([sample("b-cache")]),
    );
    api.inspectionHistory.mockResolvedValue([]);
    render(
      <WorkspaceProvider>
        <Probe />
      </WorkspaceProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText("History IDs")).toHaveTextContent("a-cache"));
    fireEvent.click(screen.getByText("Switch B"));
    await waitFor(() => expect(screen.getByLabelText("History IDs")).toHaveTextContent("b-cache"));
    expect(api.importHistory).toHaveBeenCalledWith(B, [sample("b-cache")]);
    expect(
      api.importHistory.mock.calls.some(
        ([url, records]) =>
          url === B && records.some((record: Inspection) => record.id === "a-cache"),
      ),
    ).toBe(false);
  });
});
