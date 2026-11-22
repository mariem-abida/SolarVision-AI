import {
  FlaskConical,
  GitBranch,
  Boxes,
  Workflow,
  FileBox,
  Rocket,
  CircleDot,
  Info,
} from "lucide-react";
import { bytes, statusLabel, useDashboard } from "@/lib/solar/dashboard";
import { useWorkspace } from "./workspace";
import { Badge, EmptyState, PageIntro, SectionHeading } from "./common";
import { MetadataProvenance } from "./metadata-provenance";
function metricSummary(metrics: Record<string, number>) {
  return (
    Object.entries(metrics)
      .slice(0, 8)
      .map(([key, value]) => `${key}: ${Number(value.toPrecision(5))}`)
      .join(" · ") || "No recorded metrics"
  );
}
export function MlopsPage() {
  const { healthState } = useWorkspace();
  const { data, error, isPending } = useDashboard();
  const mlops = data?.mlops;
  const integrations = [
    {
      title: "MLflow",
      category: "Recorded experiments",
      icon: FlaskConical,
      status: mlops ? statusLabel(mlops.mlflow.status) : "Unavailable",
      text:
        mlops?.mlflow.explanation ||
        (mlops
          ? `${mlops.mlflow.experiments.length} experiments · ${mlops.mlflow.runs.length} recorded runs from ${mlops.mlflow.source}. Tracking server availability is not inferred from this database.`
          : "Connect to the API to inspect recorded experiments."),
    },
    {
      title: "DVC",
      category: "Dataset versioning",
      icon: GitBranch,
      status: mlops ? statusLabel(mlops.dvc.status) : "Unavailable",
      text: mlops
        ? `${mlops.dvc.tracked_datasets} tracked datasets. Remote ${mlops.dvc.remote_configured ? `configured (${(mlops.dvc.remote_names || []).join(", ") || "recorded configuration"})` : "not configured"}. Remote access: not checked. Artifact synchronization: not checked. ${mlops.dvc.configuration_source === "snapshot" ? "Configuration recorded in the snapshot. " : ""}${mlops.dvc.explanation || ""}`
        : "DVC metadata has not been retrieved.",
    },
    {
      title: "Model registry",
      category: "Registered versions",
      icon: Boxes,
      status:
        !mlops || mlops.mlflow.status === "unavailable"
          ? "Unavailable"
          : mlops.mlflow.registry.length
            ? "Available"
            : "Not configured",
      text: mlops?.mlflow.registry.length
        ? `${mlops.mlflow.registry.length} recorded model versions. Registry stages do not establish deployment status.`
        : "No registered model versions are available from the configured metadata sources.",
    },
    {
      title: "Training runs",
      category: "Saved training outputs",
      icon: CircleDot,
      status: mlops?.training_runs.length ? "Available" : "Unavailable",
      text: mlops?.training_runs.length
        ? `${mlops.training_runs.length} training CSV summaries. These files do not indicate that training is currently running.`
        : "No readable training result CSVs were returned.",
    },
    {
      title: "Model artifacts",
      category: "Checkpoints",
      icon: FileBox,
      status: mlops?.checkpoints.some((c) => c.available) ? "Available" : "Unavailable",
      text: "Known project checkpoint paths and file metadata are listed below. No artifact is modified or downloaded by this page.",
    },
    {
      title: "CI/CD configuration",
      category: "Continuous validation",
      icon: Workflow,
      status: !mlops ? "Unavailable" : mlops.ci.configured ? "Configured" : "Not configured",
      text:
        mlops?.ci.explanation ||
        "GitHub Actions configuration is unavailable. Live workflow execution status is not connected.",
    },
    {
      title: "FastAPI deployment",
      category: "Inference service",
      icon: Rocket,
      status:
        healthState.state === "online"
          ? "Available"
          : healthState.state === "checking"
            ? "Checking"
            : healthState.reachable
              ? "Available"
              : "Unavailable",
      text: `Current API connection is checked independently. ${healthState.reachable && !healthState.models ? "The API is reachable; inference models are unavailable. " : ""}Checkpoint presence and MLflow registry stages do not confirm that a model is loaded.`,
    },
  ];
  return (
    <>
      <PageIntro
        eyebrow="REPRODUCIBILITY & OPERATIONS"
        title="MLOps Center"
        description="Read-only access to project experiments, dataset versions, training outputs, and model artifacts."
      />
      <div className="notice mb-6">
        <Info size={16} />
        <span>
          Recorded training data, model artifacts, registry versions, and the running inference
          service are shown separately. This page does not launch training, change registry stages,
          or synchronize DVC storage.
        </span>
      </div>
      <MetadataProvenance metadata={data?.metadata} />
      {error && (
        <div className="error-banner" role="alert">
          {error.message}
          {data && " Last retrieved records remain visible."}
        </div>
      )}
      {isPending && (
        <p role="status" className="text-note">
          Reading project MLOps metadata…
        </p>
      )}
      <SectionHeading
        title="Integrations & lifecycle"
        subtitle="Local records and independently verified service health"
      />
      <div className="integration-grid">
        {integrations.map((integration) => (
          <article className="metadata-card" key={integration.title}>
            <div className="integration-head">
              <integration.icon size={24} />
              <Badge
                tone={
                  integration.status === "Available"
                    ? "green"
                    : integration.status === "Configured"
                      ? "cyan"
                      : "muted"
                }
              >
                {integration.status}
              </Badge>
            </div>
            <h3>{integration.title}</h3>
            <span className="text-note">{integration.category}</span>
            <p>{integration.text}</p>
          </article>
        ))}
      </div>
      {mlops && (
        <>
          <section className="content-section">
            <SectionHeading
              title="MLflow experiments & runs"
              subtitle={`Source: ${mlops.mlflow.source} · ${mlops.mlflow.experiments.map((e) => `${e.name} (${e.id})`).join(", ") || "No experiments available"}`}
            />
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>RUN / EXPERIMENT</th>
                    <th>STATUS</th>
                    <th>STARTED</th>
                    <th>RECORDED METRICS</th>
                  </tr>
                </thead>
                <tbody>
                  {mlops.mlflow.runs.map((run) => (
                    <tr key={run.id}>
                      <td title={run.id}>
                        {run.name || run.id}
                        <br />
                        <span className="text-note">
                          {mlops.mlflow.experiments.find((e) => e.id === run.experiment_id)?.name ||
                            run.experiment_id}
                        </span>
                      </td>
                      <td>
                        <Badge>{run.status}</Badge>
                      </td>
                      <td>
                        {run.start_time === null
                          ? "Unavailable"
                          : new Date(run.start_time).toLocaleString()}
                      </td>
                      <td style={{ whiteSpace: "normal", minWidth: 250 }}>
                        {metricSummary(run.metrics)}
                      </td>
                    </tr>
                  ))}
                  {!mlops.mlflow.runs.length && (
                    <tr>
                      <td colSpan={4}>
                        Unavailable ·{" "}
                        {mlops.mlflow.explanation || "No recorded runs were returned."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
          <section className="content-section">
            <SectionHeading
              title="Model checkpoints"
              subtitle="Known project artifacts · File presence does not establish registry membership"
            />
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>MODEL / PATH</th>
                    <th>ARTIFACT</th>
                    <th>ROLE</th>
                    <th>SIZE</th>
                    <th>MODIFIED</th>
                  </tr>
                </thead>
                <tbody>
                  {mlops.checkpoints.map((checkpoint) => (
                    <tr key={checkpoint.id}>
                      <td>
                        {checkpoint.name}
                        <br />
                        <span className="text-note">{checkpoint.path}</span>
                      </td>
                      <td>
                        <Badge tone={checkpoint.available ? "green" : "muted"}>
                          {checkpoint.available ? "Present" : "Unavailable"}
                        </Badge>
                      </td>
                      <td>
                        {checkpoint.deployed ? "Inference configuration" : "Research / comparison"}
                      </td>
                      <td>{bytes(checkpoint.size_bytes)}</td>
                      <td>
                        {checkpoint.modified_at
                          ? new Date(checkpoint.modified_at).toLocaleString()
                          : "Unavailable"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="content-section">
            <SectionHeading
              title="Saved training summaries"
              subtitle="Last recorded CSV row; not a live training status"
            />
            <div className="integration-grid">
              {mlops.training_runs.map((run) => (
                <article className="metadata-card" key={run.id}>
                  <CircleDot size={22} />
                  <h3>{run.name}</h3>
                  <p>{run.source}</p>
                  <dl>
                    <dt>Recorded epochs</dt>
                    <dd>{run.epochs}</dd>
                    <dt>File modified</dt>
                    <dd>{new Date(run.recorded_at).toLocaleString()}</dd>
                  </dl>
                  <p>{metricSummary(run.last_metrics)}</p>
                </article>
              ))}
            </div>
            {!mlops.training_runs.length && (
              <EmptyState
                icon={CircleDot}
                title="Training summaries unavailable"
                description="No saved training CSV summary is accessible."
              />
            )}
          </section>
          {mlops.mlflow.registry.length > 0 && (
            <section className="content-section">
              <SectionHeading
                title="Registered model versions"
                subtitle="Recorded MLflow registry state; independent from deployment"
              />
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>MODEL</th>
                      <th>VERSION</th>
                      <th>STAGE</th>
                      <th>STATUS</th>
                      <th>RUN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mlops.mlflow.registry.map((version) => (
                      <tr key={`${version.name}-${version.version}`}>
                        <td>{version.name}</td>
                        <td>{version.version}</td>
                        <td>{version.stage}</td>
                        <td>{version.status}</td>
                        <td>{version.run_id || "Unavailable"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          <p className="text-note">Retrieved: {new Date(data.generated_at).toLocaleString()}</p>
        </>
      )}
    </>
  );
}
