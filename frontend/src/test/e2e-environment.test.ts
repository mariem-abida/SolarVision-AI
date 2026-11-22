import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";
import { localE2EEnvironment, localServiceUrl } from "../../e2e/support/environment";
import { prepareE2EFixtures } from "../../scripts/prepare-e2e-fixtures";

describe("local model E2E boundaries", () => {
  it("requires explicit opt-in before a model suite can use any service", () => {
    expect(() => localE2EEnvironment({})).toThrow("opt-in");
    expect(() => localE2EEnvironment({ SOLARVISION_E2E_ALLOW_MODEL_WRITES: "true" })).toThrow(
      "opt-in",
    );
  });

  it.each([
    "http://127.0.0.1:18000",
    "http://localhost:18800",
    "https://127.0.0.1:18800",
    "http://user:secret@127.0.0.1:18800",
    "http://127.0.0.1:18800/predict",
    "http://127.0.0.1:18800?target=18000",
    "http://127.0.0.1:18800#fragment",
    "http://example.com:18800",
  ])("rejects a non-isolated model target %s", (url) => {
    expect(() => localServiceUrl(url, ["18800", "18802"], "Model API")).toThrow();
  });

  it("keeps each role on its isolated ports and supports local image overrides", () => {
    const config = localE2EEnvironment({
      SOLARVISION_E2E_ALLOW_MODEL_WRITES: "1",
      SOLARVISION_E2E_BASE_URL: "http://127.0.0.1:8182/",
      SOLARVISION_E2E_API_URL: "http://127.0.0.1:18802/",
      SOLARVISION_E2E_PANEL_IMAGE: "fixtures/custom.jpg",
      SOLARVISION_E2E_FIXTURE_DIR: "fixtures/generated",
    });
    expect(config.baseURL).toBe("http://127.0.0.1:8182");
    expect(config.api).toBe("http://127.0.0.1:18802");
    expect(config.otherApi).toBe("http://127.0.0.1:18801");
    expect(config.legacyApi).toBe("http://127.0.0.1:18803");
    expect(config.panelImage).toBe(resolve("fixtures/custom.jpg"));
    expect(config.highresImage).toBe(resolve("fixtures/generated/panel-3000.png"));
    expect(config.artifacts).not.toContain("reports");
    expect(() =>
      localE2EEnvironment({
        SOLARVISION_E2E_ALLOW_MODEL_WRITES: "1",
        SOLARVISION_E2E_LEGACY_API_URL: "http://127.0.0.1:18000",
      }),
    ).toThrow("Legacy API");
  });
});

describe("generated frontend E2E images", () => {
  it("creates valid PNG pixels, a baseline TIFF and a payload above20MB without private data", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "solarvision-e2e-fixtures-"));
    try {
      prepareE2EFixtures(directory);
      const png = readFileSync(resolve(directory, "panel-3000.png"));
      expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      expect(png.readUInt32BE(16)).toBe(3000);
      expect(png.readUInt32BE(20)).toBe(2400);
      const compressedLength = png.readUInt32BE(33);
      expect(png.toString("ascii", 37, 41)).toBe("IDAT");
      const pixels = inflateSync(png.subarray(41, 41 + compressedLength));
      expect(pixels.length).toBe((3000 * 3 + 1) * 2400);
      expect([...pixels.subarray(1, 7)]).toEqual([0, 0, 0, 1, 0, 1]);
      const tiff = readFileSync(resolve(directory, "panel.tiff"));
      expect(tiff.subarray(0, 4)).toEqual(Buffer.from([73, 73, 42, 0]));
      expect(tiff.readUInt16LE(8)).toBe(9);
      expect(tiff.readUInt32LE(18)).toBe(32);
      expect(statSync(resolve(directory, "over20MB.png")).size).toBe(20 * 1024 * 1024 + 1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
