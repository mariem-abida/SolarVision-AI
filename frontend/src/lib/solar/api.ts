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
  if (
    "models" in data &&
    (!data.models ||
      typeof data.models !== "object" ||
      !["panels", "defects", "classify"].every(
        (name) => typeof (data.models as Record<string, unknown>)[name] === "boolean",
      ))
  )
    throw new Error("The health response has invalid model availability states.");
  return data as Health;
}

const probability = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
export function validatePrediction(data: unknown, mode: Mode): Prediction {
  if (
    !data ||
    typeof data !== "object" ||
    !("model" in data) ||
    typeof data.model !== "string" ||
    !data.model.trim()
  )
    throw new Error("The prediction response is missing its model name.");
  const result = data as Record<string, unknown>;
  const width = result["image_width"];
  const height = result["image_height"];
  if (
    (width !== undefined || height !== undefined) &&
    (!Number.isInteger(width) ||
      !Number.isInteger(height) ||
      Number(width) <= 0 ||
      Number(height) <= 0)
  )
    throw new Error("The prediction response has invalid image dimensions.");
  for (const key of ["inference_ms", "request_duration_ms"])
    if (
      result[key] !== undefined &&
      (typeof result[key] !== "number" || !Number.isFinite(result[key]) || result[key] < 0)
    )
      throw new Error("The prediction response has an invalid processing time.");
  if (mode === "classify") {
    if (
      !("predicted_class" in data) ||
      typeof data.predicted_class !== "string" ||
      !data.predicted_class.trim() ||
      !("confidence" in data) ||
      !probability(data.confidence) ||
      !("probabilities" in data) ||
      !data.probabilities ||
      typeof data.probabilities !== "object" ||
      Array.isArray(data.probabilities) ||
      !Object.keys(data.probabilities).length ||
      !Object.values(data.probabilities).every(probability) ||
      result["detections"] !== undefined ||
      result["count"] !== undefined
    )
      throw new Error("The classification response is incomplete or has invalid probabilities.");
    const probabilities = data.probabilities as Record<string, number>;
    const selected = probabilities[data.predicted_class];
    const values = Object.values(probabilities);
    if (
      !Object.prototype.hasOwnProperty.call(probabilities, data.predicted_class) ||
      selected === undefined ||
      Math.abs(selected - data.confidence) > 0.0002 ||
      Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) > 0.002 ||
      selected + 0.0002 < Math.max(...values)
    )
      throw new Error(
        "The predicted class, confidence, and probability distribution are inconsistent.",
      );
  } else if (
    !("detections" in data) ||
    !Array.isArray(data.detections) ||
    !("count" in data) ||
    !Number.isInteger(data.count) ||
    data.count !== data.detections.length ||
    ["predicted_class", "confidence", "probabilities"].some((key) => result[key] !== undefined) ||
    data.detections.some((d: unknown) => {
      if (
        !d ||
        typeof d !== "object" ||
        !("class_id" in d) ||
        !Number.isInteger(d.class_id) ||
        Number(d.class_id) < 0 ||
        ("class_name" in d &&
          d.class_name !== null &&
          d.class_name !== undefined &&
          typeof d.class_name !== "string") ||
        !("confidence" in d) ||
        !probability(d.confidence) ||
        !("bbox_xyxy" in d) ||
        !Array.isArray(d.bbox_xyxy) ||
        d.bbox_xyxy.length !== 4 ||
        !d.bbox_xyxy.every((n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0)
      )
        return true;
      return (
        d.bbox_xyxy[2] <= d.bbox_xyxy[0] ||
        d.bbox_xyxy[3] <= d.bbox_xyxy[1] ||
        (typeof width === "number" && d.bbox_xyxy[2] > width + 0.01) ||
        (typeof height === "number" && d.bbox_xyxy[3] > height + 0.01)
      );
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
  const result = validatePrediction(
    await request(baseUrl, `/predict/${mode}`, { method: "POST", body: form }),
    mode,
  );
  if (result.image_width === undefined || result.image_height === undefined)
    throw new Error("The prediction response is missing its image dimensions.");
  return result;
}

export function validateInspection(value: unknown): Inspection {
  if (!value || typeof value !== "object") throw new Error("Invalid inspection record.");
  const record = value as Record<string, unknown>;
  if (
    typeof record["id"] !== "string" ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(record["id"]) ||
    typeof record["filename"] !== "string" ||
    typeof record["date"] !== "string" ||
    !Number.isFinite(Date.parse(record["date"])) ||
    !["panels", "defects", "classify"].includes(String(record["mode"])) ||
    record["status"] !== "Completed" ||
    typeof record["duration"] !== "number" ||
    !Number.isFinite(record["duration"]) ||
    record["duration"] < 0
  )
    throw new Error("Invalid inspection history record.");
  for (const key of ["client_duration_ms", "request_duration_ms"])
    if (
      record[key] !== undefined &&
      (typeof record[key] !== "number" || !Number.isFinite(record[key]) || record[key] < 0)
    )
      throw new Error("Invalid inspection timing.");
  validatePrediction(record["result"], record["mode"] as Mode);
  return value as Inspection;
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
    records.push(...data.records.map(validateInspection));
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
