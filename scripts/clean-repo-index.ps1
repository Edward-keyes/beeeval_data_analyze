# ============================================================
#  BeeEVAL: clean up git index before first push.
#
#  What it does:
#    - Runs `git rm --cached -r --ignore-unmatch` on a list of paths
#      that SHOULD NEVER live in the repo (secrets, big dumps,
#      snapshots, node_modules, build output, editor/agent state...).
#    - Files on disk are kept; only the git index is updated.
#    - After this + the project's .gitignore, `git status` should be
#      clean enough to do a first real commit.
#
#  Usage (run from repo root):
#
#      # Dry run -- just prints what WOULD be removed from the index.
#      .\scripts\clean-repo-index.ps1
#
#      # Actually do it.
#      .\scripts\clean-repo-index.ps1 -Apply
#
#  IMPORTANT:
#    - Your real .env / .env.production with secrets stays on disk;
#      only its tracking in git history going forward is removed.
#    - If those files were already pushed to a remote before, rotate
#      every secret value (LLM_API_KEY, NAS_TOKEN, DB_PASSWORD, ...).
#    - This script does NOT rewrite history. If you need to purge
#      past commits (e.g. already pushed beeeval.snapshot once), use
#      `git filter-repo` or `bfg-repo-cleaner` separately.
# ============================================================

param(
    [switch]$Apply
)

$ErrorActionPreference = "Stop"

$gitCmd = Get-Command git -ErrorAction SilentlyContinue
if (-not $gitCmd) {
    throw "系统找不到 git。请安装 Git for Windows 并确保 PATH 中有 git，重新打开 PowerShell 后再试(Get-Command git 可自测)。"
}

# Paths that must never be tracked. Keep in sync with .gitignore.
$paths = @(
    # secrets
    ".env",
    ".env.production",
    ".env.hybrid.example",   # will be re-added via !.env.hybrid.example whitelist

    # local dumps / snapshots / deploy artifacts
    "beeeval.db",
    "beeeval.sql",
    "beeeval.snapshot",
    "beeeval-deploy.tar.gz",
    "api/bee_eval.db",

    # runtime / logs / temp
    "logs",
    "backups",
    "temp_files",
    "api/temp_files",
    "api/llm_logs",
    ".translation_cache",
    "rag_test_output.txt",

    # node / build / deploy caches
    ".npm-cache",
    "node_modules",
    "dist",
    ".vercel",

    # test media
    "test_videos",

    # runtime-generated frontend assets (per-video frame captures)
    "public/screenshots",

    # big pretrained models (user should download via scripts/download-model.*)
    "model",

    # OS / editor / agent state
    ".DS_Store",
    ".idea",
    ".vscode",
    ".claude",
    ".trae",
    ".cursor",
    ".cursorignore",
    ".cursorindexingignore"
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  BeeEVAL repo index cleaner" -ForegroundColor Cyan
if ($Apply) {
    Write-Host "  Mode: APPLY (will modify git index)" -ForegroundColor Yellow
} else {
    Write-Host "  Mode: DRY RUN (pass -Apply to actually run)" -ForegroundColor Green
}
Write-Host "========================================" -ForegroundColor Cyan

# 解析仓库根(与当前 .git 一致)，用 LiteralPath 避免 Windows 路径歧义
$gitDir = (& git rev-parse --show-toplevel 2>$null | Select-Object -First 1)
if ($LASTEXITCODE -ne 0 -or -not $gitDir) {
    throw "Not inside a git repo. Run this from the BeeEVAL repo root."
}
$gitDir = $gitDir.Trim()
try {
    $gitDir = (Resolve-Path -LiteralPath $gitDir).Path
} catch {
    throw "无法解析 git 根目录: $gitDir  ($_)"
}
Set-Location -LiteralPath $gitDir
Write-Host "Repo root: $gitDir" -ForegroundColor Gray

$removed = 0
foreach ($p in $paths) {
    # `git ls-files -- <path>` prints nothing (instead of erroring) when the
    # path is not tracked, so we don't fight with $ErrorActionPreference=Stop
    # on native-command stderr noise.
    $tracked = & git ls-files -- $p
    if (-not $tracked) {
        Write-Host "  skip (not tracked): $p" -ForegroundColor DarkGray
        continue
    }

    $count = ($tracked | Measure-Object).Count
    Write-Host ("  untrack: {0}  ({1} file(s))" -f $p, $count) -ForegroundColor Yellow
    if ($Apply) {
        & git rm --cached -r --ignore-unmatch -- $p | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Host "    git rm failed for $p" -ForegroundColor Red
        } else {
            $removed++
        }
    }
}

Write-Host ""
if ($Apply) {
    Write-Host "Done. Removed $removed path(s) from the index." -ForegroundColor Green
    Write-Host "Next:" -ForegroundColor Cyan
    Write-Host "  1. Review 'git status' -- the files should show as deleted (tracked) + untracked copies." -ForegroundColor Gray
    Write-Host "  2. git add -A" -ForegroundColor Gray
    Write-Host "  3. git commit -m 'chore: untrack secrets, local data and build artifacts'" -ForegroundColor Gray
    Write-Host "  4. If any secret was pushed before, rotate it." -ForegroundColor Gray
} else {
    Write-Host "Dry run complete. Re-run with -Apply to actually untrack the paths above." -ForegroundColor Green
}
