# Sets a Railway service variable from a file's contents WITHOUT ever printing the value.
# Usage:  .\scripts\railway-set-secret.ps1 -Name ANTHROPIC_API_KEY -FromFile C:\path\key.txt
# Requires RAILWAY_TOKEN (project token) in the environment or in .env, and the Railway CLI on PATH.
param(
  [Parameter(Mandatory = $true)][string]$Name,
  [Parameter(Mandatory = $true)][string]$FromFile
)
$ErrorActionPreference = "Stop"
if (-not $env:RAILWAY_TOKEN -and (Test-Path .env)) {
  $line = Get-Content .env | Where-Object { $_ -match '^\s*RAILWAY_(API_)?TOKEN\s*=' } | Select-Object -First 1
  if ($line) { $env:RAILWAY_TOKEN = ($line -split '=', 2)[1].Trim() }
}
if (-not $env:RAILWAY_TOKEN) { Write-Error "RAILWAY_TOKEN not available"; exit 2 }
if (-not (Test-Path $FromFile)) { Write-Error "file not found: $FromFile"; exit 2 }
$value = (Get-Content $FromFile -Raw).Trim()
if ($value.Length -lt 8) { Write-Error "value in $FromFile looks empty"; exit 2 }
if ($Name -notmatch '^[A-Z][A-Z0-9_]*$') { Write-Error "invalid variable name"; exit 2 }

# --skip-deploys: we redeploy once after all variables are set.
# The CLI writes harmless warnings to stderr; don't let them abort the script.
$ErrorActionPreference = "Continue"
$out = & railway variables --set "$Name=$value" --skip-deploys 2>&1 | Out-String
$ErrorActionPreference = "Stop"
if ($LASTEXITCODE -ne 0) {
  # Scrub the value from any error text before showing it.
  Write-Error ("railway failed: " + $out.Replace($value, "[redacted]"))
  exit 1
}
Write-Output "set $Name (length $($value.Length)) on Railway"
