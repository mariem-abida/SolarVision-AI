import type { Inspection, Mode, Prediction } from "./domain";

export function normalizeApiUrl(value: string): string {
  const url = new URL(value.trim());
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Enter an HTTP or HTTPS API URL without credentials, query parameters, or a fragment.",
    );
  return url.toString().replace(/\/+$/, "");
}

export async function request(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const url = normalizeApiUrl(baseUrl);
  const response = await fetch(`${url}${path}`, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(path === "/health" ? 8000 : 120000),
  }).catch((error: unknown) => {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError"))
      throw new Error("The service took too long to respond. Please try again.");
    throw new Error(
      "Cannot reach the FastAPI service. Check the API URL, make sure your server is running, and allow this site in its CORS settings.",
    );
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail =
      data && typeof data === "object" && "detail" in data && typeof data.detail === "string"
        ? data.detail
        : `The service returned an error (${response.status}).`;
    throw new Error(detail);
  }
  if (!data || typeof data !== "object")
    throw new Error("The service returned an invalid JSON response.");
  return data;
}

export type Health = {
  status: string;
  models_loaded: boolean;
  device?: string;
  models?: Record<Mode, boolean>;
  explanation?: string | null;
};
export async function health(baseUrl: string): Promise<Health> {
  const data = await request(baseUrl, "/health");
  if (
    !data ||
    typeof data !== "object" ||
    !("status" in data) ||
    typeof data.status !== "string" ||
    !("models_loaded" in data) ||
    typeof data.models_loaded !== "boolean"
  )
    throw new Error("The health response does not match the expected API format.");
  return data as Health;
}

const probability = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
export function validatePrediction(data: unknown, mode: Mode): Prediction {
  if (!data || typeof data !== "object" || !("model" in data) || typeof data.model !== "string")
    throw new Error("The prediction response is missing its model name.");
  if (mode === "classify") {
    if (
      !("predicted_class" in data) ||
      typeof data.predicted_class !== "string" ||
      !("confidence" in data) ||
      !probability(data.confidence) ||
      !("probabilities" in data) ||
      !data.probabilities ||
      typeof data.probabilities !== "object" ||
      Array.isArray(data.probabilities) ||
      !Object.keys(data.probabilities).length ||
      !Object.values(data.probabilities).every(probability)
    )
      throw new Error("The classification response is incomplete or has invalid probabilities.");
  } else if (
    !("detections" in data) ||
    !Array.isArray(data.detections) ||
    !("count" in data) ||
    !Number.isInteger(data.count) ||
    data.count !== data.detections.length ||
    data.detections.some((d: unknown) => {
      if (
        !d ||
        typeof d !== "object" ||
        !("class_id" in d) ||
        !Number.isInteger(d.class_id) ||
        !("confidence" in d) ||
        !probability(d.confidence) ||
        !("bbox_xyxy" in d) ||
        !Array.isArray(d.bbox_xyxy) ||
        d.bbox_xyxy.length !== 4 ||
        !d.bbox_xyxy.every((n: unknown) => typeof n === "number" && Number.isFinite(n))
      )
        return true;
      return d.bbox_xyxy[2] < d.bbox_xyxy[0] || d.bbox_xyxy[3] < d.bbox_xyxy[1];
    })
  )
    throw new Error("The detection response is incomplete or has invalid bounding boxes.");
  return data as Prediction;
}

export async function predict(
  baseUrl: string,
  mode: Mode,
  file: File,
  thermalConfirmed = false,
): Promise<Prediction> {
  const form = new FormData();
  form.append("file", file);
  if (mode === "classify") form.append("thermal_confirmed", String(thermalConfirmed));
  return validatePrediction(
    await request(baseUrl, `/predict/${mode}`, { method: "POST", body: form }),
    mode,
  );
}

export async function inspectionHistory(baseUrl: string): Promise<Inspection[]> {
  const records: Inspection[] = [];
  let total = 0;
  do {
    const data = await request(baseUrl, `/inspections?limit=500&offset=${records.length}`);
    if (
      !data ||
      typeof data !== "object" ||
      !("records" in data) ||
      !Array.isArray(data.records) ||
      !("total" in data) ||
      typeof data.total !== "number"
    )
      throw new Error("Invalid inspection history response.");
    if (!data.records.length) break;
    records.push(...(data.records as Inspection[]));
    total = data.total;
  } while (records.length < total);
  return records;
}

export async function importHistory(baseUrl: string, records: Inspection[]) {
  for (let offset = 0; offset < records.length; offset += 100)
    await request(baseUrl, "/inspections/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ records: records.slice(offset, offset + 100) }),
    });
}

export function inspectionImageUrl(baseUrl: string, id: string): string {
  return `${normalizeApiUrl(baseUrl)}/inspections/${encodeURIComponent(id)}/image`;
}
