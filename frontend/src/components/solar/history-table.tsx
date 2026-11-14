import { useState } from "react";
import { FileImage, Download, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { inspectionImageUrl } from "@/lib/solar/api";
import { classLabel, downloadJson, modes, type Inspection } from "@/lib/solar/domain";
import { useWorkspace } from "./workspace";
import { Badge, EmptyState } from "./common";

function RetainedPreview({ inspection }: { inspection: Inspection }) {
  const { preferences } = useWorkspace();
  const [failed, setFailed] = useState(false);
  const [annotated, setAnnotated] = useState(true);
  const { result } = inspection;
  const detections = result.detections ?? [];
  const width = result.image_width;
  const height = result.image_height;
  const canAnnotate = detections.length > 0 && !!width && !!height;

  if (!inspection.has_image)
    return (
      <div className="notice my-4">
        <FileImage size={15} />
        <span>
          No image was retained for this record. Legacy browser records contain prediction metadata
          only.
        </span>
      </div>
    );
  if (failed)
    return (
      <div role="status" className="notice my-4">
        <FileImage size={15} />
        <span>
          The retained preview is unavailable from the configured API. The prediction details remain
          available below.
        </span>
      </div>
    );

  return (
    <>
      {canAnnotate && (
        <div className="inline-actions mt-4">
          <Button
            size="sm"
            variant={annotated ? "secondary" : "ghost"}
            onClick={() => setAnnotated(true)}
          >
            Annotated
          </Button>
          <Button
            size="sm"
            variant={!annotated ? "secondary" : "ghost"}
            onClick={() => setAnnotated(false)}
          >
            Original preview
          </Button>
        </div>
      )}
      <div className="image-stage my-4">
        <div className="relative inline-block max-w-full">
          <img
            src={inspectionImageUrl(preferences.apiUrl, inspection.id)}
            alt={`Retained inspection preview for ${inspection.filename}`}
            onError={() => setFailed(true)}
          />
          {annotated && canAnnotate && (
            <svg
              className="pointer-events-none absolute inset-0 h-full w-full"
              viewBox={`0 0 ${width} ${height}`}
              preserveAspectRatio="none"
              aria-label="Retained detection bounding boxes"
            >
              {detections.map((detection, index) => {
                const [x1, y1, x2, y2] = detection.bbox_xyxy;
                const fontSize = Math.max(13, width / 65);
                return (
                  <g key={index}>
                    <rect
                      x={x1}
                      y={y1}
                      width={x2 - x1}
                      height={y2 - y1}
                      fill="none"
                      stroke="var(--primary)"
                      strokeWidth={Math.max(2, width / 400)}
                    />
                    <text
                      x={x1 + 3}
                      y={Math.max(fontSize, y1 - 5)}
                      fill="var(--primary)"
                      stroke="var(--background)"
                      strokeWidth={Math.max(1, width / 1500)}
                      paintOrder="stroke"
                      fontSize={fontSize}
                    >
                      {detection.class_name ?? `Class ${detection.class_id}`} ·{" "}
                      {(detection.confidence * 100).toFixed(1)}%
                    </text>
                  </g>
                );
              })}
            </svg>
          )}
        </div>
      </div>
      <p className="text-note mb-4">
        Retained PNG preview; coordinates refer to the original{" "}
        {width && height ? `${width} × ${height} px` : "image"}.
      </p>
    </>
  );
}

export function HistoryTable({ records }: { records: Inspection[] }) {
  const [detail, setDetail] = useState<Inspection | null>(null);
  return (
    <>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>IMAGE NAME</th>
              <th>ANALYSIS TYPE</th>
              <th>DATE</th>
              <th>RESULT</th>
              <th>STATUS</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {records.length ? (
              records.map((record) => (
                <tr key={record.id}>
                  <td>
                    <span className="inline-flex items-center gap-2">
                      <FileImage size={13} className="text-muted-foreground" />
                      {record.filename}
                    </span>
                  </td>
                  <td>{modes.find((mode) => mode.id === record.mode)?.title}</td>
                  <td>
                    {new Date(record.date).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </td>
                  <td>
                    {record.mode === "classify"
                      ? `${classLabel(record.result.predicted_class ?? "")}${record.result.confidence === undefined ? "" : ` · ${(record.result.confidence * 100).toFixed(1)}%`}`
                      : `${record.result.count ?? 0} detections`}
                  </td>
                  <td>
                    <Badge tone="green">Completed</Badge>
                  </td>
                  <td>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`View ${record.filename}`}
                      onClick={() => setDetail(record)}
                    >
                      <Eye />
                    </Button>
                  </td>
                </tr>
              ))
            ) : (
              <tr className="table-empty">
                <td colSpan={6}>
                  <EmptyState
                    icon={FileImage}
                    title="No matching inspections"
                    description="Completed inspections appear here. Adjust your filters if records are hidden."
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Dialog
        open={detail !== null}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
      >
        {detail && (
          <DialogContent className="detail-modal" style={{ maxWidth: "calc(100vw - 40px)" }}>
            <DialogHeader className="pr-6">
              <DialogTitle>{detail.filename}</DialogTitle>
              <DialogDescription>
                {new Date(detail.date).toLocaleString()} · {detail.result.model}
                <br />
                {detail.result.inference_ms === undefined
                  ? `${(detail.duration / 1000).toFixed(2)} s recorded processing time`
                  : `${detail.result.inference_ms.toFixed(1)} ms model inference`}{" "}
                · Inspection {detail.id}
              </DialogDescription>
            </DialogHeader>
            <RetainedPreview key={`${detail.id}`} inspection={detail} />
            {detail.mode === "classify" ? (
              <section aria-label="Classification results">
                <div className="result-stat">
                  <Badge tone="green">Thermal classification</Badge>
                  <h3>{classLabel(detail.result.predicted_class ?? "")}</h3>
                  <p>
                    {detail.result.confidence === undefined
                      ? "Confidence unavailable"
                      : `${(detail.result.confidence * 100).toFixed(2)}% confidence`}
                  </p>
                </div>
                {Object.entries(detail.result.probabilities ?? {})
                  .sort((a, b) => b[1] - a[1])
                  .map(([label, probability]) => (
                    <div key={label}>
                      <div className="probability-row">
                        <span>{classLabel(label)}</span>
                        <strong>{(probability * 100).toFixed(2)}%</strong>
                      </div>
                      <div className="progress-track">
                        <progress
                          max="1"
                          value={probability}
                          aria-label={`${classLabel(label)} probability`}
                        />
                      </div>
                    </div>
                  ))}
              </section>
            ) : (
              <section aria-label="Detection results">
                <h3 className="mb-3">{detail.result.count ?? 0} model detections</h3>
                <div className="detection-list">
                  {(detail.result.detections ?? []).map((detection, index) => (
                    <div className="detection-item" key={index}>
                      <span>
                        {index + 1}. {detection.class_name ?? `Class ${detection.class_id}`} ·{" "}
                        {(detection.confidence * 100).toFixed(2)}%
                        <small>
                          bbox_xyxy: [
                          {detection.bbox_xyxy.map((value) => value.toFixed(1)).join(", ")}]
                        </small>
                      </span>
                    </div>
                  ))}
                  {!detail.result.detections?.length && (
                    <p className="text-note">The model returned no detections.</p>
                  )}
                </div>
              </section>
            )}
            <details className="mt-4">
              <summary className="text-note cursor-pointer">Full inspection JSON</summary>
              <pre>{JSON.stringify(detail, null, 2)}</pre>
            </details>
            <Button variant="outline" onClick={() => downloadJson(detail, `${detail.id}.json`)}>
              <Download />
              Download JSON
            </Button>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
