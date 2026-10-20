# Redeploys the `ai` Supabase Edge Function (supabase/functions/ai) to project007.
# Usage (from the repo folder):  powershell -ExecutionPolicy Bypass -File scripts/deploy-ai.ps1
# Verify JWT stays off: the function checks sign-in itself and shop pages call it signed out.
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
npx supabase functions deploy ai --no-verify-jwt --project-ref ymkyrlquyietmuukzwqe
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "ai function redeployed to project007 (ymkyrlquyietmuukzwqe)."
