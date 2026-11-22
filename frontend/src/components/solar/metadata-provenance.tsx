import type { z } from "zod";
import type { dashboardSchema } from "@/lib/solar/dashboard";

type Metadata = z.infer<typeof dashboardSchema>["metadata"];

export function MetadataProvenance({ metadata }: { metadata: Metadata }) {
  if (!metadata) return null;
  const { snapshot } = metadata;
  const changed = snapshot.sources.filter((source) =>
    ["changed", "unreadable"].includes(source.runtime_state),
  );
  return (
    <div
      className={snapshot.status === "invalid" ? "error-banner" : "notice mb-6"}
      role={snapshot.status === "invalid" ? "alert" : "note"}
    >
      <div className="min-w-0">
        <strong>
          {metadata.mode === "snapshot"
            ? "Recorded metadata snapshot"
            : metadata.mode === "mixed"
              ? "Runtime files and recorded metadata"
              : "Runtime metadata"}
        </strong>
        <p>
          {snapshot.status === "valid"
            ? `Snapshot captured ${new Date(snapshot.generated_at!).toLocaleString()}. Integrity verified; ${snapshot.freshness === "stale" ? "snapshot is older than the configured freshness limit" : "within the configured freshness limit"}.`
            : snapshot.status === "invalid"
              ? "The metadata snapshot was rejected. Only readable runtime sources are used."
              : "No verified snapshot is configured; available runtime files are shown."}{" "}
          Recorded metadata does not verify remote services, dataset synchronization or model
          loading.
        </p>
        {changed.length > 0 && (
          <p>
            {changed.length} mounted source(s) differ from the recorded snapshot or cannot be read.
            Available runtime files take precedence.
          </p>
        )}
        {snapshot.status === "valid" && (
          <details className="mt-2">
            <summary>Snapshot provenance</summary>
            <p className="break-all">Payload SHA-256: {snapshot.payload_sha256}</p>
            <ul>
              {snapshot.sources.map((source) => (
                <li key={source.path} className="break-all">
                  {source.path} · {source.runtime_state} · SHA-256 {source.sha256}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
