"""Disposable history/503 fixture for local E2E; never initializes trained models."""
import argparse
from contextlib import asynccontextmanager
import os
from pathlib import Path
import sys

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--port", type=int, choices=[18801, 18803], required=True)
parser.add_argument("--database", type=Path, required=True)
args = parser.parse_args()
database = args.database.resolve()
if database.exists():
    raise SystemExit("Refusing an existing database. Supply a new disposable file; no data was changed.")
database.parent.mkdir(parents=True, exist_ok=True)
os.environ["SOLARVISION_HISTORY_DB"] = str(database)
os.environ["SOLARVISION_CORS_ORIGINS"] = "http://127.0.0.1:8181,http://127.0.0.1:8182"
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from src.api import main as api
import uvicorn


@asynccontextmanager
async def no_models(app):
    api.pipeline = None
    yield


api.app.router.lifespan_context = no_models
print(f"Disposable E2E fixture: port={args.port}; database={database}; no trained models", flush=True)
uvicorn.run(api.app, host="127.0.0.1", port=args.port)
