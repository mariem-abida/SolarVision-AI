import { describe, expect, it } from "vitest";
import { historyStorageKey, inspectionTiming, mergeHistory, type Inspection } from "./domain";

const legacy: Inspection = {
  id: "legacy",
  date: "2026-11-20T12:00:00Z",
  filename: "old.png",
  mode: "panels",
  status: "Completed",
  duration: 420,
  result: { model: "YOLO", count: 0, detections: [] },
};
describe("Inspection provenance", () => {
  it("keeps legacy records unchanged and never mislabels their ambiguous duration", () => {
    const original = JSON.stringify(legacy);
    expect(inspectionTiming(legacy)).toBe("420.0 ms legacy duration (measurement source unknown)");
    expect(mergeHistory([legacy], [])).toEqual([legacy]);
    expect(JSON.stringify(legacy)).toBe(original);
  });
  it("distinguishes model, server, and browser measurements", () => {
    expect(
      inspectionTiming({
        ...legacy,
        duration: 12,
        request_duration_ms: 45,
        client_duration_ms: 110,
        result: { ...legacy.result, inference_ms: 12, request_duration_ms: 45 },
      }),
    ).toBe("12.0 ms model inference · 45.0 ms server processing · 0.11 s browser end-to-end");
  });
  it("normalizes equivalent URLs but separates different backend paths and ports", () => {
    expect(historyStorageKey("http://LOCALHOST:28001///")).toBe(
      historyStorageKey("http://localhost:28001"),
    );
    expect(historyStorageKey("http://localhost:28001")).not.toBe(
      historyStorageKey("http://localhost:28002"),
    );
    expect(historyStorageKey("http://localhost:28001/a")).not.toBe(
      historyStorageKey("http://localhost:28001/b"),
    );
  });
});
