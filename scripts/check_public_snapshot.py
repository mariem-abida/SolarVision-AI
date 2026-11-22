"""Verify the committed public snapshot without requiring private data sources.

This is a read-only CI check, not the local capture command. In clean CI the
datasets, model weights, MLflow store and OAuth configuration must be absent.
"""

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main():
    from src.api.dashboard_snapshot import PUBLIC_MODELS, read_snapshot

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--require-clean-source", action="store_true")
    args = parser.parse_args()
    root = args.root.resolve()
    payload, info = read_snapshot(root, root / "configs/dashboard-snapshot.json")
    if payload is None or info["status"] != "valid":
        raise ValueError("The public snapshot is absent or invalid")
    changed = [row["path"] for row in info["sources"] if row["runtime_state"] in {"changed", "unreadable"}]
    if changed:
        raise ValueError(f"Snapshot provenance differs from mounted sources: {', '.join(changed)}")
    checks = {
        "four_evaluations": len(payload["evaluations"]) == 4 and all(row["status"] == "available" for row in payload["evaluations"]),
        "seven_dvc_descriptors": len(payload["datasets"]) == 7 and all(row["version"] for row in payload["datasets"]),
        "four_registered_models": {row["name"] for row in payload["mlops"]["mlflow"]["registry"]} == PUBLIC_MODELS,
        "five_training_summaries": len(payload["mlops"]["training_runs"]) == 5,
        "workflow_configuration_only": payload["mlops"]["ci"]["configured"] and payload["mlops"]["ci"]["execution_status"] == "not_checked",
        "no_remote_connectivity_claim": payload["mlops"]["dvc"]["remote_accessible"] is None and payload["mlops"]["dvc"]["artifacts_synchronized"] is None,
    }
    if args.require_clean_source:
        prohibited = [name for name in ("mlflow.db", "mlruns", ".dvc/config.local", ".dvc/cache", ".env") if (root / name).exists()]
        for directory in ("models", "runs", "weights", "data"):
            if (root / directory).exists():
                prohibited.extend(str(path.relative_to(root)) for path in (root / directory).rglob("*")
                                  if path.is_file() and path.suffix.lower() in {".pt", ".pth", ".onnx", ".jpg", ".jpeg", ".png", ".tif", ".tiff", ".zip", ".sqlite3"})
        if prohibited:
            raise ValueError("Clean CI must not contain private datasets, weights, stores or local credentials: " + ", ".join(prohibited[:20]))
        checks["private_sources_absent"] = True
    if not all(checks.values()):
        raise ValueError("Incomplete public snapshot: " + ", ".join(key for key, value in checks.items() if not value))
    print(json.dumps({"checks": checks, "payload_sha256": info["payload_sha256"], "freshness": info["freshness"],
                      "note": "Checks public recorded metadata, not model accuracy, remote services, or inference readiness."}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
