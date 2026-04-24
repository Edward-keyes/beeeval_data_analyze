# ============================================================
#  BeeEVAL 本机 -> 服务器 数据迁移脚本
#  迁移内容:
#    1. PostgreSQL: 本机 pg_dump -> scp -> 服务器 pg_restore
#    2. Qdrant:     本机 snapshot -> scp -> 服务器 recover
#
#  用法:
#      # 迁移两者
#      .\scripts\migrate-data.ps1 -ServerIP 114.215.186.130 -User xai -SshPort 8800
#
#      # 只迁 PG
#      .\scripts\migrate-data.ps1 -ServerIP ... -SkipQdrant
#
#      # 只迁 Qdrant
#      .\scripts\migrate-data.ps1 -ServerIP ... -SkipPg
#
#      # scp 大文件总断：rsync 传完后跳过本机重新打快照 + 跳过 scp，只跑服务器恢复
#      .\scripts\migrate-data.ps1 -ServerIP ... -SkipPg -SkipLocalQdrantSnapshot -SkipSnapshotScp -ServerQdrantApiKey "..."
#
#  前提:
#    - 本机 PG 在 localhost:5432 能登录（直接，不走隧道！迁移时临时起本机 PG）
#    - 本机 Qdrant 在 localhost:6333 可达
#    - 服务器 /data/beeeval 已部署好新版 docker-compose
#    - 服务器 .env 里 DB_PASSWORD / QDRANT_API_KEY 已配置
#
#  Windows 上若未安装 PostgreSQL 客户端（PATH 里没有 pg_dump）:
#    - 脚本会自动在 "C:\Program Files\PostgreSQL\*\bin\pg_dump.exe" 下搜索
#    - 或指定 -PgDumpExe "C:\...\pg_dump.exe"
#    - 或指定 -PgDumpDockerContainer <容器名>，在容器内执行 pg_dump 再 docker cp 到本机
#
#  若服务器 pg_restore 报 unsupported version (1.xx) in file header:
#    本机 PG 主版本高于服务器（例如本机 17、服务器 16）。请改用:
#      -PgDumpFormat Plain
#    会导出 beeeval.sql 并用 psql 导入（体积更大但更兼容）。
# ============================================================

param(
    [Parameter(Mandatory=$true)]
    [string]$ServerIP,
    [string]$User = "xai",
    [int]$SshPort = 8800,

    [string]$LocalDbHost = "localhost",
    [int]$LocalDbPort = 5432,
    [string]$LocalDbUser = "postgres",
    [string]$LocalDbName = "beeeval",

    [string]$LocalQdrantUrl = "http://localhost:6333",
    [string]$QdrantCollection = "beeeval",

    [string]$RemoteDir = "/data/beeeval",
    [string]$RemoteDbName = "beeeval",
    [string]$RemoteDbUser = "postgres",

    # Optional: full path to pg_dump.exe when not on PATH (Windows / custom install).
    [string]$PgDumpExe = "",
    # Optional: run pg_dump inside this Docker container (must contain pg_dump + reach same DB).
    [string]$PgDumpDockerContainer = "",

    # Custom (-Fc) = smaller, but pg_restore on server must be same or newer major than pg_dump.
    # Plain (-Fp) = SQL text; slower/larger, but works when server is older (e.g. PG17 dump -> PG16).
    [ValidateSet("Custom", "Plain")]
    [string]$PgDumpFormat = "Custom",

    # When set, skips the interactive prompt for server Qdrant API key (CI / non-TTY).
    [string]$ServerQdrantApiKey = "",

    # Skip creating + downloading snapshot from local Qdrant; require .\beeeval.snapshot already present.
    # Use with -SkipSnapshotScp after rsync so step 1-2 do not overwrite the file you uploaded.
    [switch]$SkipLocalQdrantSnapshot,

    # Skip uploading beeeval.snapshot (use after manual rsync/scp to server, or when scp keeps dropping).
    [switch]$SkipSnapshotScp,

    # Retries for scp of the large snapshot (NAT / sshd may close long transfers).
    [int]$ScpRetryCount = 5,

    [switch]$SkipPg,
    [switch]$SkipQdrant
)

$ErrorActionPreference = "Stop"

