$ErrorActionPreference = "Stop"

$rootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

python (Join-Path $PSScriptRoot "generate_manifest.py")

Write-Host ""
Write-Host "Reader is available at: http://localhost:8000/reader/"
Write-Host "Press Ctrl+C to stop."
Write-Host ""

python -m http.server 8000 --directory $rootDir
