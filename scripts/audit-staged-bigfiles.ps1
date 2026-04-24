# ============================================================
#  Audit the current git INDEX for files >= $MinMB.
#
#  Works by asking git for each staged blob's size directly
#  (`git cat-file -s <sha>`), so it never hits the Windows
#  filesystem -- that means filenames with Chinese / CJK
#  characters do not blow up `Test-Path` like the inline
#  one-liner does.
#
#  Use this right after `git add -A` and before the first
#  `git commit` to catch anything big that slipped in.
#
#  Usage:
#      .\scripts\audit-staged-bigfiles.ps1              # >= 5 MB
#      .\scripts\audit-staged-bigfiles.ps1 -MinMB 1     # >= 1 MB
# ============================================================

param(
    [double]$MinMB = 5.0
)

$ErrorActionPreference = "Stop"

# Make sure PowerShell prints UTF-8 so CJK paths don't turn into ? blocks.
try {
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
    $OutputEncoding           = [System.Text.UTF8Encoding]::new()
} catch { }

$gitDir = & git rev-parse --show-toplevel
if (-not $gitDir) { throw "not inside a git repo" }
Set-Location $gitDir

# core.quotepath=false -> git emits real UTF-8 instead of \NNN octal escapes.
# `ls-files -s` format: <mode> <sha> <stage>\t<path>
$staged = & git -c core.quotepath=false ls-files -s

if (-not $staged) {
    Write-Host "Nothing is staged. Did you run 'git add -A'?" -ForegroundColor Yellow
    return
}

$thresholdBytes = [int64]([math]::Round($MinMB * 1MB))
$found = @()

foreach ($line in $staged) {
    # split on the TAB that separates <mode sha stage> from <path>
    $tab = $line.IndexOf("`t")
    if ($tab -lt 0) { continue }
    $left  = $line.Substring(0, $tab)
    $path  = $line.Substring($tab + 1)

    $parts = $left -split '\s+'
    if ($parts.Count -lt 2) { continue }
    $sha = $parts[1]

    $sizeStr = & git cat-file -s $sha
    if (-not $sizeStr) { continue }
    $size = [int64]$sizeStr

    if ($size -ge $thresholdBytes) {
        $found += [pscustomobject]@{
            SizeMB = [math]::Round($size / 1MB, 2)
            Path   = $path
            Sha    = $sha
        }
    }
}

if ($found.Count -eq 0) {
    Write-Host ("OK. No staged file is >= {0} MB." -f $MinMB) -ForegroundColor Green
    return
}

Write-Host ("Staged files >= {0} MB:" -f $MinMB) -ForegroundColor Yellow
"{0,10}  {1,-10}  {2}" -f 'Size(MB)', 'Sha', 'Path' | Write-Host -ForegroundColor Cyan
Write-Host ("-" * 80)
foreach ($r in ($found | Sort-Object SizeMB -Descending)) {
    "{0,10}  {1,-10}  {2}" -f $r.SizeMB, $r.Sha.Substring(0,10), $r.Path | Write-Host
}

Write-Host ""
Write-Host "If any of these shouldn't be in git, either:" -ForegroundColor Yellow
Write-Host "  1) add the path to .gitignore, then:  git rm --cached -- <path>" -ForegroundColor Gray
Write-Host "  2) or just:                           git restore --staged -- <path>  (leave on disk, not tracked)" -ForegroundColor Gray
