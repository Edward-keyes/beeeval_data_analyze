FROM python:3.12-slim AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg libgl1 libglib2.0-0 curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY api/requirements.txt /app/api/requirements.txt
RUN pip install --no-cache-dir -r api/requirements.txt \
    -i https://pypi.tuna.tsinghua.edu.cn/simple

COPY api/ /app/api/
COPY public/ /app/public/
# NOTE: the embedding model (BAAI/bge-base-zh-v1.5, ~400 MB) is NOT
# baked into the image -- it's mounted in via docker-compose as
# ${HOST_MODEL_DIR}:/app/model/bge-base-zh-v1.5:ro. Download it once
# per host using scripts/download-model.{sh,ps1}.

ENV PYTHONPATH=/app
ENV TZ=Asia/Shanghai

EXPOSE 8004

# ---------- API image ----------
FROM base AS api
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8004", "--workers", "2"]

# ---------- Worker image ----------
FROM base AS worker
CMD ["celery", "-A", "api.celery_app", "worker", \
     "--concurrency=3", "--pool=prefork", \
     "-Q", "video_analysis", "--loglevel=info"]
