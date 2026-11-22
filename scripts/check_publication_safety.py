"""Read-only publication checks for an exported tree, staged blobs or HEAD.

This is a conservative heuristic and allowlist check, not a secret-removal or
history-rewriting tool. It never stages, commits, removes or modifies Git data.
Findings contain paths/categories/line numbers, never matched secret values.
"""

from __future__ import annotations

import argparse
import ast
import fnmatch
import hashlib
import json
import os
import re
import stat
import subprocess
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

DEFAULT_MAX_BYTES = 5 * 1024 * 1024
MAX_FILES = 20_000
MAX_SECRET_FINDINGS_PER_FILE = 20
REDACTED = "[REDACTED]"

SECRET_PATTERNS = {
    "private-key-material": re.compile(r"-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----"),
    "aws-access-key": re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
    "github-token": re.compile(
        r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b"
    ),
    "google-oauth-client-secret": re.compile(r"\bGOCSPX-[A-Za-z0-9_-]{10,}\b"),
    "google-oauth-access-token": re.compile(r"\bya29\.[A-Za-z0-9._-]{20,}"),
    "google-api-key": re.compile(r"\bAIza[A-Za-z0-9_-]{30,}\b"),
    "openai-api-key": re.compile(r"\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b"),
    "slack-token": re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b"),
    "jwt-token": re.compile(
        r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b"
    ),
}
SENSITIVE_NAME = r"[A-Za-z0-9_.-]*(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|client[_-]?key[_-]?data|secret[_-]?key|secret_access_key|account[_-]?key|password|passwd|private[_-]?key|secret|token)"
LITERAL_ASSIGNMENT = re.compile(
    rf"(?im)(?:(?P<keyquote>[\"']){SENSITIVE_NAME}(?P=keyquote)|(?<![\w\"']){SENSITIVE_NAME}(?![\w\"']))"
    rf"\s*[:=]\s*(?P<valuequote>[\"'])(?P<secretvalue>[^\r\n\"']{{4,}})(?P=valuequote)"
)
CONFIG_ASSIGNMENT = re.compile(
    rf"(?im)^\s*{SENSITIVE_NAME}\s*[:=]\s*([^\s#;]{{4,}})\s*(?:[#;].*)?$"
)
CREDENTIAL_URL = re.compile(r"(?i)\b[a-z][a-z0-9+.-]*://([^/\s:@]+):([^/\s@]{3,})@")
CONFIG_SUFFIXES = {
    ".yaml",
    ".yml",
    ".json",
    ".ini",
    ".cfg",
    ".toml",
    ".config",
    ".env",
    ".example",
    ".sample",
    ".template",
}
PRIVATE_SUFFIXES = {".pem", ".key", ".p12", ".pfx", ".der"}
WEIGHT_SUFFIXES = {
    ".pt",
    ".pth",
    ".onnx",
    ".ckpt",
    ".safetensors",
    ".h5",
    ".hdf5",
    ".tflite",
    ".pkl",
    ".pickle",
    ".joblib",
    ".bin",
    ".pb",
}
ARCHIVE_SUFFIXES = {".zip", ".7z", ".tar", ".gz", ".bz2", ".xz", ".tgz", ".rar"}
GENERATED_PARTS = {
    ".git",
    ".venv",
    "venv",
    "node_modules",
    "__pycache__",
    ".pytest_cache",
    ".ruff_cache",
    ".output",
    ".nitro",
    ".vite",
    "playwright-report",
    "test-results",
}


class ScanError(Exception):
    """A redacted operational error, safe to print without subprocess output."""


@dataclass(frozen=True)
class GitEntry:
    path: str
    mode: str
    oid: str
    size: int


