"""Publication gate regressions using synthetic bytes and mocked read-only Git.

No real index, history, credentials, datasets or trained weights are modified.
Synthetic token strings are assembled so the tests themselves contain none of
the complete token signatures that the publication gate correctly rejects.
"""

import hashlib
import json
from pathlib import Path

import pytest

from scripts import check_publication_safety as gate


def write(root, path, content):
    target = root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)
    return target


def public_dvc():
    return (
        "outs:\n- md5: "
        + "a" * 32
        + "\n  size: 123\n  hash: md5\n  path: mlflow_backup.zip\n"
    ).encode()


def public_snapshot():
    payload = {
        "evaluations": [],
        "datasets": [],
        "mlops": {
            "dvc": {
                "status": "not_configured",
                "tracked_datasets": 0,
                "remote_configured": False,
                "remote_names": [],
                "remote_accessible": None,
                "artifacts_synchronized": None,
                "explanation": "Remote connectivity has not been tested.",
            },
            "mlflow": {
                "status": "not_configured",
                "source": "mlflow.db",
                "experiments": [],
                "runs": [],
                "registry": [],
                "explanation": "No tracking-server connection is claimed.",
            },
            "training_runs": [],
            "ci": {
                "configured": False,
                "source": ".github/workflows/ci.yml",
                "execution_status": "not_checked",
                "explanation": "No remote CI call.",
            },
        },
    }

    def digest(value):
        canonical = json.dumps(
            value, sort_keys=True, ensure_ascii=True, separators=(",", ":")
        ).encode()
        return hashlib.sha256(canonical).hexdigest()

    snapshot = {
        "schema_version": 1,
        "generated_at": "2026-11-22T00:00:00+00:00",
        "sources": [],
        "payload": payload,
        "payload_sha256": digest(payload),
    }
    snapshot["manifest_sha256"] = digest(
        {key: value for key, value in snapshot.items() if key != "payload"}
    )
    return snapshot


def test_candidate_tree_requires_exact_allowlist_and_does_not_modify_files(tmp_path):
    source = write(tmp_path, "src/main.py", b"print('public source')\n")
    extra = write(tmp_path, "unreviewed.txt", b"public but unapproved\n")
    before = {file: file.read_bytes() for file in (source, extra)}
    result = gate.scan_tree(tmp_path, {"src/main.py", "missing.txt"})
    assert {issue["type"] for issue in result["findings"]} == {
        "not-in-allowlist",
        "allowlisted-file-missing",
    }
    assert all(file.read_bytes() == content for file, content in before.items())


@pytest.mark.parametrize(
    "path",
    [
        "data/raw/panels/image.jpg",
        "datasets/training.csv",
        "models/best.pt",
        "models/best.pth",
        "models/model.onnx",
        "weights/checkpoint.bin",
        "mlflow.db",
        "archive.sqlite3-wal",
        "backups/history.zip",
        "reports/audits/private-evidence.json",
        ".env.local",
        ".dvc/config.local",
        ".kube/config",
        "configs/kubeconfig.yaml",
        "credentials.json",
        "client_secret_local.json",
        "oauth_token.json",
        "private.pem",
        "id_ed25519",
        "node_modules/dependency.js",
        "reports/detection/panel/test_evaluation/val_batch0_pred.jpg",
    ],
)
def test_private_paths_remain_blocked_even_if_allowlisted(tmp_path, path):
    write(tmp_path, path, b"synthetic non-secret fixture")
    result = gate.scan_tree(tmp_path, {path})
    assert result["status"] == "FAIL"
    assert result["findings"]


def test_public_dvc_backup_descriptor_and_infrastructure_ignore_are_allowed(tmp_path):
    files = {
        "backups/mlflow.zip.dvc": public_dvc(),
        "backups/.gitignore": b"*\n!.gitignore\n!*.dvc\n",
        "models/best.pt.dvc": public_dvc(),
    }
    for path, content in files.items():
        write(tmp_path, path, content)
    assert gate.scan_tree(tmp_path, set(files))["status"] == "PASS"


@pytest.mark.parametrize(
    "extra",
    [
        b"  credential: hidden\n",
        b"  url: https://example.invalid\n",
        b"  path: ../../outside.zip\n",
        b"- md5: " + b"b" * 32 + b"\n",
    ],
)
def test_dvc_suffix_does_not_exempt_unreviewed_content(tmp_path, extra):
    data = public_dvc() + extra
    write(tmp_path, "backups/archive.dvc", data)
    result = gate.scan_tree(tmp_path, {"backups/archive.dvc"})
    assert "unreviewed-dvc-metadata-shape" in {
        issue["type"] for issue in result["findings"]
    }


