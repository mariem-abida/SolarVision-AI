
# Base digest used by the validated CPU candidate (Python 3.11.18).
FROM python:3.11-slim@sha256:07d4824036af339fa1b6ef769cc99d9c10a141769538b52b3b597c84f7a7b535

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    YOLO_CONFIG_DIR=/tmp/Ultralytics \
    SOLARVISION_HISTORY_DB=/app/storage/inspections.sqlite3

RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libgl1 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt constraints-cpu.txt ./
# Exact Linux CPU dependency versions captured from the validated image.
# The +cpu constraints select official CPU wheels; no weights are downloaded.
RUN pip install --no-cache-dir "pip==26.3" "setuptools==79.0.1" "wheel==0.46.3" && \
    pip install --no-cache-dir \
      --constraint constraints-cpu.txt \
      --extra-index-url https://download.pytorch.org/whl/cpu \
      -r requirements.txt && \
    pip check

COPY src/ ./src/
ENV SOLARVISION_DASHBOARD_SNAPSHOT=/app/configs/dashboard-snapshot.json
# Public, allowlisted metadata only. No datasets, MLflow SQLite, secrets or
# trained weights are copied. Regenerate this reviewed snapshot on the host.
COPY configs/dashboard-snapshot.json ./configs/dashboard-snapshot.json
RUN python -c "from pathlib import Path; from src.api.dashboard_snapshot import read_snapshot; _, info = read_snapshot(Path('/app'), Path('/app/configs/dashboard-snapshot.json')); assert info['status'] == 'valid', info['explanation']"

RUN mkdir -p /app/storage

EXPOSE 8000

CMD ["uvicorn", "src.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
