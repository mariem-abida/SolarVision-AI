import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MetadataProvenance } from "./metadata-provenance";

describe("metadata provenance", () => {
  it("identifies a stale recorded snapshot without claiming remote connectivity", () => {
    render(
      <MetadataProvenance
        metadata={{
          mode: "snapshot",
          snapshot: {
            status: "valid",
            generated_at: "2026-01-01T00:00:00Z",
            age_seconds: 100000000,
            freshness: "stale",
            payload_sha256: "a".repeat(64),
            sources: [],
            explanation: "Verified",
          },
        }}
      />,
    );
    expect(screen.getByText("Recorded metadata snapshot")).toBeInTheDocument();
    expect(screen.getByText(/older than the configured freshness limit/)).toHaveTextContent(
      /does not verify remote services/,
    );
    expect(screen.getByText(/Payload SHA-256/)).toHaveTextContent("a".repeat(64));
  });
  it("makes a rejected snapshot an alert rather than displaying its values", () => {
    render(
      <MetadataProvenance
        metadata={{
          mode: "runtime",
          snapshot: {
            status: "invalid",
            generated_at: null,
            age_seconds: null,
            freshness: "unknown",
            payload_sha256: null,
            sources: [],
            explanation: "Rejected",
          },
        }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/snapshot was rejected/);
    expect(screen.queryByText("Snapshot provenance")).not.toBeInTheDocument();
  });
});
