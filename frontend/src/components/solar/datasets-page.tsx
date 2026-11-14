import { Database, ArrowRight, ShieldCheck } from "lucide-react";
import { bytes, statusLabel, useDashboard } from "@/lib/solar/dashboard";
import { Badge, EmptyState, PageIntro, SectionHeading } from "./common";
export function DatasetsPage() {
  const { data, error, isPending } = useDashboard();
  return (
    <>
      <PageIntro
        eyebrow="DATA & DEVELOPMENT"
        title="Dataset Explorer"
        description="Dataset versions and statistics read from the project's DVC pointers and validation reports."
        action={<Badge>{data ? `${data.datasets.length} tracked datasets` : "DVC metadata"}</Badge>}
      />
      {error && (
        <div className="error-banner" role="alert">
          {error.message}
          {data && " Last retrieved metadata remains visible."}
        </div>
      )}
      <SectionHeading
        title="Data preparation workflow"
        subtitle="Project development stages; these labels do not indicate a running job"
      />
      <div className="workflow-steps">
        {[
          "Raw Data",
          "Exploration",
          "Cleaning",
          "Validation",
          "Train / Validation / Test",
          "Model Training",
        ].map((step, i) => (
          <div className="workflow-step" key={step}>
            <span>{i + 1}</span>
            {step}
            {i < 5 && <ArrowRight size={13} className="text-muted-foreground" />}
          </div>
        ))}
      </div>
      {isPending && (
        <p role="status" className="text-note">
          Reading dataset metadata…
        </p>
      )}
      <div className="dataset-grid">
        {data?.datasets.map((dataset) => (
          <article className="metadata-card" key={dataset.id}>
            <Database size={23} />
            <h3>{dataset.name}</h3>
            <Badge tone={dataset.status === "available" ? "green" : "muted"}>
              {statusLabel(dataset.status)}
            </Badge>
            <p>{dataset.path}</p>
            {dataset.explanation && <p>{dataset.explanation}</p>}
            <dl>
              <dt>DVC pointer</dt>
              <dd>{dataset.dvc_file}</dd>
              <dt>Version / hash</dt>
              <dd style={{ overflowWrap: "anywhere" }}>{dataset.version || "Unavailable"}</dd>
              <dt>Tracked size</dt>
              <dd>{bytes(dataset.size_bytes)}</dd>
              <dt>Tracked files</dt>
              <dd>{dataset.file_count?.toLocaleString() ?? "Unavailable"}</dd>
              <dt>Local data</dt>
              <dd>{dataset.local_available ? "Present" : "Unavailable"}</dd>
              {dataset.statistics.images !== undefined && (
                <>
                  <dt>Validated images</dt>
                  <dd>{dataset.statistics.images.toLocaleString()}</dd>
                </>
              )}
              {dataset.statistics.total_files !== undefined && (
                <>
                  <dt>Validated files</dt>
                  <dd>{dataset.statistics.total_files.toLocaleString()}</dd>
                </>
              )}
              {dataset.statistics.corrupted_count !== undefined && (
                <>
                  <dt>Corrupt images</dt>
                  <dd>{dataset.statistics.corrupted_count.toLocaleString()}</dd>
                </>
              )}
              {dataset.split_summary &&
                Object.entries(dataset.split_summary).map(([split, summary]) => (
                  <div key={split} style={{ display: "contents" }}>
                    <dt>{split}</dt>
                    <dd>
                      {summary.images.toLocaleString()} images
                      {summary.groups !== undefined ? ` · ${summary.groups} groups` : ""}
                      {summary.classes ? ` · ${Object.keys(summary.classes).length} classes` : ""}
                    </dd>
                  </div>
                ))}
            </dl>
            {dataset.statistics_source && <p>Statistics source: {dataset.statistics_source}</p>}
            <div className="dataset-preview">Image previews unavailable · Metadata access only</div>
          </article>
        ))}
      </div>
      {!isPending && !data?.datasets.length && (
        <EmptyState
          icon={Database}
          title="Dataset metadata unavailable"
          description="The API has not returned any tracked dataset pointers."
        />
      )}
      <div className="notice mt-6">
        <ShieldCheck size={17} />
        <span>
          DVC hashes identify the locally recorded versions. They do not verify remote storage
          contents. Statistics come from saved validation reports and may describe an earlier data
          snapshot. {data && `Retrieved: ${new Date(data.generated_at).toLocaleString()}.`}
        </span>
      </div>
    </>
  );
}
