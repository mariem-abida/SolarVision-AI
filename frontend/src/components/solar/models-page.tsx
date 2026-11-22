import { Info, ChartNoAxesCombined } from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { percentage, useDashboard, type Evaluation } from "@/lib/solar/dashboard";
import { Badge, EmptyState, PageIntro, SectionHeading } from "./common";
import { MetadataProvenance } from "./metadata-provenance";

const metricNames: Record<string, string> = {
  accuracy: "Test accuracy",
  macro_precision: "Macro precision",
  macro_recall: "Macro recall",
  macro_f1: "Macro F1",
  precision: "Precision",
  recall: "Recall",
  map50: "mAP@50",
  map50_95: "mAP@50:95",
};
const classificationKeys = ["accuracy", "macro_precision", "macro_recall", "macro_f1"];
const detectionKeys = ["precision", "recall", "map50", "map50_95"];
function Benchmark({ evaluations, keys }: { evaluations: Evaluation[]; keys: string[] }) {
  const available = evaluations.filter((e) => e.status === "available");
  const chart = keys.map((key) => ({
    metric: metricNames[key] || key,
    ...Object.fromEntries(
      available.map((e) => [e.id, e.metrics[key] === undefined ? null : e.metrics[key] * 100]),
    ),
  }));
  return (
    <>
      <div className="metric-bars">
        {evaluations.map((e) => (
          <div key={e.id}>
            <div className="integration-head">
              <h3>{e.name}</h3>
              <Badge tone={e.status === "available" ? "cyan" : "muted"}>
                {e.status === "available" ? "Historical evaluation" : "Unavailable"}
              </Badge>
            </div>
            <p>
              {e.source}
              <br />
              {e.recorded_at
                ? `Report modified: ${new Date(e.recorded_at).toLocaleString()}`
                : "Report timestamp unavailable"}
            </p>
            {e.explanation && <p>{e.explanation}</p>}
            {keys.map((key) => (
              <div key={key}>
                <div className="evaluation-row">
                  <span>{metricNames[key] || key}</span>
                  <strong>{percentage(e.metrics[key])}</strong>
                </div>
                <div className="progress-track">
                  <progress
                    aria-label={`${e.name}: ${metricNames[key] || key}`}
                    aria-valuetext={percentage(e.metrics[key])}
                    max="1"
                    value={e.metrics[key] ?? 0}
                  />
                </div>
              </div>
            ))}
            {e.metrics["test_images"] !== undefined && (
              <p>Test images: {e.metrics["test_images"].toLocaleString()}</p>
            )}
          </div>
        ))}
      </div>
      {available.length > 0 && (
        <div className="chart-frame mt-5">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} margin={{ top: 20, right: 20, left: -15, bottom: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="metric" tickLine={false} axisLine={false} />
              <YAxis domain={[0, 100]} unit="%" tickLine={false} axisLine={false} />
              <Tooltip formatter={(value) => `${Number(value).toFixed(2)}%`} />
              <Legend iconSize={8} />
              {available.map((e, i) => (
                <Bar
                  key={e.id}
                  name={e.name}
                  dataKey={e.id}
                  fill={i % 2 ? "var(--success)" : "var(--primary)"}
                  radius={[3, 3, 0, 0]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </>
  );
}
export function ModelsPage() {
  const { data, error, isPending } = useDashboard();
  return (
    <>
      <PageIntro
        eyebrow="EVALUATION & BENCHMARKS"
        title="Model Performance"
        description="Measured model quality from the project's saved evaluation reports."
        action={<Badge tone="cyan">Historical evaluation results</Badge>}
      />
      <div className="notice mb-7">
        <Info size={15} />
        <span>
          These are completed test evaluations read from project reports, not production quality
          measurements. Classification accuracy and detection mAP measure different tasks. File
          modification times are shown for provenance and may differ from evaluation dates.
        </span>
      </div>
      <MetadataProvenance metadata={data?.metadata} />
      {error && (
        <div className="error-banner" role="alert">
          {error.message}
          {data && " Last retrieved results remain visible."}
        </div>
      )}
      {isPending && (
        <p role="status" className="text-note">
          Loading evaluation reports…
        </p>
      )}
      {data ? (
        <>
          <section className="content-section">
            <SectionHeading
              title="Thermal classification"
              subtitle="PVF-10 · ResNet18 and ViT-Tiny comparison · Test split"
            />
            <Benchmark
              evaluations={data.evaluations.filter((e) => e.task === "classification")}
              keys={classificationKeys}
            />
          </section>
          <section className="content-section">
            <SectionHeading
              title="Object detection"
              subtitle="YOLO11n · Panel localization and generic defect detection"
            />
            <Benchmark
              evaluations={data.evaluations.filter((e) => e.task === "detection")}
              keys={detectionKeys}
            />
          </section>
          {data.evaluations.length === 0 && (
            <EmptyState
              icon={ChartNoAxesCombined}
              title="Evaluation reports unavailable"
              description="No saved test evaluation was returned by the API."
            />
          )}
          <p className="text-note mb-5">
            Retrieved: {new Date(data.generated_at).toLocaleString()}
          </p>
        </>
      ) : (
        !isPending && (
          <EmptyState
            icon={ChartNoAxesCombined}
            title="Evaluation reports unavailable"
            description="Connect to the API to read the project's saved results."
          />
        )
      )}
      <div className="notice">
        <Info size={15} />
        <span>
          High panel detection scores require independent generalization validation. Defect
          detections and thermal classifications should be reviewed by an inspection specialist.
        </span>
      </div>
    </>
  );
}
