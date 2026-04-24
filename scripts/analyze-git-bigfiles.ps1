# ============================================================
#  Find the top-N biggest blobs stored anywhere in this repo's
#  git history (not just HEAD). Read-only, doesn't touch refs.
#
#  Use this before pushing to GitHub to see why the push is huge.
#  Anything > ~50 MB here is suspicious; > 100 MB will be rejected
#  by GitHub outright.
#
#  Usage:
#      .\scripts\analyze-git-bigfiles.ps1            # top 30
#      .\scripts\analyze-git-bigfiles.ps1 -Top 60
# ============================================================

param(
    [int]$Top = 30
)

$ErrorActionPreference = "Stop"

$gitDir = & git rev-parse --show-toplevel
if (-not $gitDir) { throw "not inside a git repo" }
Set-Location $gitDir

Write-Host "Scanning all objects in history (this may take a moment)..." -ForegroundColor Cyan

# Step 1: list every (sha, path) pair reachable from any ref.
$list = & git rev-list --objects --all

# Step 2: ask cat-file for size of each blob.
$rows = $list |
    ForEach-Object {
        $parts = $_ -split ' ', 2
        if ($parts.Count -eq 2) {
            [pscustomobject]@{ Sha = $parts[0]; Path = $parts[1] }
        }
    } |
    Where-Object { $_.Path }

# Collect sizes via one git cat-file --batch-check call (much faster than per-sha).
$shaList   = $rows | ForEach-Object { $_.Sha }
$sizesRaw  = $shaList | & git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize)'
$sizeBySha = @{}
foreach ($line in $sizesRaw) {
    $p = $line -split ' '
    if ($p.Count -eq 3 -and $p[0] -eq 'blob') {
        $sizeBySha[$p[1]] = [int64]$p[2]
    }
}

$enriched = $rows |
    Where-Object { $sizeBySha.ContainsKey($_.Sha) } |
    ForEach-Object {
        [pscustomobject]@{
            SizeMB = [math]::Round($sizeBySha[$_.Sha] / 1MB, 2)
            Path   = $_.Path
            Sha    = $_.Sha
        }
    } |
    Sort-Object SizeMB -Descending |
    Select-Object -First $Top

"{0,10}  {1,-10}  {2}" -f 'Size(MB)', 'Sha', 'Path' | Write-Host -ForegroundColor Cyan
Write-Host ("-" * 80)
foreach ($r in $enriched) {
    "{0,10}  {1,-10}  {2}" -f $r.SizeMB, $r.Sha.Substring(0,10), $r.Path | Write-Host
}

Write-Host ""
Write-Host ("Tip: anything > 100 MB will make 'git push' to GitHub fail.") -ForegroundColor Yellow
Write-Host ("To purge them from history, use 'git filter-repo' or 'bfg'.") -ForegroundColor Yellow
