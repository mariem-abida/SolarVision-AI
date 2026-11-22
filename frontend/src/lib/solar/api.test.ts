import { afterEach, describe, expect, it, vi } from "vitest";
import { health, normalizeApiUrl, predict, validatePrediction } from "./api";
import { mergeHistory, type Inspection } from "./domain";

afterEach(() => vi.unstubAllGlobals());

describe("FastAPI contract", () => {
  it("accepts partial per-model readiness without treating all models as loaded", async () => {
    const payload = {
      status: "degraded",
      models_loaded: false,
      models: { panels: true, defects: false, classify: true },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(payload))));
    expect(await health("http://localhost:8000")).toEqual(payload);
  });
  it("rejects malformed per-model readiness states", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: "healthy",
            models_loaded: true,
            models: { panels: true, defects: "yes", classify: true },
          }),
        ),
      ),
    );
    await expect(health("http://localhost:8000")).rejects.toThrow("model availability");
  });
  it("rejects inherited or blank predicted classes and malformed detection labels", () => {
    expect(() =>
      validatePrediction(
        {
          model: "ResNet18",
          predicted_class: "toString",
          confidence: 1,
          probabilities: { "0": 1 },
        },
        "classify",
      ),
    ).toThrow();
    expect(() =>
      validatePrediction(
        { model: "ResNet18", predicted_class: "", confidence: 1, probabilities: { "": 1 } },
        "classify",
      ),
    ).toThrow();
    expect(() =>
      validatePrediction(
        {
          model: "YOLO",
          count: 1,
          detections: [
            {
              class_id: 0,
              class_name: { invalid: true },
              confidence: 0.9,
              bbox_xyxy: [0, 0, 10, 10],
            },
          ],
        },
        "panels",
      ),
    ).toThrow();
  });
  it.each([
    { predicted_class: "Hot Cell", confidence: 0.99, probabilities: { "Healthy Panel": 1 } },
    { predicted_class: "0", confidence: 0.9, probabilities: { "0": 0.1, "1": 0.9 } },
    { predicted_class: "0", confidence: 0.9, probabilities: { "0": 0.9, "1": 0.9 } },
    { predicted_class: "0", confidence: 0.8, probabilities: { "0": 0.9, "1": 0.1 } },
  ])("rejects contradictory classification probabilities %#", (result) => {
    expect(() => validatePrediction({ model: "ResNet18", ...result }, "classify")).toThrow();
  });
  it.each([
    { bbox: [-1, 0, 20, 30], width: 100, height: 100 },
    { bbox: [0, 0, 200, 300], width: 100, height: 100 },
    { bbox: [0, 0, 0, 30], width: 100, height: 100 },
    { bbox: [0, 0, 20, 30], width: 0, height: 100 },
    { bbox: [0, 0, 20, 30], width: 100.1, height: 100 },
    { bbox: [0, 0, 20, 30], width: 100, height: undefined },
  ])("rejects invalid coordinates or image dimensions %#", ({ bbox, width, height }) => {
    expect(() =>
      validatePrediction(
        {
          model: "YOLO",
          count: 1,
          image_width: width,
          image_height: height,
          detections: [{ class_id: 0, confidence: 0.9, bbox_xyxy: bbox }],
        },
        "panels",
      ),
    ).toThrow();
  });
  it("accepts rounded thermal probabilities and bounded detector output", () => {
    const result = {
      model: "ResNet18",
      predicted_class: "0",
      confidence: 0.9778,
      probabilities: {
        "0": 0.9778,
        "1": 0.0001,
        "2": 0.0005,
        "3": 0.0001,
        "4": 0.0067,
        "5": 0.0002,
        "6": 0.0001,
        "7": 0.0001,
        "8": 0,
        "9": 0.0144,
      },
    };
    expect(validatePrediction(result, "classify")).toEqual(result);
    expect(() =>
      validatePrediction(
        {
          model: "YOLO",
          count: 1,
          image_width: 100,
          image_height: 100,
          detections: [{ class_id: 0, confidence: 0.9, bbox_xyxy: [0, 0, 100, 100] }],
        },
        "panels",
      ),
    ).not.toThrow();
  });
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
          image_width: 52,
          image_height: 68,
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
