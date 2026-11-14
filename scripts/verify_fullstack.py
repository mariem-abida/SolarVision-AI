"""Opt-in smoke check of real trained models; never trains or changes checkpoints.

Run from the repository root: python -m scripts.verify_fullstack
Pass --base-url http://127.0.0.1:8000 to check an existing server instead.
"""

import argparse
import json
import os
import tempfile
from contextlib import ExitStack
from pathlib import Path

import httpx
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = {
    "panels": ROOT / "data/interim/panel_detection/test/images",
    "defects": ROOT / "data/interim/defect_detection/test/images",
    "classify": ROOT / "data/processed/pvf10_grouped/test",
}


def first_image(folder):
    return next(
        (
            path
            for path in folder.rglob("*")
            if path.is_file()
            and path.suffix.lower() in {".jpg", ".jpeg", ".png", ".tif", ".tiff"}
        ),
        None,
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url")
    parser.add_argument(
        "--report-name", choices=["local-cuda", "live-server", "docker-cpu"]
    )
    args = parser.parse_args()
    with ExitStack() as stack:
        if args.base_url:
            client = stack.enter_context(
                httpx.Client(base_url=args.base_url, timeout=120)
            )
        else:
            directory = stack.enter_context(tempfile.TemporaryDirectory())
            os.environ["SOLARVISION_HISTORY_DB"] = str(
                Path(directory) / "smoke.sqlite3"
            )
            from src.api.main import app

            client = stack.enter_context(TestClient(app))
        health = client.get("/health").json()
        assert health["models_loaded"], health
        report = {"health": health, "inferences": {}}
        for mode, folder in SAMPLES.items():
            sample = first_image(folder)
            if sample is None:
                raise FileNotFoundError(f"Missing real sample in {folder}")
            response = client.post(
                f"/predict/{mode}",
                files={"file": (sample.name, sample.read_bytes())},
                data={"thermal_confirmed": "true"} if mode == "classify" else {},
            )
            assert response.status_code == 200, response.text
            prediction = response.json()
            assert prediction["inference_ms"] >= 0
            if mode == "classify":
                assert len(prediction["probabilities"]) == 10
                assert abs(sum(prediction["probabilities"].values()) - 1) < 0.002
            else:
                assert prediction["count"] == len(prediction["detections"])
            image = client.get(f"/inspections/{prediction['inspection_id']}/image")
            assert (
                image.status_code == 200
                and image.headers["content-type"] == "image/png"
            )
            report["inferences"][mode] = {
                "sample": sample.relative_to(ROOT).as_posix(),
                **prediction,
            }
        for origin in (
            "http://localhost:8080",
            "http://localhost:8081",
            "http://127.0.0.1:8080",
            "http://127.0.0.1:8081",
        ):
            response = client.options(
                "/predict/panels",
                headers={"Origin": origin, "Access-Control-Request-Method": "POST"},
            )
            assert response.headers.get("access-control-allow-origin") == origin
        dashboard = client.get("/dashboard").json()
        assert len(dashboard["datasets"]) == 7
        report["dashboard"] = {
            "datasets": len(dashboard["datasets"]),
            "evaluations": len(dashboard["evaluations"]),
            "mlflow_runs": len(dashboard["mlops"]["mlflow"]["runs"]),
        }
        assert client.get("/monitoring").status_code == 200
        report["history_records"] = client.get("/inspections").json()["total"]
    output = ROOT / "outputs/integration"
    output.mkdir(parents=True, exist_ok=True)
    name = args.report_name or ("live-server" if args.base_url else "local-cuda")
    target = output / f"{name}.json"
    target.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(
        json.dumps(
            {
                "device": health["device"],
                "results": {
                    mode: {
                        key: value.get(key)
                        for key in (
                            "count",
                            "predicted_class",
                            "confidence",
                            "inference_ms",
                        )
                    }
                    for mode, value in report["inferences"].items()
                },
                "report": str(target),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