@pytest.mark.parametrize(
    "data,expected",
    [
        (b"SQLite format 3\x00" + b"x" * 20, "sqlite-content-signature"),
        (b"PK\x03\x04" + b"x" * 20, "archive-content-signature"),
    ],
)
def test_disguised_private_binary_is_rejected(tmp_path, data, expected):
    write(tmp_path, "docs/looks-public.txt", data)
    result = gate.scan_tree(tmp_path, {"docs/looks-public.txt"})
    assert expected in {issue["type"] for issue in result["findings"]}


def test_secret_findings_never_contain_the_matched_value(tmp_path):
    value = "gh" + "p_" + "A" * 36
    write(tmp_path, "src/config.py", ("key = '" + value + "'\n").encode())
    result = gate.scan_tree(tmp_path, {"src/config.py"})
    serialized = json.dumps(result)
    assert value not in serialized
    assert result["findings"][0]["type"] == "github-token"
    assert result["findings"][0]["line"] == 1
    assert result["findings"][0]["value"] == gate.REDACTED


def test_a_token_accidentally_used_as_a_filename_is_also_redacted(tmp_path):
    value = "gh" + "p_" + "B" * 36
    path = "docs/" + value + ".txt"
    write(tmp_path, path, b"harmless bytes but unapproved filename")
    result = gate.scan_tree(tmp_path, {path})
    assert result["status"] == "FAIL"
    assert value not in json.dumps(result)
    assert gate.REDACTED in result["findings"][0]["path"]


def test_generic_literal_and_utf16_secret_are_rejected_without_values(tmp_path):
    value = "un" + "ique-credential-value"
    data = ("client_" + "secret = '" + value + "'\n").encode("utf-16")
    write(tmp_path, "config.example", data)
    result = gate.scan_tree(tmp_path, {"config.example"})
    assert any(
        issue["type"] == "literal-sensitive-assignment" for issue in result["findings"]
    )
    assert value not in json.dumps(result)


def test_concatenated_fixture_fragment_is_not_a_literal_credential():
    source = b'write(path, ("API_KEY=" + value + "\\n").encode())\n'
    assert gate.scan_blob("tests/fixture.py", source, scope="candidate") == []


def test_decoded_python_config_template_is_still_scanned():
    value = "un" + "ique-credential-value"
    source = (
        "template = " + repr("client_" + "secret = '" + value + "'\n") + "\n"
    ).encode()
    result = gate.scan_blob("src/template.py", source, scope="candidate")
    assert any(issue["type"] == "literal-sensitive-assignment" for issue in result)
    assert value not in json.dumps(result)


def test_private_key_marker_is_rejected(tmp_path):
    marker = "-----BEGIN " + "PRIVATE KEY-----"
    write(tmp_path, "docs/key.txt", (marker + "\nsynthetic\n").encode())
    result = gate.scan_tree(tmp_path, {"docs/key.txt"})
    assert any(issue["type"] == "private-key-material" for issue in result["findings"])


def test_placeholders_are_not_blanket_exemptions_for_real_token_signatures(tmp_path):
    write(tmp_path, ".env.example", b"API_KEY=${YOUR_API_KEY}\nPASSWORD=changeme\n")
    assert gate.scan_tree(tmp_path, {".env.example"})["status"] == "PASS"
    value = "AK" + "IA" + "A" * 16
    write(tmp_path, ".env.example", ("API_KEY=" + value + "\n").encode())
    assert gate.scan_tree(tmp_path, {".env.example"})["status"] == "FAIL"


def test_size_limit_is_enforced_before_reading_large_files(tmp_path):
    write(tmp_path, "src/oversized.txt", b"x" * 101)
    result = gate.scan_tree(tmp_path, {"src/oversized.txt"}, max_bytes=100)
    assert result["findings"][0]["type"] == "file-exceeds-size-limit"


def test_symlink_is_not_followed(tmp_path):
    outside = tmp_path.parent / "outside-publication-fixture.txt"
    outside.write_text("synthetic secret source", encoding="utf8")
    link = tmp_path / "linked.txt"
    try:
        link.symlink_to(outside)
    except (OSError, NotImplementedError):
        pytest.skip("Creating symlinks is unavailable for this test user")
    result = gate.scan_tree(tmp_path, {"linked.txt"})
    assert result["findings"][0]["type"] == "symlink-or-reparse-point"
    assert outside.read_text() == "synthetic secret source"