# Keep SSH/SCP sessions alive during multi-hundred-MB uploads (NAT / firewall idle drops).
$SshCommonOpts = @(
    "-o", "ServerAliveInterval=30",
    "-o", "ServerAliveCountMax=120",
    "-o", "TCPKeepAlive=yes"
)

# ConvertFrom-SecureString -AsPlainText only exists on PowerShell 7+.
# This helper works on both 5.1 and 7+ by using Marshal.PtrToStringAuto.
function Read-SecretPrompt {
    param([Parameter(Mandatory=$true)][string]$Prompt)
    $secure = Read-Host -Prompt $Prompt -AsSecureString
    if (-not $secure) { return $null }
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        return [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    } finally {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

function Get-PgDumpExecutable {
    param([string]$ExplicitPath)
    if ($ExplicitPath) {
        if (Test-Path -LiteralPath $ExplicitPath) { return $ExplicitPath }
        throw "PgDumpExe not found: $ExplicitPath"
    }
    $cmd = Get-Command pg_dump -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) { return $cmd.Source }
    foreach ($root in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
        if (-not $root) { continue }
        $pgRoot = Join-Path $root "PostgreSQL"
        if (-not (Test-Path -LiteralPath $pgRoot)) { continue }
        $found = Get-ChildItem -Path $pgRoot -Recurse -Filter "pg_dump.exe" -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($found) { return $found.FullName }
    }
    return $null
}

function Get-AutoPostgresDockerContainer {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { return $null }
    $names = docker ps --format "{{.Names}}" 2>&1
    if ($LASTEXITCODE -ne 0) { return $null }
    if (-not $names) { return $null }
    $candidates = @($names) | Where-Object { $_ -match '(?i)postgres' }
    if ($candidates.Count -eq 1) { return $candidates[0] }
    if ($candidates.Count -gt 1) {
        Write-Host "  Multiple postgres-like containers: $($candidates -join ', '). Use -PgDumpDockerContainer to pick one." -ForegroundColor Yellow
    }
    return $null
}

function Invoke-PgDumpViaDocker {
    param(
        [string]$ContainerName,
        [string]$DbUser,
        [string]$DbName,
        [string]$DumpPath,
        [string]$Password,
        [ValidateSet("Custom", "Plain")]
        [string]$Format = "Custom"
    )
    $ext = if ($Format -eq "Plain") { "sql" } else { "dump" }
    $remote = "/tmp/beeeval_migrate_$([guid]::NewGuid().ToString('N').Substring(0,8)).$ext"
    if ($Format -eq "Plain") {
        docker exec -e "PGPASSWORD=$Password" $ContainerName pg_dump -U $DbUser -d $DbName --format=plain --no-owner --no-acl -f $remote
    } else {
        docker exec -e "PGPASSWORD=$Password" $ContainerName pg_dump -U $DbUser -d $DbName -Fc -f $remote
    }
    if ($LASTEXITCODE -ne 0) { throw "docker exec pg_dump failed (exit $LASTEXITCODE). Container=$ContainerName" }
    docker cp "${ContainerName}:${remote}" $DumpPath
    if ($LASTEXITCODE -ne 0) { throw "docker cp failed pulling $remote from $ContainerName" }
    docker exec $ContainerName rm -f $remote 2>$null
}

# PG17+ plain dumps may contain SET transaction_timeout ... which PG16 rejects.
# Strip whole lines that reference that GUC so psql on postgres:16 can proceed.
function Repair-PlainSqlDumpForPg16Target {
    param([Parameter(Mandatory = $true)][string]$SqlPath)
    if (-not (Test-Path -LiteralPath $SqlPath)) { return }
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    $lines = [System.IO.File]::ReadAllLines($SqlPath, $utf8NoBom)
    $removed = 0
    $out = New-Object System.Collections.Generic.List[string]
    foreach ($line in $lines) {
        if ($line -match '(?i)\btransaction_timeout\b') {
            $removed++
            continue
        }
        $out.Add($line)
    }
    if ($removed -gt 0) {
        Write-Host "  Sanitized dump: removed $removed line(s) with 'transaction_timeout' (PG17+ only; server is PG16)." -ForegroundColor Yellow
        [System.IO.File]::WriteAllLines($SqlPath, $out.ToArray(), $utf8NoBom)
    }
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  BeeEVAL Data Migration" -ForegroundColor Cyan
Write-Host ("  Target: {0}@{1}:{2}" -f $User, $ServerIP, $SshPort) -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# ────────── PostgreSQL ──────────
if (-not $SkipPg) {
    Write-Host ""
    Write-Host "[PG 1/4] Dumping local database..." -ForegroundColor Yellow
    $dumpFile = if ($PgDumpFormat -eq "Plain") { "beeeval.sql" } else { "beeeval.dump" }
    if ($PgDumpFormat -eq "Plain") {
        Write-Host "  Format: Plain SQL (compatible with older server pg_restore/psql)" -ForegroundColor Gray
    } else {
        Write-Host "  Format: Custom (-Fc); server pg_restore must be same or newer major than your pg_dump" -ForegroundColor Gray
    }

    $env:PGPASSWORD = Read-SecretPrompt "Local PG password for user '$LocalDbUser'"
    if (-not $env:PGPASSWORD) { throw "password required" }

    $dockerContainer = $PgDumpDockerContainer
    if (-not $dockerContainer) {
        $dockerContainer = Get-AutoPostgresDockerContainer
        if ($dockerContainer) {
            Write-Host "  Using Docker container for pg_dump: $dockerContainer" -ForegroundColor Gray
        }
    }

    $pgDumpPath = Get-PgDumpExecutable -ExplicitPath $PgDumpExe

    if ($dockerContainer) {
        if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
            throw "Docker not found in PATH but -PgDumpDockerContainer / auto-detect selected container '$dockerContainer'."
        }
        Invoke-PgDumpViaDocker -ContainerName $dockerContainer -DbUser $LocalDbUser -DbName $LocalDbName `
            -DumpPath $dumpFile -Password $env:PGPASSWORD -Format $PgDumpFormat
    } elseif ($pgDumpPath) {
        Write-Host "  Using pg_dump: $pgDumpPath" -ForegroundColor Gray
        if ($PgDumpFormat -eq "Plain") {
            & $pgDumpPath `
                -h $LocalDbHost `
                -p $LocalDbPort `
                -U $LocalDbUser `
                -d $LocalDbName `
                --format=plain --no-owner --no-acl `
                -f $dumpFile
        } else {
            & $pgDumpPath `
                -h $LocalDbHost `
                -p $LocalDbPort `
                -U $LocalDbUser `
                -d $LocalDbName `
                -Fc `
                -f $dumpFile
        }
        if ($LASTEXITCODE -ne 0) { throw "pg_dump failed. Is local PG running on ${LocalDbHost}:${LocalDbPort}?" }
    } else {
        throw @"
pg_dump not found on this machine.

Fix one of:
  1) Install PostgreSQL client tools (adds pg_dump to PATH), or
  2) Pass explicit path:  -PgDumpExe 'C:\Program Files\PostgreSQL\16\bin\pg_dump.exe'
  3) If your database runs in Docker:  -PgDumpDockerContainer '<container_name>'
     (docker ps --format '{{.Names}}' to list names; only one 'postgres*' container is auto-picked)

Chocolatey example:  choco install postgresql --params '/Password:dummy' -y
(Or install only "Command Line Tools" from the official PostgreSQL Windows installer.)
"@
    }
    if ($PgDumpFormat -eq "Plain") {
        $dumpFullPath = Join-Path -Path (Get-Location).Path -ChildPath $dumpFile
        Repair-PlainSqlDumpForPg16Target -SqlPath $dumpFullPath
    }
    $size = [math]::Round((Get-Item $dumpFile).Length / 1MB, 2)
    Write-Host "  OK - $dumpFile ($size MB)" -ForegroundColor Green

    Write-Host "[PG 2/4] Uploading dump to server (keepalive enabled for large files)..." -ForegroundColor Yellow
    & scp @SshCommonOpts -P $SshPort $dumpFile "${User}@${ServerIP}:${RemoteDir}/"
    if ($LASTEXITCODE -ne 0) {
        throw "scp failed. For very large files try: rsync -avP -e ""ssh -p $SshPort -o ServerAliveInterval=30 -o ServerAliveCountMax=120"" $dumpFile ${User}@${ServerIP}:${RemoteDir}/"
    }

    Write-Host "[PG 3/4] Copying dump into postgres container..." -ForegroundColor Yellow
    $remoteTmp = "/tmp/$dumpFile"
    ssh @SshCommonOpts -t -p $SshPort "$User@$ServerIP" "cd $RemoteDir && docker compose cp $dumpFile postgres:$remoteTmp"
    if ($LASTEXITCODE -ne 0) { throw "docker compose cp failed" }

    Write-Host "[PG 4/4] Restoring on server..." -ForegroundColor Yellow
    if ($PgDumpFormat -eq "Plain") {
        $restoreCmd = "cd $RemoteDir && docker compose exec -T postgres psql -U $RemoteDbUser -d $RemoteDbName -v ON_ERROR_STOP=1 -f $remoteTmp"
        ssh @SshCommonOpts -p $SshPort "$User@$ServerIP" "$restoreCmd"
        if ($LASTEXITCODE -ne 0) {
            throw "psql restore failed (exit $LASTEXITCODE). Fix errors above, or drop/recreate DB on server and retry."
        }
        Write-Host "  Restore completed (plain SQL)." -ForegroundColor Green
    } else {
        $restoreCmd = "cd $RemoteDir && docker compose exec -T postgres pg_restore -U $RemoteDbUser -d $RemoteDbName --clean --if-exists $remoteTmp"
        ssh @SshCommonOpts -p $SshPort "$User@$ServerIP" "$restoreCmd"
        # pg_restore: 0 = ok, 1 = warnings only, 2+ = fatal
        if ($LASTEXITCODE -ge 2) {
            throw @"
pg_restore failed (exit $LASTEXITCODE). If you see 'unsupported version' in the log, your local PostgreSQL is newer than the server image.
Re-run with:  -PgDumpFormat Plain
(Or upgrade server postgres image to match your local major version.)
"@
        }
        if ($LASTEXITCODE -eq 1) {
            Write-Host "  pg_restore finished with warnings (exit 1). Check output; 'does not exist' during --clean is often OK." -ForegroundColor Yellow
        } else {
            Write-Host "  Restore completed (custom format)." -ForegroundColor Green
        }
    }

    Write-Host "[PG 5/5] Restarting API to trigger CASCADE migration..." -ForegroundColor Yellow
    ssh @SshCommonOpts -p $SshPort "$User@$ServerIP" "cd $RemoteDir && docker compose restart api worker"

    Remove-Item $dumpFile -ErrorAction SilentlyContinue
    Write-Host "  PG migration done." -ForegroundColor Green
} else {
    Write-Host "Skipping PostgreSQL migration." -ForegroundColor DarkGray
}

# ────────── Qdrant ──────────
if (-not $SkipQdrant) {
    Write-Host ""
    $snapFile = "beeeval.snapshot"

    if ($SkipLocalQdrantSnapshot) {
        if (-not (Test-Path -LiteralPath $snapFile)) {
            throw "-SkipLocalQdrantSnapshot: missing $snapFile in the current directory"
        }
        $size = [math]::Round((Get-Item -LiteralPath $snapFile).Length / 1MB, 2)
        Write-Host "[QDRANT 1-2/4] Skipped (-SkipLocalQdrantSnapshot). Using existing $snapFile ($size MB)" -ForegroundColor Yellow
    } else {
        Write-Host "[QDRANT 1/4] Creating snapshot on local Qdrant..." -ForegroundColor Yellow

        $snapResp = Invoke-RestMethod -Method Post `
            -Uri "$LocalQdrantUrl/collections/$QdrantCollection/snapshots"
        $snapName = $snapResp.result.name
        if (-not $snapName) { throw "snapshot creation failed: $($snapResp | ConvertTo-Json -Depth 5)" }
        Write-Host "  Snapshot: $snapName" -ForegroundColor Green

        Write-Host "[QDRANT 2/4] Downloading snapshot..." -ForegroundColor Yellow
        Invoke-WebRequest -Uri "$LocalQdrantUrl/collections/$QdrantCollection/snapshots/$snapName" `
            -OutFile $snapFile -TimeoutSec 7200
        $size = [math]::Round((Get-Item -LiteralPath $snapFile).Length / 1MB, 2)
        Write-Host "  OK - $snapFile ($size MB)" -ForegroundColor Green
    }

    Write-Host "[QDRANT 3/4] Uploading snapshot to server (keepalive + compression + retries)..." -ForegroundColor Yellow
    if ($SkipSnapshotScp) {
        Write-Host "  -SkipSnapshotScp: not uploading. Ensure ${RemoteDir}/${snapFile} on the server is complete (same size as local)." -ForegroundColor Yellow
    } else {
        $attempt = 0
        $scpOk = $false
        while ($attempt -lt $ScpRetryCount) {
            $attempt++
            Write-Host "  scp attempt $attempt / $ScpRetryCount (-C compression, keepalive)..." -ForegroundColor Gray
            & scp @SshCommonOpts -C -P $SshPort $snapFile "${User}@${ServerIP}:${RemoteDir}/"
            $scpExit = $LASTEXITCODE
            if ($scpExit -eq 0) {
                $scpOk = $true
                break
            }
            Write-Host "  scp failed (exit $scpExit). Waiting before retry..." -ForegroundColor Yellow
            Start-Sleep -Seconds ([math]::Min(15 * $attempt, 120))
        }
        if (-not $scpOk) {
            throw @"
scp failed after $ScpRetryCount attempt(s). Large uploads often drop on unstable links or strict sshd limits.

Try one of:
  1) Rerun this script (retries may succeed on a cleaner path).
  2) Manual upload then skip scp:
       rsync -avP -e "ssh -p $SshPort -o ServerAliveInterval=30" ./$snapFile ${User}@${ServerIP}:${RemoteDir}/
       .\scripts\migrate-data.ps1 ... -SkipPg -SkipLocalQdrantSnapshot -SkipSnapshotScp -ServerQdrantApiKey "..."
  3) On the server: raise ClientAliveInterval / MaxSessions in sshd_config if you control the box.
"@
        }
    }

    Write-Host "[QDRANT 4/4] Restoring into server Qdrant (multipart upload API)..." -ForegroundColor Yellow
    $qdrantApiKey = if ($ServerQdrantApiKey) { $ServerQdrantApiKey } else { Read-SecretPrompt "Server QDRANT_API_KEY" }
    if (-not $qdrantApiKey) { throw "QDRANT_API_KEY required (pass -ServerQdrantApiKey or type when prompted)" }

    # Bash -H value: use single-quoted segment so keys with $ " \ do not break; escape embedded ' for bash.
    $apiKeyBashSingle = $qdrantApiKey.Replace("'", "'\''")

    # Use POST .../snapshots/upload instead of PUT .../recover + file://
    # Qdrant 1.16+ can hit "Wal error: first-index ... expected value at line 1" on recover-from-disk
    # for some Docker-generated snapshots (see qdrant/qdrant#7956). Upload path avoids that.
    #
    # Call Qdrant on the SERVER HOST at 127.0.0.1:6333 (compose maps qdrant:6333 -> 127.0.0.1:6333).
    # Do NOT use "docker compose exec api curl": `cp` works on stopped containers but `exec` requires
    # api to be running; operators often stop api/worker while fixing qdrant volumes.
    #
    # IMPORTANT: one physical line for the remote command. Multi-line + CRLF from Windows here-strings
    # breaks OpenSSH -> bash (you get "Could not resolve host: <key>" and "-H: command not found").
    $remoteCmd = (
        "set -e; cd $RemoteDir; " +
        'command -v curl >/dev/null 2>&1 || { echo "ERROR: install curl on server host: sudo apt install -y curl" >&2; exit 1; }; ' +
        "curl -fsS -X DELETE `"http://127.0.0.1:6333/collections/$QdrantCollection`" -H 'api-key: $apiKeyBashSingle' -o /dev/null || true; " +
        "curl -fsS -X POST `"http://127.0.0.1:6333/collections/$QdrantCollection/snapshots/upload?priority=snapshot&wait=true`" -H 'api-key: $apiKeyBashSingle' -F `"snapshot=@$snapFile`""
    ) -replace "`r", ""

    ssh @SshCommonOpts -p $SshPort "${User}@${ServerIP}" $remoteCmd
    if ($LASTEXITCODE -ne 0) { throw "Qdrant restore failed on server" }

    Remove-Item $snapFile -ErrorAction SilentlyContinue
    Write-Host "  Qdrant migration done." -ForegroundColor Green
} else {
    Write-Host "Skipping Qdrant migration." -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "Migration finished!" -ForegroundColor Green
Write-Host "Next: start the SSH tunnel with .\start-tunnel.ps1 and switch your local .env to the server credentials." -ForegroundColor Cyan
