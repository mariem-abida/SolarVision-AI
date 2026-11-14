import { afterEach, describe, expect, it, vi } from "vitest";
import { dashboardSchema, monitoringSchema, percentage, readDashboard } from "./dashboard";
const emptyDashboard = {
  generated_at: "2026-11-14T12:00:00+00:00",
  evaluations: [],
  datasets: [],
  mlops: {
    dvc: {
      status: "not_configured",
      tracked_datasets: 0,
      remote_configured: false,
      explanation: "Not configured",
    },
    mlflow: {
      status: "not_configured",
      source: "mlflow.db",
      experiments: [],
      runs: [],
      registry: [],
      explanation: "Not configured",
    },
    checkpoints: [],
    training_runs: [],
    ci: { configured: false, source: ".github/workflows/ci.yml", explanation: "Not configured" },
  },
};
afterEach(() => vi.unstubAllGlobals());
describe("Read-only dashboard API", () => {
  it("uses the saved API base and accepts explicit unavailable metadata", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(emptyDashboard), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const result = await readDashboard("http://localhost:8000///", "/dashboard", dashboardSchema);
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8000/dashboard",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result.mlops.mlflow.status).toBe("not_configured");
    expect(result.evaluations).toEqual([]);
  });
  it("rejects a malformed response instead of displaying made-up fallback values", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ generated_at: "today" }), { status: 200 }),
        ),
    );
    await expect(
      readDashboard("http://localhost:8000", "/dashboard", dashboardSchema),
    ).rejects.toThrow("does not match");
  });
  it("reports HTTP errors from an API without dashboard endpoints", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));
    await expect(
      readDashboard("http://localhost:8000", "/dashboard", dashboardSchema),
    ).rejects.toThrow("HTTP 404");
  });
  it("reports network failures without using cached demo metadata", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(
      readDashboard("http://localhost:8000", "/dashboard", dashboardSchema),
    ).rejects.toThrow("Cannot reach");
  });
  it("accepts unavailable hardware and distinguishes request success from external uptime", () => {
    const parsed = monitoringSchema.parse({
      generated_at: "2026-11-14T12:00:00+00:00",
      uptime_seconds: 1,
      requests: {
        total: 0,
        errors: 0,
        server_errors: 0,
        inference_requests: 0,
        inference_errors: 0,
        average_latency_ms: null,
        uptime_availability_percent: null,
        requests_per_minute: 0,
        endpoints: [],
        recent: [],
      },
      hardware: { cpu_percent: null, ram: null, gpus: [], explanation: "Collector unavailable" },
    });
    expect(parsed.requests.uptime_availability_percent).toBeNull();
    expect(parsed.hardware.gpus).toEqual([]);
  });
  it("keeps absent evaluation scores unavailable and displays ratio metrics as percentages", () => {
    expect(percentage(undefined)).toBe("Unavailable");
    expect(percentage(0)).toBe("0.00%");
    expect(percentage(0.9)).toBe("90.00%");
  });
});
