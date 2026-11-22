"""Capture only public dashboard metadata; never export databases or weights.

Run locally where real reports/registry exist. Commit/review the resulting JSON
separately; this command never stages, commits, pushes, trains or uses DVC remotes.
"""

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

def main():
    from src.api.dashboard_snapshot import PUBLIC_MODELS, create_snapshot, read_snapshot

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--check", action="store_true", help="Verify existing snapshot and any currently mounted source hashes; do not write")
    parser.add_argument("--allow-incomplete", action="store_true", help="Explicitly allow snapshots with unavailable source groups (never fabricate values)")
    args = parser.parse_args()
    root = args.root.resolve()
    output = args.output or root / "configs/dashboard-snapshot.json"
    if args.check:
        _, info = read_snapshot(root, output)
        changed = [row["path"] for row in info["sources"] if row["runtime_state"] in {"changed", "unreadable"}]
        print(json.dumps({"snapshot_status": info["status"], "freshness": info["freshness"], "changed_sources": changed, "payload_sha256": info["payload_sha256"]}, indent=2))
        return 0 if info["status"] == "valid" and not changed else 1
    snapshot = create_snapshot(root)
    data = snapshot["payload"]
    complete = (all(row["status"] == "available" for row in data["evaluations"])
                and all(row["status"] == "available" for row in data["datasets"])
                and {row["name"] for row in data["mlops"]["mlflow"]["registry"]} == PUBLIC_MODELS
                and len(data["mlops"]["training_runs"]) == 5
                and data["mlops"]["ci"]["configured"])
    if not complete and not args.allow_incomplete:
        raise ValueError("Required real sources are incomplete: expected 4 evaluations, 7 DVC pointers, 4 registered models, 5 CSV summaries and the CI workflow. No snapshot written.")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(snapshot, sort_keys=True, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"snapshot": str(output), "complete": complete, "source_count": len(snapshot["sources"]),
                      "evaluations": len(data["evaluations"]), "datasets": len(data["datasets"]),
                      "registered_versions": len(data["mlops"]["mlflow"]["registry"]),
                      "training_summaries": len(data["mlops"]["training_runs"]),
                      "payload_sha256": snapshot["payload_sha256"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
