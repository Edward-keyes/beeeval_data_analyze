# ============================================================
#  BeeEVAL 本机 SSH 隧道启动脚本
#  把服务器上 127.0.0.1 上的 PG / Redis / Qdrant 转发到本机同端口。
#
#  用法（保持窗口开着，其它终端就能当本地服务用）:
#      .\start-tunnel.ps1
#      .\start-tunnel.ps1 -ServerIP 114.215.186.130 -User xai -Port 8800
#
#  前提:
#    1. 本机已关闭本地 PG/Redis/Qdrant 容器（否则端口冲突）
#       docker stop <本机pg容器> <本机redis容器> <本机qdrant容器>
#    2. 服务器 ~/.ssh/authorized_keys 已配好公钥，或能用密码登录
#    3. 服务器 docker-compose.production.yml 中三个服务已绑定 127.0.0.1
# ============================================================

param(
    [string]$ServerIP = "114.215.186.130",
    [string]$User = "xai",
    [int]$Port = 8800
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  BeeEVAL SSH Tunnel" -ForegroundColor Cyan
Write-Host ("  Target: {0}@{1}:{2}" -f $User, $ServerIP, $Port) -ForegroundColor Cyan
Write-Host "  Forwards:" -ForegroundColor Cyan
Write-Host "    localhost:5432 -> server:127.0.0.1:5432 (PostgreSQL)" -ForegroundColor Gray
Write-Host "    localhost:6379 -> server:127.0.0.1:6379 (Redis)" -ForegroundColor Gray
Write-Host "    localhost:6333 -> server:127.0.0.1:6333 (Qdrant)" -ForegroundColor Gray
Write-Host "========================================" -ForegroundColor Cyan

# Pre-flight: check that the 3 local ports aren't already taken.
# If any local service is holding them, the tunnel will silently race and the
# user will see confusing "connection refused on localhost:xxxx" later.
$conflicts = @()
foreach ($p in 5432, 6379, 6333) {
    $inUse = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
    if ($inUse) {
        $conflicts += $p
    }
}
if ($conflicts.Count -gt 0) {
    Write-Host ""
    Write-Host "WARNING: these local ports are already in use: $($conflicts -join ', ')" -ForegroundColor Yellow
    Write-Host "         The tunnel will fail to bind. Stop the conflicting service first:" -ForegroundColor Yellow
    Write-Host "           docker ps                    # find conflicting containers" -ForegroundColor Gray
    Write-Host "           docker stop <container>      # stop them" -ForegroundColor Gray
    Write-Host ""
    $answer = Read-Host "Continue anyway? (y/N)"
    if ($answer -ne "y" -and $answer -ne "Y") { exit 1 }
}

Write-Host ""
Write-Host "Starting tunnel... (Ctrl+C to stop, closing this window also stops it)" -ForegroundColor Green
Write-Host ""

# -N  : no remote command (just forward)
# -T  : no pty
# ServerAliveInterval: keep TCP alive through firewalls / NAT (default Clash can drop idle conns)
# ExitOnForwardFailure: die loudly if any -L binding fails (instead of silently dropping one)
ssh `
    -N -T `
    -o "ServerAliveInterval=30" `
    -o "ServerAliveCountMax=3" `
    -o "ExitOnForwardFailure=yes" `
    -L "5432:127.0.0.1:5432" `
    -L "6379:127.0.0.1:6379" `
    -L "6333:127.0.0.1:6333" `
    -p $Port `
    "$User@$ServerIP"
