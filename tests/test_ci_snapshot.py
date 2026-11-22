"""Clean-checkout metadata validation, without private project sources."""

import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def snapshot_checkout(tmp_path):
    target = tmp_path / "configs/dashboard-snapshot.json"
    target.parent.mkdir()
    shutil.copyfile(ROOT / "configs/dashboard-snapshot.json", target)
    return tmp_path


def check(root):
    return subprocess.run(
        [sys.executable, "-B", str(ROOT / "scripts/check_public_snapshot.py"), "--root", str(root), "--require-clean-source"],
        capture_output=True, text=True, check=False,
    )


def test_public_metadata_is_verified_without_databases_datasets_or_weights(tmp_path):
    checkout = snapshot_checkout(tmp_path)
    result = check(checkout)
    assert result.returncode == 0, result.stderr
    assert '"private_sources_absent": true' in result.stdout
    assert '"four_registered_models": true' in result.stdout
    assert not (checkout / "mlflow.db").exists()
    assert not (checkout / "data").exists()


@pytest.mark.parametrize("private_path", ["mlflow.db", ".dvc/config.local", "models/classification/test.pth"])
def test_clean_ci_refuses_private_sources(tmp_path, private_path):
    checkout = snapshot_checkout(tmp_path)
    path = checkout / private_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"Synthetic forbidden fixture, not a real model or store")
    result = check(checkout)
    assert result.returncode != 0
    assert "Clean CI must not contain private" in result.stderr or "Snapshot provenance differs" in result.stderr


def test_clean_ci_rejects_a_mounted_source_that_differs_from_its_snapshot(tmp_path):
    checkout = snapshot_checkout(tmp_path)
    workflow = checkout / ".github/workflows/ci.yml"
    workflow.parent.mkdir(parents=True)
    workflow.write_text("name: An intentionally different workflow\n", encoding="utf-8")
    result = check(checkout)
    assert result.returncode != 0
    assert "Snapshot provenance differs" in result.stderr
