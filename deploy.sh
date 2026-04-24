#!/bin/bash
# ============================================================
#  BeeEVAL one-click deploy script (Linux / macOS)
#  Usage: bash deploy.sh <server-ip> [ssh-user] [ssh-port]
#  Example: bash deploy.sh 114.215.186.130 root 22
#
#  IMPORTANT: before first deploy, on YOUR local machine:
#    1. cp .env.production.example .env.production
#       Fill in every <REPLACE_ME_*> secret.
#    2. Make sure ./model/bge-base-zh-v1.5/ has pytorch_model.bin
#       locally (run scripts/download-model.sh once). The model
#       is NOT shipped in the Docker image anymore; the server
#       will bind-mount ITS OWN copy -- so also drop a copy on
#       the server at /data/beeeval/model/bge-base-zh-v1.5 (or
#       override HOST_MODEL_DIR in .env.production).
# ============================================================

set -euo pipefail

SERVER_IP="${1:?usage: bash deploy.sh <ip> [user] [port]}"
SSH_USER="${2:-root}"
SSH_PORT="${3:-22}"
REMOTE_DIR="/data/beeeval"
SSH_CMD=(ssh -p "${SSH_PORT}" "${SSH_USER}@${SERVER_IP}")
SCP_CMD=(scp -P "${SSH_PORT}")

echo "========================================"
echo "  BeeEVAL deploy"
echo "  Target: ${SSH_USER}@${SERVER_IP}:${REMOTE_DIR}"
echo "========================================"

# ----- 1. Build frontend -----
echo ""
echo "[1/5] Building frontend..."
if ! command -v npm >/dev/null 2>&1; then
    echo "  ERROR: npm not found on PATH" >&2
    exit 1
fi
npm run build
echo "  OK -> dist/"

# ----- 2. Check .env.production -----
echo ""
echo "[2/5] Checking .env.production..."
if [ ! -f .env.production ]; then
    cat >&2 <<'MSG'
  ERROR: .env.production not found.
  Copy the template and fill in real values first:
    cp .env.production.example .env.production
    $EDITOR .env.production
MSG
    exit 1
fi
if grep -q '<REPLACE_ME_' .env.production; then
    echo "  WARN: .env.production still contains <REPLACE_ME_*> placeholders."
    echo "        Fill in real secrets before continuing."
    exit 1
fi
echo "  OK"

# ----- 3. Package files -----
echo ""
echo "[3/5] Packaging project files..."
TARBALL="beeeval-deploy.tar.gz"
tar -czf "${TARBALL}" \
    --exclude='node_modules' \
    --exclude='.git' \
    --exclude='.cursor' \
    --exclude='.vscode' \
    --exclude='__pycache__' \
    --exclude='*.pyc' \
    --exclude='temp_files' \
    --exclude='agent-transcripts' \
    --exclude='encrypt' \
    --exclude='.env.local' \
    --exclude='api/venv' \
    --exclude='api/llm_logs' \
    api/ \
    public/ \
    dist/ \
    Dockerfile \
    docker-compose.production.yml \
    nginx.conf \
    .env.production \
    .dockerignore
echo "  OK -> ${TARBALL} ($(du -h "${TARBALL}" | cut -f1))"

# ----- 4. Upload -----
echo ""
echo "[4/5] Uploading..."
"${SSH_CMD[@]}" "mkdir -p ${REMOTE_DIR}"
"${SCP_CMD[@]}" "${TARBALL}" "${SSH_USER}@${SERVER_IP}:${REMOTE_DIR}/"
echo "  OK"

# ----- 5. Remote deploy -----
echo ""
echo "[5/5] Remote deploy..."
"${SSH_CMD[@]}" bash -s <<REMOTE
set -e
cd ${REMOTE_DIR}

echo "  -> Extracting..."
tar -xzf beeeval-deploy.tar.gz
rm -f beeeval-deploy.tar.gz

cp .env.production .env
cp docker-compose.production.yml docker-compose.yml

# Resolve HOST_MODEL_DIR and fail fast if the model is missing on the host.
HOST_MODEL_DIR=\$(grep -E "^HOST_MODEL_DIR=" .env | tail -n1 | cut -d= -f2-)
HOST_MODEL_DIR=\${HOST_MODEL_DIR:-./model/bge-base-zh-v1.5}
case "\$HOST_MODEL_DIR" in
    /*) ABS_MODEL_DIR="\$HOST_MODEL_DIR" ;;
    *)  ABS_MODEL_DIR="${REMOTE_DIR}/\${HOST_MODEL_DIR#./}" ;;
esac
if [ ! -f "\${ABS_MODEL_DIR}/pytorch_model.bin" ]; then
    cat >&2 <<MSG
ERROR: embedding model not found at \${ABS_MODEL_DIR}
       (expected pytorch_model.bin).
Download it once on the server, e.g.:
    cd ${REMOTE_DIR}
    pip install --user huggingface_hub
    HF_ENDPOINT=https://hf-mirror.com python -m huggingface_hub \\
      snapshot-download BAAI/bge-base-zh-v1.5 \\
      --local-dir ./model/bge-base-zh-v1.5 --local-dir-use-symlinks False
Then rerun this deploy.
MSG
    exit 1
fi
echo "  -> Embedding model OK: \${ABS_MODEL_DIR}"

echo "  -> Building Docker images..."
docker compose build

echo "  -> Starting services..."
docker compose up -d
sleep 10

echo "  -> Service status:"
docker compose ps

echo ""
echo "========================================"
echo "  Deploy complete!"
echo "  Frontend: http://${SERVER_IP}"
echo "  API:      http://${SERVER_IP}/api"
echo "  Dr.Bee:   http://${SERVER_IP}/dr-bee"
echo "========================================"
REMOTE

rm -f "${TARBALL}"
echo "Local temp files cleaned. Done."
