import { afterEach, describe, expect, it, vi } from "vitest";
import { getBuildApiUrl, getDefaultApiUrl, publicApiUrl } from "./runtime-config";
import { runtimeConfigResponse } from "./runtime-config-server";

afterEach(() => {
  delete window.__SOLARVISION_CONFIG__;
  vi.unstubAllEnvs();
});

describe("public API configuration", () => {
  it("lets the runtime choose the Kubernetes browser URL over an old build default", () => {
    vi.stubEnv("VITE_API_BASE_URL", "http://127.0.0.1:8002");
    window.__SOLARVISION_CONFIG__ = { apiBaseUrl: "http://127.0.0.1:18000/" };
    expect(getDefaultApiUrl()).toBe("http://127.0.0.1:18000");
    expect(getBuildApiUrl()).toBe("http://127.0.0.1:8002");
  });

  it("supports another runtime and the development build fallback", () => {
    vi.stubEnv("VITE_API_BASE_URL", "http://127.0.0.1:8000");
    expect(getDefaultApiUrl()).toBe("http://127.0.0.1:8000");
    window.__SOLARVISION_CONFIG__ = { apiBaseUrl: "https://solar.example/api/" };
    expect(getDefaultApiUrl()).toBe("https://solar.example/api");
  });

  it.each([
    "javascript:alert(1)",
    "http://user:secret@example.test",
    "https://example.test/?token=secret",
    "https://example.test/#secret",
    "not-a-url",
  ])("rejects unsafe public URL %s", (value) => {
    expect(publicApiUrl(value)).toBeUndefined();
  });

  it("serves current public configuration without caching or exposing an invalid value", async () => {
    const response = runtimeConfigResponse("http://127.0.0.1:18000");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toContain('"apiBaseUrl":"http://127.0.0.1:18000"');
    const rejected = runtimeConfigResponse("http://user:secret@example.test");
    expect(rejected.status).toBe(503);
    expect(await rejected.text()).not.toContain("secret");
    expect(await runtimeConfigResponse(undefined).text()).toContain(" = {};");
  });
});
