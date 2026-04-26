# ----------------------------------------------------------------------
# scripts/deploy-vehicle-scores.ps1
#
# 一键把「车辆评分 + 整数化」这次改动部署到服务器：
#   1. git push（如果有未提交改动则先帮你 add+commit）
#   2. 本地 npm run build
#   3. scp dist/* 到服务器
#   4. ssh 进服务器 git pull + 重 build api/worker + restart
#   5. 远端 curl /api/aggregation/vehicles 验证后端通
#
# 用法（在仓库根目录跑）：
#   .\scripts\deploy-vehicle-scores.ps1
#
# 可选环境变量：
#   $env:DEPLOY_HOST   = "114.215.186.130"
#   $env:DEPLOY_USER   = "xai"
#   $env:DEPLOY_PORT   = "8800"
#   $env:REMOTE_DIR    = "/data/beeeval_data_analyze"
# ----------------------------------------------------------------------
param(
    [switch]$SkipBuild,
    [switch]$SkipPush,
    [switch]$SkipScp,
    [switch]$SkipRemote
)

$ErrorActionPreference = "Stop"

$Host_  = if ($env:DEPLOY_HOST)   { $env:DEPLOY_HOST }   else { "114.215.186.130" }
$User   = if ($env:DEPLOY_USER)   { $env:DEPLOY_USER }   else { "xai" }
$Port   = if ($env:DEPLOY_PORT)   { $env:DEPLOY_PORT }   else { "8800" }
$Remote = if ($env:REMOTE_DIR)    { $env:REMOTE_DIR }    else { "/data/beeeval_data_analyze" }

function Step($msg) {
    Write-Host ""
    Write-Host "=====  $msg  =====" -ForegroundColor Cyan
}

function Ok($msg)   { Write-Host "[OK]   $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Err($msg)  { Write-Host "[ERR]  $msg" -ForegroundColor Red }

# -------- 0. 仓库根 --------
$repo = (git rev-parse --show-toplevel 2>$null)
if (-not $repo) {
    Err "当前目录不是 git 仓库，先 cd 到 BeeEVAL 根目录再跑。"
    exit 1
}
Set-Location -LiteralPath $repo
Ok "Repo: $repo"

# -------- 1. push --------
if (-not $SkipPush) {
    Step "1/5  Git: 检查是否有未提交改动"
    $changes = git status --porcelain
    if ($changes) {
        Warn "检测到未提交改动，自动 add+commit："
        git status --short
        git add -A
        $msg = Read-Host "提交说明（回车默认: chore: deploy vehicle scores）"
        if (-not $msg) { $msg = "chore: deploy vehicle scores" }
        git commit -m "$msg"
    } else {
        Ok "工作区干净。"
    }

    Step "1/5  Git: push"
    git push
    Ok "已推送。"
}

# -------- 2. build --------
if (-not $SkipBuild) {
    Step "2/5  npm run build"
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Err "前端 build 失败，看上方报错。"
        exit 1
    }
    if (-not (Test-Path "dist/index.html")) {
        Err "build 完成但没有 dist/index.html，请检查 vite 配置。"
        exit 1
    }
    Ok "dist 生成成功。"
}

# -------- 3. scp dist --------
if (-not $SkipScp) {
    Step "3/5  scp dist -> $User@$Host_`:$Remote/dist/"
    # 用 -O 强制走 scp 协议（OpenSSH 9+ 默认走 SFTP，国内某些镜像 sftp-server 缺失）
    scp -O -P $Port -r dist/* "$User@$Host_`:$Remote/dist/"
    if ($LASTEXITCODE -ne 0) {
        Warn "-O 参数可能不被你这版 OpenSSH 支持，重试不带 -O ..."
        scp -P $Port -r dist/* "$User@$Host_`:$Remote/dist/"
    }
    if ($LASTEXITCODE -ne 0) {
        Err "scp 失败。"
        exit 1
    }
    Ok "dist 已上传。"
}

# -------- 4 & 5. 远端 git pull + build + restart + 验证 --------
if (-not $SkipRemote) {
    Step "4/5  远端 git pull + 重建 api/worker"

    $remoteScript = @"
set -e
cd $Remote
echo '---- git pull ----'
git pull
echo '---- docker compose build api worker ----'
docker compose -f docker-compose.production.yml build api worker
echo '---- docker compose up -d (force recreate) ----'
docker compose -f docker-compose.production.yml up -d --no-deps --force-recreate api worker
echo '---- waiting 5s for startup ----'
sleep 5
echo '---- docker logs (last 30 lines) ----'
docker logs --tail 30 beeeval-api
echo
echo '---- 5/5  curl /api/aggregation/vehicles ----'
curl -s -o /dev/null -w 'HTTP %{http_code}  time=%{time_total}s\n' http://localhost:8004/api/aggregation/vehicles
echo
echo '---- vehicle_aggregated_scores schema ----'
docker exec beeeval-postgres psql -U postgres -d beeeval -c '\d vehicle_aggregated_scores' || true
"@

    $tmp = New-TemporaryFile
    Set-Content -LiteralPath $tmp -Value $remoteScript -Encoding UTF8
    try {
        Get-Content -LiteralPath $tmp -Raw | ssh -p $Port "$User@$Host_" 'bash -s'
    } finally {
        Remove-Item -LiteralPath $tmp -Force
    }
}

Step "完成"
Ok "部署结束。浏览器打开 http://$Host_/  -> 左侧栏「车辆评分」试一下。"
Ok "本地强刷快捷键：Ctrl+Shift+R"
