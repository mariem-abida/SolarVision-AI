import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Inspection } from "@/lib/solar/domain";
import { HistoryPage } from "@/components/solar/history-page";
import { HistoryTable } from "@/components/solar/history-table";

const state = vi.hoisted(() => ({
  history: [] as Inspection[],
  historyError: null as string | null,
  preferences: { apiUrl: "http://127.0.0.1:8000" },
  download: vi.fn(),
}));

vi.mock("@/components/solar/workspace", () => ({ useWorkspace: () => state }));
vi.mock("@/lib/solar/domain", async (original) => ({
  ...(await original<typeof import("@/lib/solar/domain")>()),
  downloadJson: state.download,
}));

const detection: Inspection = {
  id: "retained-panel",
  date: "2026-11-14T12:00:00Z",
  filename: "panel.png",
  mode: "panels",
  duration: 100,
  status: "Completed",
  has_image: true,
  result: {
    model: "YOLO11n Panel Detection",
    count: 1,
    inference_ms: 42,
    image_width: 400,
    image_height: 200,
    detections: [
      { class_id: 0, class_name: "panel", confidence: 0.9, bbox_xyxy: [10, 20, 100, 150] },
    ],
  },
};
const classification: Inspection = {
  id: "legacy-thermal",
  date: "2026-11-13T12:00:00Z",
  filename: "thermal.png",
  mode: "classify",
  duration: 90,
  status: "Completed",
  result: {
    model: "ResNet18",
    predicted_class: "healthy panel",
    confidence: 0.8,
    probabilities: { "healthy panel": 0.8, break: 0.2 },
  },
};

afterEach(() => {
  cleanup();
  state.history = [];
  state.historyError = null;
  state.download.mockReset();
});

describe("Inspection history", () => {
  it("consults retained previews and scales boxes using original image coordinates", () => {
    render(<HistoryTable records={[detection]} />);
    fireEvent.click(screen.getByRole("button", { name: "View panel.png" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("img")).toHaveAttribute(
      "src",
      "http://127.0.0.1:8000/inspections/retained-panel/image",
    );
    expect(within(dialog).getByLabelText("Retained detection bounding boxes")).toHaveAttribute(
      "viewBox",
      "0 0 400 200",
    );
    expect(within(dialog).getByText(/42.0 ms model inference/)).toBeInTheDocument();
    expect(within(dialog).getByText(/bbox_xyxy: \[10.0, 20.0, 100.0, 150.0\]/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Original preview" }));
    expect(
      within(dialog).queryByLabelText("Retained detection bounding boxes"),
    ).not.toBeInTheDocument();
    fireEvent.error(within(dialog).getByRole("img"));
    expect(within(dialog).getByText(/retained preview is unavailable/)).toBeInTheDocument();
  });

  it("keeps legacy metadata consultable without inventing a retained image", () => {
    render(<HistoryTable records={[classification]} />);
    fireEvent.click(screen.getByRole("button", { name: "View thermal.png" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByRole("img")).not.toBeInTheDocument();
    expect(within(dialog).getByText(/No image was retained/)).toBeInTheDocument();
    expect(within(dialog).getByText("80.00% confidence")).toBeInTheDocument();
    expect(within(dialog).getByRole("progressbar", { name: "break probability" })).toHaveAttribute(
      "value",
      "0.2",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Download JSON" }));
    expect(state.download).toHaveBeenCalledWith(classification, "legacy-thermal.json");
  });

  it("searches detection class names and exports the filtered records", () => {
    state.history = [detection, classification];
    state.historyError = "Connection failed";
    render(<HistoryPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("Local records are preserved");
    fireEvent.change(screen.getByRole("textbox", { name: "Search inspections" }), {
      target: { value: "YOLO11n" },
    });
    expect(screen.getByText("1 of 2 inspections")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Export filtered results" }));
    expect(state.download).toHaveBeenCalledWith([detection], "solarvision-history.json");
    fireEvent.change(screen.getByRole("textbox", { name: "Search inspections" }), {
      target: { value: "bottom dirt" },
    });
    expect(screen.getByText("0 of 2 inspections")).toBeInTheDocument();
  });
});
