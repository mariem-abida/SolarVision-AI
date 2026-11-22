"""Small SQLite history store. Only generated previews are retained, never uploads."""

import json
import os
import sqlite3
from contextlib import closing
from pathlib import Path
from time import perf_counter

from src.api.contracts import Inspection

ROOT = Path(__file__).resolve().parents[2]


def database_path() -> Path:
    return Path(
        os.environ.get("SOLARVISION_HISTORY_DB", str(ROOT / "data/inspections.sqlite3"))
    )


def connect():
    path = database_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=10)
    connection.execute(
        "CREATE TABLE IF NOT EXISTS inspections "
        "(id TEXT PRIMARY KEY, date TEXT NOT NULL, record TEXT NOT NULL, preview BLOB)"
    )
    return connection


def save_inspection(
    record: Inspection,
    preview: bytes | None = None,
    *,
    request_started_at: float | None = None,
) -> None:
    with closing(connect()) as connection, connection:
        inserted = connection.execute(
            "INSERT OR IGNORE INTO inspections(id,date,record,preview) VALUES(?,?,?,?)",
            (
                record.id,
                record.date,
                record.model_dump_json(exclude_none=True),
                preview,
            ),
        )
        if inserted.rowcount == 1 and request_started_at is not None:
            # Finalize only the row inserted in this transaction. Existing IDs,
            # including legacy timings, are never updated by inference/import.
            # The checkpoint includes decoding/inference and the initial INSERT,
            # but precedes this timing UPDATE and the transaction's final commit.
            elapsed = round(max(0, perf_counter() - request_started_at) * 1000, 3)
            record.request_duration_ms = elapsed
            record.result.request_duration_ms = elapsed
            connection.execute(
                "UPDATE inspections SET record=? WHERE id=?",
                (record.model_dump_json(exclude_none=True), record.id),
            )


def list_inspections(limit: int = 200, offset: int = 0) -> dict:
    with closing(connect()) as connection:
        total = connection.execute("SELECT COUNT(*) FROM inspections").fetchone()[0]
        records = connection.execute(
            "SELECT record FROM inspections ORDER BY date DESC, id DESC LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()
    return {"records": [json.loads(row[0]) for row in records], "total": total}


def get_preview(inspection_id: str) -> bytes | None:
    with closing(connect()) as connection:
        row = connection.execute(
            "SELECT preview FROM inspections WHERE id=?", (inspection_id,)
        ).fetchone()
    return row[0] if row else None
