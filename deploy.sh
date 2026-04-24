#!/bin/bash
# ============================================================
#  BeeEVAL 一键部署脚本
#  用法: bash deploy.sh <服务器IP> [SSH用户名] [SSH端口]
#  示例: bash deploy.sh 114.215.186.130 root 22
# ============================================================

set -e

# ────────── 参数 ──────────
SERVER_IP="${1:?请提供服务器IP，用法: bash deploy.sh <IP> [用户] [端口]}"
SSH_USER="${2:-root}"
SSH_PORT="${3:-22}"
REMOTE_DIR="/opt/beeeval"
SSH_CMD="ssh -p ${SSH_PORT} ${SSH_USER}@${SERVER_IP}"
SCP_CMD="scp -P ${SSH_PORT}"

echo "========================================"
echo "  BeeEVAL 部署脚本"
echo "  目标: ${SSH_USER}@${SERVER_IP}:${REMOTE_DIR}"
echo "========================================"

# ────────── Step 1: 本地构建前端 ──────────
echo ""
echo "[1/5] 构建前端..."
if command -v npm &> /dev/null; then
    npm run build
    echo "  ✓ 前端构建完成 → dist/"
else
    echo "  ✗ 未找到 npm，请先手动执行 npm run build"
    exit 1
fi

# ────────── Step 2: 生成服务器 .env ──────────
echo ""
echo "[2/5] 生成服务器环境配置 .env.production..."
cat > .env.production << 'ENVEOF'
# ===== PostgreSQL =====
DB_HOST=postgres
DB_PORT=5432
DB_NAME=beeeval
DB_USER=postgres
DB_PASSWORD=CHANGE_ME_TO_STRONG_PASSWORD

# ===== LLM =====
LLM_API_KEY=sk-9hCFZx9h9H3o1yKAmSf06OARasPMcXbaPiSu7nEWAPaTUitZ
LLM_BASE_URL=https://ai.juguang.chat/v1/chat/completions
LLM_MODEL=[1刀/次]gemini-3-pro-preview-think

# ===== NAS =====
NAS_URL=http://114.215.186.130:8900
NAS_TOKEN=K2z4sxdJXvVD3oEnkf9uHGEIOHAX59wT-1v8pABUMS8
NAS_VIDEO_ROOT=/volume1/beeeval/BeeEval测试视频

# ===== Redis / Celery =====
REDIS_URL=redis://redis:6379/0
CELERY_BROKER_URL=redis://redis:6379/0
USE_CELERY=true

# ===== Qdrant =====
QDRANT_URL=http://qdrant:6333
QDRANT_COLLECTION=beeeval
EMBEDDING_MODEL_PATH=/app/model/bge-base-zh-v1.5
ENVEOF
echo "  ✓ .env.production 已生成（请编辑修改数据库密码！）"

# ────────── Step 3: 打包上传文件 ──────────
echo ""
echo "[3/5] 打包项目文件..."

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
    model/bge-base-zh-v1.5/ \
    dist/ \
    Dockerfile \
    docker-compose.production.yml \
    nginx.conf \
    .env.production \
    .dockerignore

echo "  ✓ 打包完成: ${TARBALL} ($(du -h ${TARBALL} | cut -f1))"

echo ""
echo "[4/5] 上传到服务器..."
${SSH_CMD} "mkdir -p ${REMOTE_DIR}"
${SCP_CMD} "${TARBALL}" "${SSH_USER}@${SERVER_IP}:${REMOTE_DIR}/"
echo "  ✓ 上传完成"

# ────────── Step 4: 远程部署 ──────────
echo ""
echo "[5/5] 远程部署..."
${SSH_CMD} << REMOTEOF
set -e
cd ${REMOTE_DIR}

echo "  → 解压文件..."
tar -xzf beeeval-deploy.tar.gz
rm -f beeeval-deploy.tar.gz

# 使用生产配置
cp .env.production .env
mv docker-compose.production.yml docker-compose.yml

echo "  → 构建 Docker 镜像..."
docker compose build

echo "  → 启动服务..."
docker compose up -d

echo "  → 等待服务就绪..."
sleep 10

echo "  → 服务状态:"
docker compose ps

echo ""
echo "============================================"
echo "  部署完成！"
echo "  前端: http://${SERVER_IP}"
echo "  API:  http://${SERVER_IP}/api"
echo "  Dr.Bee: http://${SERVER_IP}/dr-bee"
echo "============================================"
REMOTEOF

# 清理本地临时文件
rm -f "${TARBALL}"
echo ""
echo "本地临时文件已清理。部署完毕！"
