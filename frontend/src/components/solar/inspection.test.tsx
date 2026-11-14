import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InspectionPage } from "./inspection";

const mocks = vi.hoisted(() => ({
  predict: vi.fn(),
  addInspection: vi.fn(),
  recordError: vi.fn(),
}));
vi.mock("@/lib/solar/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/solar/api")>()),
  predict: mocks.predict,
}));
vi.mock("./workspace", () => ({
  useWorkspace: () => ({
    preferences: { apiUrl: "http://127.0.0.1:8000", theme: "dark", mode: "panels", threshold: 0.5 },
    addInspection: mocks.addInspection,
    recordError: mocks.recordError,
    ready: true,
  }),
}));
beforeEach(() => {
  mocks.predict.mockReset();
  mocks.addInspection.mockReset();
  mocks.recordError.mockReset();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static override createObjectURL() {
        return "blob:inspection-test";
      }
      static override revokeObjectURL() {
        /* jsdom has no object URL storage. */
      }
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function upload(name = "farm.jpg") {
  const image = new File(["test-image-content"], name, {
    type: name.endsWith(".tif") ? "image/tiff" : "image/jpeg",
  });
  fireEvent.change(screen.getByLabelText("Upload inspection image"), {
    target: { files: [image] },
  });
  return image;
}
function analysisButton(title: string) {
  const card = screen.getByRole("heading", { name: title }).closest(".mode-card");
  if (!(card instanceof HTMLElement)) throw new Error("Analysis card missing");
  return within(card).getByRole("button", { name: "Run Analysis" });
}
describe("AI Inspection workflow", () => {
  it("runs the chosen detector, shows actual scores and timing, and saves the returned inspection", async () => {
    const result = {
      model: "YOLO11n Panel Detection",
      count: 2,
      inference_ms: 42.5,
      inspection_id: "inspection-detection",
      created_at: "2026-11-14T13:00:00Z",
      image_width: 640,
      image_height: 480,
      detections: [
        { class_id: 0, class_name: "panel", confidence: 0.91, bbox_xyxy: [10, 20, 100, 120] },
        { class_id: 0, class_name: "panel", confidence: 0.3, bbox_xyxy: [200, 20, 300, 120] },
      ],
    };
    mocks.predict.mockResolvedValue(result);
    render(<InspectionPage />);
    const file = upload();
    expect(mocks.predict).not.toHaveBeenCalled();
    fireEvent.click(analysisButton("Solar Panel Detection"));
    expect(await screen.findByText("2 detections")).toBeInTheDocument();
    expect(mocks.predict).toHaveBeenCalledWith("http://127.0.0.1:8000", "panels", file, false);
    expect(screen.getByText("1 visible at current threshold")).toBeInTheDocument();
    expect(screen.getByText("91.0%")).toBeInTheDocument();
    expect(screen.getByText("bbox_xyxy: [10, 20, 100, 120]")).toBeInTheDocument();
    expect(screen.getByText(/42.5 ms model inference/)).toHaveTextContent("s end-to-end");
    expect(mocks.addInspection).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "inspection-detection",
        filename: "farm.jpg",
        mode: "panels",
        duration: expect.any(Number),
        result,
        has_image: true,
      }),
    );
    expect(screen.getByRole("button", { name: "JSON report" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText(/Display confidence threshold/), {
      target: { value: "0.2" },
    });
    expect(screen.getByText("2 visible at current threshold")).toBeInTheDocument();
    expect(mocks.predict).toHaveBeenCalledTimes(1);
  });
  it("requires thermal confirmation and displays the classifier probability distribution", async () => {
    const probabilities = {
      "Bottom Dirt": 0.01,
      Break: 0.01,
      "Debris Cover": 0.01,
      "Junction Box Heat": 0.01,
      "Hot Cell": 0.91,
      Shadow: 0.01,
      "Short Circuit Panel": 0.01,
      "String Short Circuit": 0.01,
      "Substring Open Circuit": 0.01,
      "Healthy Panel": 0.01,
    };
    mocks.predict.mockResolvedValue({
      model: "ResNet18",
      predicted_class: "Hot Cell",
      confidence: 0.91,
      probabilities,
      inference_ms: 12.3,
      inspection_id: "thermal-inspection",
    });
    render(<InspectionPage />);
    const file = upload("thermal.tif");
    const run = analysisButton("Thermal Classification");
    expect(run).toBeDisabled();
    fireEvent.click(run);
    expect(mocks.predict).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: /I confirm this is an 8-bit PVF-10/ }));
    expect(run).toBeEnabled();
    fireEvent.click(run);
    expect(await screen.findByText("10-class probability distribution")).toBeInTheDocument();
    expect(mocks.predict).toHaveBeenCalledWith("http://127.0.0.1:8000", "classify", file, true);
    expect(screen.getByRole("heading", { name: "Hot Cell" })).toBeInTheDocument();
    expect(screen.getAllByRole("progressbar")).toHaveLength(10);
    expect(screen.getByText(/12.3 ms model inference/)).toBeInTheDocument();
    expect(mocks.addInspection).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "classify",
        result: expect.objectContaining({ probabilities }),
      }),
    );
  });
  it("shows inference errors without recording a successful inspection", async () => {
    mocks.predict.mockRejectedValue(new Error("Model unavailable."));
    render(<InspectionPage />);
    upload();
    fireEvent.click(analysisButton("Defect Detection"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Model unavailable.");
    expect(mocks.addInspection).not.toHaveBeenCalled();
    expect(mocks.recordError).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
  });
});
