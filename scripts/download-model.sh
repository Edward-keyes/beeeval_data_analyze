#!/usr/bin/env bash
# ============================================================
#  Download BAAI/bge-base-zh-v1.5 to ./model/bge-base-zh-v1.5
#  so Docker build can COPY it. (The model is too big for git.)
#
#  Usage:
#    ./scripts/download-model.sh                 # HuggingFace official
#    HF_ENDPOINT=https://hf-mirror.com ./scripts/download-model.sh
#    ./scripts/download-model.sh BAAI/bge-base-zh-v1.5 ./model/bge-base-zh-v1.5
# ============================================================

set -euo pipefail

REPO_ID="${1:-BAAI/bge-base-zh-v1.5}"
OUT_DIR="${2:-model/bge-base-zh-v1.5}"

echo "========================================"
echo "  BeeEVAL model downloader"
echo "  Repo: ${REPO_ID}"
echo "  Dest: ${OUT_DIR}"
[ -n "${HF_ENDPOINT:-}" ] && echo "  Mirror: ${HF_ENDPOINT}"
echo "========================================"

PY="$(command -v python3 || command -v python || true)"
if [ -z "$PY" ]; then
    echo "python3 not found on PATH. Install Python 3.9+ and re-run." >&2
    exit 1
fi

if ! "$PY" -c "import huggingface_hub" >/dev/null 2>&1; then
    echo "huggingface_hub not installed, installing..."
    "$PY" -m pip install --upgrade huggingface_hub
fi

"$PY" - "$REPO_ID" "$OUT_DIR" <<'PY'
import os, sys
from huggingface_hub import snapshot_download
repo, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
p = snapshot_download(
    repo_id=repo,
    local_dir=out,
    local_dir_use_symlinks=False,
    allow_patterns=[
        "*.bin", "*.safetensors", "*.json", "*.txt", "*.md",
        "tokenizer*", "vocab*", "special_tokens_map*", "sentence_bert_config*",
    ],
)
print(p)
PY

echo ""
echo "Done. Next: ./deploy.sh <ip> <user> <port>  (Docker build will COPY model/)"
