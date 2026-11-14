export const labels = [
  "Bottom Dirt",
  "Break",
  "Debris Cover",
  "Junction Box Heat",
  "Hot Cell",
  "Shadow",
  "Short Circuit Panel",
  "String Short Circuit",
  "Substring Open Circuit",
  "Healthy Panel",
];
export type Mode = "panels" | "defects" | "classify";
export const modes: { id: Mode; title: string; model: string; description: string }[] = [
  {
    id: "panels",
    title: "Solar Panel Detection",
    model: "YOLO11n",
    description: "Locate individual solar panels in drone imagery.",
  },
  {
    id: "defects",
    title: "Defect Detection",
    model: "YOLO11n",
    description: "Identify potential visual defects on solar panels.",
  },
  {
    id: "classify",
    title: "Thermal Classification",
    model: "ResNet18",
    description: "Classify compatible PVF-10 thermal imagery.",
  },
];
export type Detection = {
  class_id: number;
  class_name?: string | null;
  confidence: number;
  bbox_xyxy: [number, number, number, number];
};
export type Prediction = {
  model: string;
  count?: number;
  detections?: Detection[];
  predicted_class?: string;
  confidence?: number;
  probabilities?: Record<string, number>;
  inference_ms?: number;
  image_width?: number;
  image_height?: number;
  inspection_id?: string;
  created_at?: string;
  persistence_error?: string;
};
export type Inspection = {
  id: string;
  date: string;
  filename: string;
  mode: Mode;
  duration: number;
  result: Prediction;
  status: "Completed";
  has_image?: boolean;
};
export type Preferences = {
  apiUrl: string;
  theme: "dark" | "light";
  mode: Mode;
  threshold: number;
};
export const defaultPreferences: Preferences = {
  apiUrl: import.meta.env["VITE_API_BASE_URL"] || "http://127.0.0.1:8000",
  theme: "dark",
  mode: "panels",
  threshold: 0.5,
};
export function validateFile(file: Pick<File, "name" | "size">): string | null {
  if (!/\.(jpe?g|png|tiff?)$/i.test(file.name))
    return "Choose a JPG, JPEG, PNG, TIFF, or TIF image.";
  if (file.size > 20 * 1024 * 1024) return "This image exceeds the 20 MB limit.";
  if (!file.size) return "This image is empty. Choose another file.";
  return null;
}
export function classLabel(value: string | number) {
  if (String(value).trim() === "") return "";
  return labels[Number(value)] || String(value);
}
export function visibleDetections(result: Prediction, threshold: number) {
  return (result.detections || []).filter((d) => d.confidence >= threshold);
}
export function mergeHistory(local: Inspection[], server: Inspection[]): Inspection[] {
  const records = new Map(server.map((record) => [record.id, record]));
  local.forEach((record) => records.set(record.id, { ...records.get(record.id), ...record }));
  return [...records.values()].sort((a, b) => b.date.localeCompare(a.date));
}
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function downloadJson(value: unknown, filename: string) {
  downloadBlob(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }), filename);
}
