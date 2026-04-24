# ============================================================
#  Download the embedding model (BAAI/bge-base-zh-v1.5) to
#  ./model/bge-base-zh-v1.5 so the Docker build can COPY it.
#
#  Why a script: pytorch_model.bin is ~390 MB and cannot live
#  in git on GitHub (100 MB per-file limit).
#
#  Usage:
#      # default (HuggingFace official)
#      .\scripts\download-model.ps1
#
#      # China users: use HF mirror
#      .\scripts\download-model.ps1 -UseMirror
#
#      # override target dir
#      .\scripts\download-model.ps1 -OutDir .\model\bge-base-zh-v1.5
# ============================================================

param(
    [string]$RepoId = "BAAI/bge-base-zh-v1.5",
    [string]$OutDir = "model/bge-base-zh-v1.5",
    [switch]$UseMirror
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  BeeEVAL model downloader" -ForegroundColor Cyan
Write-Host ("  Repo: {0}" -f $RepoId) -ForegroundColor Cyan
Write-Host ("  Dest: {0}" -f $OutDir) -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

if ($UseMirror) {
    $env:HF_ENDPOINT = "https://hf-mirror.com"
    Write-Host "Using mirror HF_ENDPOINT=$env:HF_ENDPOINT" -ForegroundColor Yellow
}

# 1) python?
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { $python = Get-Command python3 -ErrorAction SilentlyContinue }
if (-not $python) {
    throw "python not found on PATH. Install Python 3.9+ and re-run."
}
$pythonExe = $python.Source

# 2) huggingface_hub installed?
& $pythonExe -c "import huggingface_hub" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "huggingface_hub not installed, installing..." -ForegroundColor Yellow
    & $pythonExe -m pip install --upgrade huggingface_hub -i https://pypi.tuna.tsinghua.edu.cn/simple
    if ($LASTEXITCODE -ne 0) { throw "pip install huggingface_hub failed" }
}

# 3) snapshot_download
$pyCode = @"
import os, sys
from huggingface_hub import snapshot_download
repo = sys.argv[1]
out  = sys.argv[2]
os.makedirs(out, exist_ok=True)
p = snapshot_download(
    repo_id=repo,
    local_dir=out,
    local_dir_use_symlinks=False,
    allow_patterns=[
        '*.bin','*.safetensors','*.json','*.txt','*.md',
        'tokenizer*','vocab*','special_tokens_map*','sentence_bert_config*'
    ],
)
print(p)
"@

$tmp = [System.IO.Path]::GetTempFileName() + ".py"
$pyCode | Set-Content -Encoding UTF8 -NoNewline $tmp
try {
    & $pythonExe $tmp $RepoId $OutDir
    if ($LASTEXITCODE -ne 0) { throw "snapshot_download failed (exit $LASTEXITCODE)" }
} finally {
    Remove-Item $tmp -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host ("Done. Model is at: {0}" -f (Resolve-Path $OutDir)) -ForegroundColor Green
Write-Host "Next: .\deploy.ps1 ... (Docker build will COPY model/ into the image)" -ForegroundColor Cyan