def test_rejected_link_is_never_opened_even_when_os_link_privileges_are_missing(
    tmp_path, monkeypatch
):
    link = write(tmp_path, "linked.txt", b"not read by the gate")
    original_is_symlink = Path.is_symlink
    original_read_bytes = Path.read_bytes

    def simulated_link(path):
        return path == link or original_is_symlink(path)

    def guarded_read(path):
        if path == link:
            raise AssertionError("A rejected link must not be opened")
        return original_read_bytes(path)

    monkeypatch.setattr(Path, "is_symlink", simulated_link)
    monkeypatch.setattr(Path, "read_bytes", guarded_read)
    result = gate.scan_tree(tmp_path, {"linked.txt"})
    assert result["findings"][0]["type"] == "symlink-or-reparse-point"


@pytest.mark.parametrize(
    "entry", ["../escape", "C:/private/file", "/absolute", "a/../../outside"]
)
def test_allowlist_path_escape_is_rejected(tmp_path, entry):
    manifest = write(tmp_path, "allowlist.txt", (entry + "\n").encode())
    with pytest.raises(gate.ScanError):
        gate.read_allowlist(manifest)


def test_public_snapshot_is_checked_as_data_without_importing_candidate_code(tmp_path):
    snapshot = public_snapshot()
    write(tmp_path, "configs/dashboard-snapshot.json", json.dumps(snapshot).encode())
    assert (
        gate.scan_tree(tmp_path, {"configs/dashboard-snapshot.json"})["status"]
        == "PASS"
    )
    snapshot["payload"]["private_database"] = "not an allowed metadata field"
    write(tmp_path, "configs/dashboard-snapshot.json", json.dumps(snapshot).encode())
    result = gate.scan_tree(tmp_path, {"configs/dashboard-snapshot.json"})
    assert "unreviewed-public-snapshot-shape" in {
        issue["type"] for issue in result["findings"]
    }


def test_index_scans_staged_blob_not_benign_worktree_and_never_mutates_git(
    tmp_path, monkeypatch
):
    write(tmp_path, "src/config.py", b"print('benign worktree')\n")
    value = "sk" + "-proj-" + "Z" * 24
    staged = ("api_key = '" + value + "'\n").encode()
    oid = "a" * 40
    calls = []

    def fake_git(repo, args):
        calls.append(args)
        if args[0] == "diff":
            return b"" if "--diff-filter=D" in args else b"src/config.py\0"
        if args[0] == "ls-files":
            return ("100644 " + oid + " 0\tsrc/config.py\0").encode()
        if args[:2] == ["cat-file", "-s"]:
            return str(len(staged)).encode()
        if args[:2] == ["cat-file", "blob"]:
            return staged
        raise AssertionError("Unexpected Git operation")

    monkeypatch.setattr(gate, "git_read", fake_git)
    result = gate.scan_index(tmp_path, {"src/config.py"}, set())
    assert result["status"] == "FAIL"
    assert any(issue["type"] == "openai-api-key" for issue in result["findings"])
    assert value not in json.dumps(result)
    assert {args[0] for args in calls} <= {"diff", "ls-files", "cat-file"}
    assert (tmp_path / "src/config.py").read_bytes() == b"print('benign worktree')\n"


def test_empty_real_index_is_not_reported_as_complete_publication_selection(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(gate, "git_read", lambda repo, args: b"")
    result = gate.scan_index(tmp_path, {"src/change.py"}, set())
    assert result["status"] == "PASS"
    assert result["files_scanned"] == 0
    assert result["selection_complete"] is False
    strict = gate.scan_index(tmp_path, {"src/change.py"}, set(), require_complete=True)
    assert strict["status"] == "FAIL"


def test_index_deletion_requires_explicit_approval(tmp_path, monkeypatch):
    def fake_git(repo, args):
        return b"reports/val_batch0_pred.jpg\0" if "--diff-filter=D" in args else b""

    monkeypatch.setattr(gate, "git_read", fake_git)
    path = "reports/val_batch0_pred.jpg"
    assert gate.scan_index(tmp_path, set(), set())["status"] == "FAIL"
    result = gate.scan_index(tmp_path, set(), {path}, require_complete=True)
    assert result["status"] == "PASS"
    assert result["approved_deletions_selected"] == [path]


def test_head_scan_labels_inherited_policy_findings(tmp_path, monkeypatch):
    path = "reports/detection/panel/test_evaluation/val_batch0_pred.jpg"
    monkeypatch.setattr(
        gate,
        "tracked_entries",
        lambda repo: [gate.GitEntry(path, "100644", "b" * 40, 4)],
    )
    monkeypatch.setattr(gate, "git_read", lambda repo, args: b"test")
    result = gate.scan_tracked(tmp_path)
    assert result["status"] == "FAIL"
    assert result["findings"][0]["type"] == "dataset-derived-mosaic"
    assert result["findings"][0]["scope"] == "already-tracked-head"
    assert "Already present" in result["findings"][0]["disposition"]