def normalized_path(value: str) -> str:
    if not isinstance(value, str) or not value or any(ord(char) < 32 for char in value):
        raise ScanError("An allowlist path is empty or contains control characters")
    value = value.replace("\\", "/")
    if value.startswith("/") or ":" in value or ".." in value.split("/"):
        raise ScanError("An allowlist path is not a safe repository-relative path")
    path = PurePosixPath(value).as_posix()
    if path in {".", ""}:
        raise ScanError("An allowlist entry does not identify a file")
    return path


def read_allowlist(path: Path) -> set[str]:
    try:
        text = path.read_text(encoding="utf-8-sig")
        if path.suffix.lower() == ".json":
            raw = json.loads(text)
            raw = raw.get("files") if isinstance(raw, dict) else raw
            if not isinstance(raw, list):
                raise ScanError("JSON allowlist must contain a files list")
            values = [row.get("path") if isinstance(row, dict) else row for row in raw]
        else:
            values = [
                line.strip()
                for line in text.splitlines()
                if line.strip() and not line.lstrip().startswith("#")
            ]
        paths = [normalized_path(value) for value in values]
    except (OSError, UnicodeError, ValueError, TypeError) as exc:
        raise ScanError("Allowlist could not be read or has an invalid shape") from exc
    if len(paths) != len(set(paths)) or len(paths) != len(
        {path.casefold() for path in paths}
    ):
        raise ScanError("Allowlist contains duplicate or case-colliding paths")
    return set(paths)


def finding(
    path: str, category: str, *, line: int | None = None, scope: str = "candidate"
) -> dict:
    result = {
        "path": safe_display_path(path),
        "type": category,
        "value": REDACTED,
        "scope": scope,
    }
    if line is not None:
        result["line"] = line
    return result


def safe_display_path(path: str) -> str:
    """Even a token accidentally used as a filename must stay redacted."""
    for pattern in SECRET_PATTERNS.values():
        path = pattern.sub(REDACTED, path)
    return path


def path_category(path: str) -> str | None:
    parts = PurePosixPath(path).parts
    lower = path.casefold()
    name = parts[-1].casefold()
    if any(pattern.search(path) for pattern in SECRET_PATTERNS.values()):
        return "secret-token-in-path"
    if any(part.casefold() in GENERATED_PARTS for part in parts):
        return "generated-or-git-internal-path"
    if lower.startswith("reports/audits/"):
        return "private-audit-or-backup"
    if lower.startswith(
        (".aws/", ".azure/", ".ssh/", ".kube/", ".config/gcloud/", ".dvc/")
    ) and lower not in {
        ".dvc/config",
        ".dvc/.gitignore",
    }:
        return "private-local-configuration"
    # Public descriptors (including legacy backups/*.dvc) never exempt private
    # Git/cache/audit directories. Their content still requires strict checks.
    if (
        name == ".gitignore"
        or lower.endswith(".dvc")
        or lower == "configs/dashboard-snapshot.json"
    ):
        return None
    if lower.startswith("backups/"):
        return "private-audit-or-backup"
    if lower.startswith(
        (
            "data/",
            "datasets/",
            "models/",
            "runs/",
            "weights/",
            "mlruns/",
            "mlartifacts/",
        )
    ):
        return "dataset-model-or-tracking-data"
    if re.search(r"(?:^|/)val_batch[^/]*\.(?:jpg|jpeg|png)$", lower):
        return "dataset-derived-mosaic"
    if re.search(r"\.(?:sqlite3?|db)(?:[-.].*)?$", name):
        return "sqlite-or-database-file"
    if name == ".env" or (
        name.startswith(".env.")
        and name not in {".env.example", ".env.sample", ".env.template"}
    ):
        return "environment-secret-file"
    if (
        name in {"id_rsa", "id_dsa", "id_ecdsa", "id_ed25519"}
        or PurePosixPath(name).suffix in PRIVATE_SUFFIXES
    ):
        return "private-key-file"
    if any(
        fnmatch.fnmatch(name, pattern)
        for pattern in (
            "credentials*",
            "client_secret*",
            "*token*.json",
            "oauth*.json",
            "service-account*.json",
            "service_account*.json",
            "application_default_credentials.json",
            "kubeconfig*",
            "secrets.*",
        )
    ):
        return "credential-or-oauth-file"
    if PurePosixPath(name).suffix in WEIGHT_SUFFIXES:
        return "model-or-binary-artifact"
    if PurePosixPath(name).suffix in ARCHIVE_SUFFIXES:
        return "archive-or-backup-artifact"
    return None


