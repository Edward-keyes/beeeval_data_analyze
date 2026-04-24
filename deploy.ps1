# ============================================================
#  BeeEVAL 部署脚本 (PowerShell)
#  用法: .\deploy.ps1 -ServerIP "114.215.186.130" [-User "root"] [-Port 22]
# ============================================================

param(
    [Parameter(Mandatory=$true)]
    [string]$ServerIP,
    [string]$User = "root",
    [int]$Port = 22
)

$ErrorActionPreference = "Stop"
$RemoteDir = "/data/beeeval"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  BeeEVAL Deploy Script" -ForegroundColor Cyan
Write-Host ("  Target: {0}@{1}:{2}" -f $User, $ServerIP, $RemoteDir) -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# ────────── Step 1: Build Frontend ──────────
Write-Host "`n[1/5] Building frontend..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) { throw "Frontend build failed" }
Write-Host "  OK - frontend built to dist/" -ForegroundColor Green

# ────────── Step 2: Check .env.production ──────────
Write-Host "`n[2/5] Checking .env.production..." -ForegroundColor Yellow
if (-not (Test-Path ".env.production")) {
    Write-Host "  .env.production not found! Please create it first. See docs/deployment-guide.md" -ForegroundColor Red
    exit 1
}
Write-Host "  OK - .env.production ready" -ForegroundColor Green

# ────────── Step 3: Package Files ──────────
Write-Host "`n[3/5] Packaging project files..." -ForegroundColor Yellow

$tarball = "beeeval-deploy.tar.gz"

tar -czf $tarball `
    --exclude="__pycache__" `
    --exclude="*.pyc" `
    --exclude="api/venv" `
    --exclude="api/llm_logs" `
    "api" `
    "public" `
    "dist" `
    "Dockerfile" `
    "docker-compose.production.yml" `
    "nginx.conf" `
    ".env.production" `
    ".dockerignore"

if ($LASTEXITCODE -ne 0) { throw "tar packaging failed" }

$size = [math]::Round((Get-Item $tarball).Length / 1MB, 1)
Write-Host ("  OK - {0} ({1} MB)" -f $tarball, $size) -ForegroundColor Green

# ────────── Step 4: Upload ──────────
Write-Host "`n[4/5] Uploading to server (~$size MB, please wait)..." -ForegroundColor Yellow

ssh -t -p $Port "$User@$ServerIP" "sudo mkdir -p /data/beeeval && sudo chown $User /data/beeeval"
if ($LASTEXITCODE -ne 0) { throw "SSH mkdir failed - check connection" }

scp -P $Port $tarball "${User}@${ServerIP}:/data/beeeval/"
if ($LASTEXITCODE -ne 0) { throw "SCP upload failed" }

Write-Host "  OK - upload complete" -ForegroundColor Green

# ────────── Step 5: Remote Deploy ──────────
Write-Host "`n[5/5] Deploying on server..." -ForegroundColor Yellow

$remoteScript = @'
set -e
cd /data/beeeval
echo "  -> Extracting files..."
tar -xzf beeeval-deploy.tar.gz
rm -f beeeval-deploy.tar.gz
cp .env.production .env
cp docker-compose.production.yml docker-compose.yml

# Resolve HOST_MODEL_DIR exactly the same way docker-compose does.
# Fail fast with a clear message if the model has not been placed yet.
HOST_MODEL_DIR=$(grep -E "^HOST_MODEL_DIR=" .env | tail -n1 | cut -d= -f2-)
HOST_MODEL_DIR=${HOST_MODEL_DIR:-./model/bge-base-zh-v1.5}
case "$HOST_MODEL_DIR" in
    /*) ABS_MODEL_DIR="$HOST_MODEL_DIR" ;;
    *)  ABS_MODEL_DIR="/data/beeeval/${HOST_MODEL_DIR#./}" ;;
esac
if [ ! -f "${ABS_MODEL_DIR}/pytorch_model.bin" ]; then
    cat >&2 <<MSG
ERROR: embedding model not found at ${ABS_MODEL_DIR}
       (expected pytorch_model.bin).
Download it once on the server, e.g.:
    cd /data/beeeval
    pip install --user huggingface_hub
    HF_ENDPOINT=https://hf-mirror.com \
      python -m huggingface_hub snapshot-download BAAI/bge-base-zh-v1.5 \
      --local-dir ./model/bge-base-zh-v1.5 --local-dir-use-symlinks False
Then rerun this deploy.
MSG
    exit 1
fi
echo "  -> Embedding model OK: ${ABS_MODEL_DIR}"

echo "  -> Building Docker images (first time ~5-10 min)..."
docker compose build
echo "  -> Starting services..."
docker compose up -d
sleep 5
echo "  -> Service status:"
docker compose ps
echo ""
echo "========================================"
echo "  Deploy complete!"
echo "========================================"
'@

$remoteScript | ssh -p $Port "$User@$ServerIP" "bash -s"
if ($LASTEXITCODE -ne 0) { throw "Remote deploy failed" }

# Cleanup
Remove-Item $tarball -ErrorAction SilentlyContinue

Write-Host "`nDeploy finished!" -ForegroundColor Green
Write-Host ("  Frontend: http://{0}" -f $ServerIP) -ForegroundColor Cyan
Write-Host ("  API:      http://{0}/api" -f $ServerIP) -ForegroundColor Cyan
Write-Host ("  Dr.Bee:   http://{0}/dr-bee" -f $ServerIP) -ForegroundColor Cyan
