import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const frontendDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function localServiceUrl(value: string, ports: readonly string[], name: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !ports.includes(url.port) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${name} must use http://127.0.0.1 on isolated port ${ports.join("/")}.`);
  }
  return url.origin;
}

export function localE2EEnvironment(env: NodeJS.ProcessEnv = process.env) {
  if (env["SOLARVISION_E2E_ALLOW_MODEL_WRITES"] !== "1") {
    throw new Error(
      "Model E2E are opt-in: set SOLARVISION_E2E_ALLOW_MODEL_WRITES=1 only for disposable APIs. See E2E.md. Unit CI uses test:ci.",
    );
  }
  const repository = resolve(frontendDirectory, "..");
  const fixtures = resolve(
    env["SOLARVISION_E2E_FIXTURE_DIR"] || resolve(frontendDirectory, ".e2e-local/fixtures"),
  );
  return {
    baseURL: localServiceUrl(
      env["SOLARVISION_E2E_BASE_URL"] || "http://127.0.0.1:8181",
      ["8181", "8182"],
      "Frontend",
    ),
    api: localServiceUrl(
      env["SOLARVISION_E2E_API_URL"] || "http://127.0.0.1:18800",
      ["18800", "18802"],
      "Model API",
    ),
    otherApi: localServiceUrl(
      env["SOLARVISION_E2E_OTHER_API_URL"] || "http://127.0.0.1:18801",
      ["18801"],
      "Empty API",
    ),
    legacyApi: localServiceUrl(
      env["SOLARVISION_E2E_LEGACY_API_URL"] || "http://127.0.0.1:18803",
      ["18803"],
      "Legacy API",
    ),
    artifacts: resolve(
      env["SOLARVISION_E2E_ARTIFACT_DIR"] || resolve(frontendDirectory, ".e2e-local/artifacts"),
    ),
    panelImage: resolve(
      env["SOLARVISION_E2E_PANEL_IMAGE"] ||
        resolve(
          repository,
          "data/raw/panel_detection/test/images/DJI_20230213153545_0028_T_JPG.rf.2e6811dc7efbb66d491177c8ef91ab9e.jpg",
        ),
    ),
    defectImage: resolve(
      env["SOLARVISION_E2E_DEFECT_IMAGE"] ||
        resolve(
          repository,
          "data/raw/defect_detection/test/images/1_mix_v1i_133_jpg.rf.45e209d96eede30bfe2f713f9fcb613a.jpg",
        ),
    ),
    classifyImage: resolve(
      env["SOLARVISION_E2E_CLASSIFY_IMAGE"] ||
        resolve(
          repository,
          "data/processed/pvf10_grouped/test/0/DJI_20230222131634_0660_T_000008.tif",
        ),
    ),
    highresImage: resolve(fixtures, "panel-3000.png"),
    tiffImage: resolve(fixtures, "panel.tiff"),
    oversizedImage: resolve(fixtures, "over20MB.png"),
  };
}
