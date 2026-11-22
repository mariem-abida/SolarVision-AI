import { stat } from "node:fs/promises";
import preflight from "../../e2e/support/preflight";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  const mockedStat = vi.fn();
  return { ...original, stat: mockedStat, default: { ...original, stat: mockedStat } };
});

describe("read-only local model preflight", () => {
  const api = "http://127.0.0.1:18800";
  let historyTotal: number;
  let runtimeApi: string;
  let requests: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    historyTotal = 0;
    runtimeApi = api;
    requests = [];
    vi.stubEnv("SOLARVISION_E2E_ALLOW_MODEL_WRITES", "1");
    vi.stubEnv("SOLARVISION_E2E_BASE_URL", "http://127.0.0.1:8181");
    vi.stubEnv("SOLARVISION_E2E_API_URL", api);
    vi.stubEnv("SOLARVISION_E2E_OTHER_API_URL", "http://127.0.0.1:18801");
    vi.stubEnv("SOLARVISION_E2E_LEGACY_API_URL", "http://127.0.0.1:18803");
    vi.mocked(stat).mockResolvedValue({ isFile: () => true, size: 32 } as Awaited<
      ReturnType<typeof stat>
    >);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options: RequestInit) => {
        expect(options.method ?? "GET").toBe("GET");
        requests.push(url);
        return {
          ok: true,
          status: url.endsWith("/ready") && !url.startsWith(api) ? 503 : 200,
          json: async () => ({ total: historyTotal }),
          text: async () => JSON.stringify({ apiBaseUrl: runtimeApi }),
        };
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("performs only six GETs after checking all six local images", async () => {
    await preflight();
    expect(stat).toHaveBeenCalledTimes(6);
    expect(requests).toHaveLength(6);
    expect(requests.every((url) => !url.includes("/predict") && !url.includes("/import"))).toBe(
      true,
    );
  });

  it("fails a missing image before contacting any service", async () => {
    vi.mocked(stat).mockRejectedValueOnce(new Error("missing"));
    await expect(preflight()).rejects.toThrow("Missing panelImage");
    expect(requests).toEqual([]);
  });

  it("rejects a reused fixture database without changing it", async () => {
    historyTotal = 1;
    await expect(preflight()).rejects.toThrow("fresh empty disposable history");
    expect(requests).toHaveLength(4);
  });

  it("rejects a frontend configured for a different API", async () => {
    runtimeApi = "http://127.0.0.1:18000";
    await expect(preflight()).rejects.toThrow("isolated frontend runtime API");
  });

  it("rejects absent opt-in before accessing files or services", async () => {
    vi.stubEnv("SOLARVISION_E2E_ALLOW_MODEL_WRITES", "");
    await expect(preflight()).rejects.toThrow("opt-in");
    expect(requests).toEqual([]);
    expect(stat).not.toHaveBeenCalled();
  });
});