def public_dvc_metadata(text: str) -> bool:
    """Accept only one ordinary DVC out with reviewed public scalar fields."""
    lines = [
        line.strip()
        for line in text.splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]
    if not lines or lines[0] != "outs:":
        return False
    fields = {}
    out_count = 0
    for line in lines[1:]:
        if line.startswith("- "):
            out_count += 1
            line = line[2:]
        if ":" not in line:
            return False
        key, value = (part.strip() for part in line.split(":", 1))
        if key not in {"md5", "size", "nfiles", "hash", "path"} or key in fields:
            return False
        if value.startswith(("&", "*", "!", "{", "[")):
            return False
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        fields[key] = value
    if out_count != 1 or not {"md5", "size", "path"}.issubset(fields):
        return False
    if not re.fullmatch(r"[a-f0-9]{32}(?:\.dir)?", fields["md5"]):
        return False
    if not fields["size"].isdigit() or (
        "nfiles" in fields and not fields["nfiles"].isdigit()
    ):
        return False
    if fields.get("hash", "md5") != "md5":
        return False
    try:
        normalized_path(fields["path"])
    except ScanError:
        return False
    return True


def public_snapshot_metadata(text: str) -> bool:
    """Check public shape/digests without importing or executing candidate code.

    The application's dedicated snapshot tests validate domain semantics. This
    independent publication gate rejects unknown storage/credential fields and
    non-numeric metric payloads rather than trusting a specially named file.
    """
    envelope = json.loads(text)

    def exact(value, names):
        return isinstance(value, dict) and set(value) == set(names.split())

    def numbers(value):
        return isinstance(value, dict) and all(
            isinstance(key, str) and type(number) in {int, float}
            for key, number in value.items()
        )

    def digest(value):
        data = json.dumps(
            value,
            sort_keys=True,
            ensure_ascii=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode()
        return hashlib.sha256(data).hexdigest()

    if not exact(
        envelope,
        "schema_version generated_at sources payload payload_sha256 manifest_sha256",
    ):
        return False
    if type(envelope["schema_version"]) is not int or envelope["schema_version"] != 1:
        return False
    if not isinstance(envelope["generated_at"], str) or not isinstance(
        envelope["sources"], list
    ):
        return False
    for source in envelope["sources"]:
        if (
            not exact(source, "path sha256")
            or not isinstance(source["sha256"], str)
            or not re.fullmatch(r"[a-f0-9]{64}", source["sha256"])
        ):
            return False
        normalized_path(source["path"])
    payload = envelope["payload"]
    if (
        not exact(payload, "evaluations datasets mlops")
        or not isinstance(payload["evaluations"], list)
        or not isinstance(payload["datasets"], list)
    ):
        return False
    for row in payload["evaluations"]:
        if not exact(
            row, "id name task status source recorded_at metrics explanation"
        ) or not numbers(row["metrics"]):
            return False
    for row in payload["datasets"]:
        if not exact(
            row,
            "id name path dvc_file status version size_bytes file_count local_available statistics statistics_source split_summary explanation",
        ) or not numbers(row["statistics"]):
            return False
        splits = row["split_summary"]
        if splits is not None:
            if not isinstance(splits, dict) or not set(splits).issubset(
                {"train", "val", "test"}
            ):
                return False
            for split in splits.values():
                if (
                    not isinstance(split, dict)
                    or not set(split).issubset({"images", "groups", "classes"})
                    or not numbers(split.get("classes"))
                ):
                    return False
    mlops = payload["mlops"]
    if not exact(mlops, "dvc mlflow training_runs ci"):
        return False
    if not exact(
        mlops["dvc"],
        "status tracked_datasets remote_configured remote_names remote_accessible artifacts_synchronized explanation",
    ):
        return False
    flow = mlops["mlflow"]
    if not exact(flow, "status source experiments runs registry explanation"):
        return False
    for key, fields in (
        ("experiments", "id name"),
        ("registry", "name version stage status run_id"),
        ("runs", "id name experiment_id status start_time end_time metrics"),
    ):
        if not isinstance(flow[key], list) or any(
            not exact(row, fields) for row in flow[key]
        ):
            return False
    if any(not numbers(row["metrics"]) for row in flow["runs"]):
        return False
    if not isinstance(mlops["training_runs"], list):
        return False
    for row in mlops["training_runs"]:
        if not exact(
            row, "id name source epochs last_metrics recorded_at"
        ) or not numbers(row["last_metrics"]):
            return False
    if not exact(mlops["ci"], "configured source execution_status explanation"):
        return False
    return envelope["payload_sha256"] == digest(payload) and envelope[
        "manifest_sha256"
    ] == digest(
        {
            key: value
            for key, value in envelope.items()
            if key not in {"payload", "manifest_sha256"}
        }
    )


def placeholder(value: str) -> bool:
    value = value.strip().strip("\"'").casefold()
    if value in {
        "secret",
        "password",
        "private-secret",
        "test-secret",
        "fake-secret",
        "not-a-secret",
        "changeme",
        "redacted",
        "placeholder",
        "example",
        "sample",
        "dummy",
        "pass",
        "token",
    }:
        return True
    return value.startswith(
        (
            "${",
            "<",
            "your_",
            "your-",
            "example-",
            "dummy-",
            "placeholder-",
            "[redacted]",
        )
    )


def decoded_text(data: bytes) -> str:
    for prefix, encoding in (
        (b"\xff\xfe\x00\x00", "utf-32"),
        (b"\x00\x00\xfe\xff", "utf-32"),
        (b"\xff\xfe", "utf-16"),
        (b"\xfe\xff", "utf-16"),
    ):
        if data.startswith(prefix):
            return data.decode(encoding, errors="replace")
    return data.decode("utf-8-sig", errors="replace")


def scan_blob(path: str, data: bytes, *, scope: str) -> list[dict]:
    issues = []
    category = path_category(path)
    if category:
        issues.append(finding(path, category, scope=scope))
    if data.startswith(b"SQLite format 3\x00"):
        issues.append(finding(path, "sqlite-content-signature", scope=scope))
    if (
        data.startswith(
            (b"PK\x03\x04", b"\x1f\x8b", b"7z\xbc\xaf\x27\x1c", b"BZh", b"\xfd7zXZ\x00")
        )
        or data[257:262] == b"ustar"
    ):
        issues.append(finding(path, "archive-content-signature", scope=scope))
    text = decoded_text(data)
    if path.casefold().endswith(".dvc") and not public_dvc_metadata(text):
        issues.append(finding(path, "unreviewed-dvc-metadata-shape", scope=scope))
    if path.casefold() == "configs/dashboard-snapshot.json":
        try:
            valid_snapshot = public_snapshot_metadata(text)
        except (ScanError, ValueError, TypeError, KeyError):
            valid_snapshot = False
        if not valid_snapshot:
            issues.append(
                finding(path, "unreviewed-public-snapshot-shape", scope=scope)
            )
    seen = set()

    def add_match(kind: str, start: int):
        key = (kind, text.count("\n", 0, start) + 1)
        if key not in seen and len(seen) < MAX_SECRET_FINDINGS_PER_FILE:
            seen.add(key)
            issues.append(finding(path, kind, line=key[1], scope=scope))

    for kind, pattern in SECRET_PATTERNS.items():
        for match in pattern.finditer(text):
            add_match(kind, match.start())
    for match in LITERAL_ASSIGNMENT.finditer(text):
        if not placeholder(match.group("secretvalue")):
            add_match("literal-sensitive-assignment", match.start())
    if PurePosixPath(path).suffix.casefold() == ".py":
        # Inspect decoded constant strings without executing code. This catches
        # credentials in config templates, while a fragment such as KEY=" plus
        # a variable is not mistaken for a quoted credential assignment.
        try:
            constants = (
                node
                for node in ast.walk(ast.parse(text))
                if isinstance(node, ast.Constant) and isinstance(node.value, str)
            )
            line_offsets = [0]
            for line in text.splitlines(keepends=True):
                line_offsets.append(line_offsets[-1] + len(line))
            for node in constants:
                for match in LITERAL_ASSIGNMENT.finditer(node.value):
                    if not placeholder(match.group("secretvalue")):
                        add_match(
                            "literal-sensitive-assignment",
                            line_offsets[node.lineno - 1],
                        )
                for match in CONFIG_ASSIGNMENT.finditer(node.value):
                    if not placeholder(match.group(1)):
                        add_match(
                            "literal-sensitive-assignment",
                            line_offsets[node.lineno - 1],
                        )
        except SyntaxError:
            # Syntax compilation is a separate CI check; known secret prefixes
            # and raw literal assignments above are still inspected.
            pass
    if PurePosixPath(path).suffix.casefold() in CONFIG_SUFFIXES or PurePosixPath(
        path
    ).name.casefold().startswith(".env"):
        for match in CONFIG_ASSIGNMENT.finditer(text):
            if not placeholder(match.group(1)):
                add_match("literal-sensitive-assignment", match.start())
    for match in CREDENTIAL_URL.finditer(text):
        if not placeholder(match.group(2)):
            add_match("credential-in-url", match.start())
    return issues


def report(
    mode: str,
    paths: Iterable[str],
    issues: list[dict],
    *,
    missing: Iterable[str] = (),
    deleted: Iterable[str] = (),
) -> dict:
    paths = sorted(paths)
    return {
        "mode": mode,
        "status": "FAIL" if issues else "PASS",
        "files_scanned": len(paths),
        "paths_scanned": [safe_display_path(path) for path in paths],
        "findings_count": len(issues),
        "findings": issues,
        "missing_from_selection": [safe_display_path(path) for path in sorted(missing)],
        "approved_deletions_selected": [
            safe_display_path(path) for path in sorted(deleted)
        ],
        "limits": [
            "Known-pattern and path-policy check; not a guarantee that all possible secrets are absent.",
            "Binary image/PDF pixels are not OCR-scanned; public captures require manual review.",
            "Tracked scan covers current HEAD blobs only, not complete Git history.",
            "No Git staging, removal, commit, branch, network, or history mutation is performed.",
        ],
    }


def scan_tree(
    tree: Path, allowlist: set[str], *, max_bytes: int = DEFAULT_MAX_BYTES
) -> dict:
    root = tree.resolve(strict=True)
    paths = set()
    issues = []
    for directory, names, files in os.walk(root, followlinks=False):
        directory = Path(directory)
        for name in list(names):
            path = directory / name
            relative = path.relative_to(root).as_posix()
            attributes = path.lstat()
            reparse = getattr(attributes, "st_file_attributes", 0) & getattr(
                stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400
            )
            if path.is_symlink() or reparse:
                issues.append(finding(relative, "symlink-or-reparse-point"))
                names.remove(name)
            elif name.casefold() in GENERATED_PARTS:
                issues.append(finding(relative, "generated-or-git-internal-path"))
                names.remove(name)
        for name in files:
            path = directory / name
            relative = normalized_path(path.relative_to(root).as_posix())
            paths.add(relative)
            if len(paths) > MAX_FILES:
                raise ScanError("Export exceeds the maximum file count")
            if relative not in allowlist:
                issues.append(finding(relative, "not-in-allowlist"))
            attributes = path.lstat()
            if path.is_symlink() or (
                getattr(attributes, "st_file_attributes", 0)
                & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
            ):
                issues.append(finding(relative, "symlink-or-reparse-point"))
                continue
            if not stat.S_ISREG(
                attributes.st_mode
            ) or not path.resolve().is_relative_to(root):
                issues.append(finding(relative, "nonregular-or-outside-tree"))
                continue
            if attributes.st_size > max_bytes:
                issues.append(finding(relative, "file-exceeds-size-limit"))
                continue
            issues.extend(
                scan_blob(relative, path.read_bytes(), scope="candidate-tree")
            )
    for missing in sorted(allowlist - paths):
        issues.append(finding(missing, "allowlisted-file-missing"))
    return report("candidate-tree", paths, issues, missing=allowlist - paths)


def git_read(repo: Path, args: list[str]) -> bytes:
    process = subprocess.run(
        ["git", "--no-optional-locks", "-C", str(repo), *args],
        capture_output=True,
        check=False,
    )
    if process.returncode:
        raise ScanError(
            f"Read-only Git command failed with exit {process.returncode}; output redacted"
        )
    return process.stdout


def tracked_entries(repo: Path) -> list[GitEntry]:
    entries = []
    for row in git_read(repo, ["ls-tree", "-r", "-l", "-z", "HEAD"]).split(b"\0"):
        if not row:
            continue
        metadata, path = row.split(b"\t", 1)
        mode, _kind, oid, size = metadata.decode("ascii").split()
        entries.append(
            GitEntry(
                normalized_path(path.decode("utf-8")),
                mode,
                oid,
                int(size) if size.isdigit() else 0,
            )
        )
    return entries


def scan_git_entries(
    repo: Path, entries: list[GitEntry], scope: str, *, max_bytes: int
) -> list[dict]:
    if len(entries) > MAX_FILES:
        raise ScanError("Git selection exceeds the maximum file count")
    issues = []
    for entry in entries:
        if entry.mode not in {"100644", "100755"}:
            issues.append(finding(entry.path, "nonregular-git-entry", scope=scope))
            continue
        if entry.size > max_bytes:
            issues.append(finding(entry.path, "file-exceeds-size-limit", scope=scope))
            continue
        if not re.fullmatch(r"[a-f0-9]{40,64}", entry.oid):
            raise ScanError("Git returned an invalid object identifier")
        data = git_read(repo, ["cat-file", "blob", entry.oid])
        issues.extend(scan_blob(entry.path, data, scope=scope))
    return issues


def scan_tracked(repo: Path, *, max_bytes: int = DEFAULT_MAX_BYTES) -> dict:
    entries = tracked_entries(repo)
    issues = scan_git_entries(
        repo, entries, "already-tracked-head", max_bytes=max_bytes
    )
    for issue in issues:
        issue["disposition"] = (
            "Already present in current HEAD; not approved for the future candidate tree"
        )
    return report("already-tracked-head", [entry.path for entry in entries], issues)


def scan_index(
    repo: Path,
    allowlist: set[str],
    removals: set[str],
    *,
    max_bytes: int = DEFAULT_MAX_BYTES,
    require_complete: bool = False,
) -> dict:
    changed = {
        normalized_path(path.decode("utf-8"))
        for path in git_read(
            repo,
            [
                "diff",
                "--cached",
                "--no-renames",
                "--name-only",
                "-z",
                "--diff-filter=ACMRT",
            ],
        ).split(b"\0")
        if path
    }
    deleted = {
        normalized_path(path.decode("utf-8"))
        for path in git_read(
            repo,
            [
                "diff",
                "--cached",
                "--no-renames",
                "--name-only",
                "-z",
                "--diff-filter=D",
            ],
        ).split(b"\0")
        if path
    }
    entries = []
    issues = []
    for path in sorted(changed - allowlist):
        issues.append(
            finding(path, "staged-file-not-allowlisted", scope="staged-index")
        )
    for path in sorted(deleted - removals):
        issues.append(
            finding(path, "staged-deletion-not-approved", scope="staged-index")
        )
    for row in git_read(repo, ["ls-files", "--stage", "-z"]).split(b"\0"):
        if not row:
            continue
        metadata, raw_path = row.split(b"\t", 1)
        path = normalized_path(raw_path.decode("utf-8"))
        mode, oid, stage = metadata.decode("ascii").split()
        if stage != "0":
            issues.append(finding(path, "unmerged-index-entry", scope="staged-index"))
            continue
        if path in changed:
            size = int(git_read(repo, ["cat-file", "-s", oid]))
            entries.append(GitEntry(path, mode, oid, size))
    issues.extend(scan_git_entries(repo, entries, "staged-index", max_bytes=max_bytes))
    missing = (allowlist - changed) | (removals - deleted)
    if require_complete:
        issues.extend(
            finding(path, "approved-change-not-staged", scope="staged-index")
            for path in sorted(missing)
        )
    result = report(
        "staged-index", changed, issues, missing=missing, deleted=deleted & removals
    )
    result["selection_complete"] = not missing
    result["index_was_only_read"] = True
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument(
        "--tree",
        type=Path,
        help="Exported candidate directory; allowlist describes its entire content",
    )
    modes.add_argument(
        "--index",
        action="store_true",
        help="Read the actual staged blobs, never worktree substitutes",
    )
    modes.add_argument(
        "--tracked",
        action="store_true",
        help="Audit blobs in current HEAD without traversing history",
    )
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument("--allowlist", type=Path)
    parser.add_argument("--remove-allowlist", type=Path)
    parser.add_argument(
        "--require-complete",
        action="store_true",
        help="Index selection must match all approved additions/changes/deletions",
    )
    parser.add_argument("--max-file-bytes", type=int, default=DEFAULT_MAX_BYTES)
    parser.add_argument(
        "--json",
        type=Path,
        help="Optional explicit report output; otherwise no filesystem writes",
    )
    args = parser.parse_args()
    if args.max_file_bytes < 1 or (
        (args.tree or args.index) and args.allowlist is None
    ):
        parser.error(
            "A positive size limit and an explicit allowlist are required for candidate/index scans"
        )
    try:
        allowlist = read_allowlist(args.allowlist) if args.allowlist else set()
        removals = (
            read_allowlist(args.remove_allowlist) if args.remove_allowlist else set()
        )
        if args.tree:
            result = scan_tree(args.tree, allowlist, max_bytes=args.max_file_bytes)
        elif args.index:
            result = scan_index(
                args.repo,
                allowlist,
                removals,
                max_bytes=args.max_file_bytes,
                require_complete=args.require_complete,
            )
        else:
            result = scan_tracked(args.repo, max_bytes=args.max_file_bytes)
        if args.json:
            args.json.parent.mkdir(parents=True, exist_ok=True)
            args.json.write_text(
                json.dumps(result, indent=2, ensure_ascii=True) + "\n", encoding="utf-8"
            )
        print(
            f"{result['status']}: {result['mode']}; {result['files_scanned']} files; {result['findings_count']} findings"
        )
        for issue in result["findings"]:
            line = f":{issue['line']}" if "line" in issue else ""
            print(f"{issue['path']}{line}: {issue['type']} {REDACTED}")
        if args.index:
            print(
                f"Staged selection complete: {result['selection_complete']} (no staging performed)"
            )
        return 1 if result["findings"] else 0
    except (ScanError, OSError, UnicodeError, ValueError) as exc:
        # Do not print underlying file contents, process stderr or secret values.
        print(f"ERROR: {type(exc).__name__}; scan could not complete; details redacted")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
