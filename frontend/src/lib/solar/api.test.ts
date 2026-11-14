import { afterEach, describe, expect, it, vi } from "vitest";
import { health, normalizeApiUrl, predict, validatePrediction } from "./api";
import { mergeHistory, type Inspection } from "./domain";

afterEach(() => vi.unstubAllGlobals());

describe("FastAPI contract", () => {
  it("normalizes URLs and rejects credentials or query strings", () => {
    expect(normalizeApiUrl(" http://localhost:8000/ ")).toBe("http://localhost:8000");
    expect(() => normalizeApiUrl("http://user:secret@localhost")).toThrow();
    expect(() => normalizeApiUrl("http://localhost?token=secret")).toThrow();
  });
  it("validates complete detection coordinates, classes and probabilities", () => {
    expect(() =>
      validatePrediction(
        {
          model: "YOLO",
          count: 1,
          detections: [{ class_id: 0, confidence: 2, bbox_xyxy: [0, 0, 1, 1] }],
        },
        "panels",
      ),
    ).toThrow();
    expect(() =>
      validatePrediction(
        {
          model: "YOLO",
          count: 0,
          detections: [{ class_id: 0, confidence: 0.5, bbox_xyxy: [0, 0, 1, 1] }],
        },
        "defects",
      ),
    ).toThrow();
    expect(() =>
      validatePrediction(
        { model: "ResNet18", predicted_class: "9", confidence: 0.9, probabilities: { 9: NaN } },
        "classify",
      ),
    ).toThrow();
  });
  it("surfaces the actual API error detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ detail: "Models unavailable" }), { status: 503 }),
        ),
    );
    await expect(health("http://localhost:8000")).rejects.toThrow("Models unavailable");
  });
  it("uploads thermal consent using multipart without forcing Content-Type", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "ResNet18",
          predicted_class: "9",
          confidence: 1,
          probabilities: { 9: 1 },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await predict("http://localhost:8000", "classify", new File(["image"], "thermal.tif"), true);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.body as FormData).get("thermal_confirmed")).toBe("true");
    expect(init.headers).toBeUndefined();
  });
  it("keeps existing local inspections when merging server history", () => {
    const local: Inspection = {
      id: "local",
      date: "2026-11-14",
      filename: "local.png",
      mode: "panels",
      duration: 5,
      result: { model: "YOLO", count: 0, detections: [] },
      status: "Completed",
    };
    const remote = { ...local, id: "remote" };
    expect(
      mergeHistory([local], [remote, local])
        .map((record) => record.id)
        .sort(),
    ).toEqual(["local", "remote"]);
  });
});
