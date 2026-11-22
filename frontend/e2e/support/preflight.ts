import { stat } from "node:fs/promises";
import { localE2EEnvironment } from "./environment";

/** Read-only setup: never starts models, imports records, deletes data or makes predictions. */
export default async function preflight() {
  const config = localE2EEnvironment();
  for (const key of [
    "panelImage",
    "defectImage",
    "classifyImage",
    "highresImage",
    "tiffImage",
    "oversizedImage",
  ] as const) {
    const path = config[key];
    const file = await stat(path).catch(() => undefined);
    if (!file?.isFile() || !file.size) {
      throw new Error(
        `Missing ${key}: ${path}. Run test:e2e:prepare and configure local images; see E2E.md.`,
      );
    }
  }
  for (const [url, expected] of [
    [config.api, 200],
    [config.otherApi, 503],
    [config.legacyApi, 503],
  ] as const) {
    const response = await fetch(`${url}/ready`, { signal: AbortSignal.timeout(10000) });
    if (response.status !== expected)
      throw new Error(`${url}/ready must return ${expected}, got ${response.status}. See E2E.md.`);
  }
  for (const url of [config.otherApi, config.legacyApi]) {
    const response = await fetch(`${url}/inspections?limit=1`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok || (await response.json()).total !== 0)
      throw new Error(`${url} must have a fresh empty disposable history. No data was changed.`);
  }
  const runtime = await fetch(`${config.baseURL}/solarvision-config.js`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!runtime.ok || !(await runtime.text()).includes(JSON.stringify(config.api)))
    throw new Error(`The isolated frontend runtime API must be ${config.api}; see E2E.md.`);
}
