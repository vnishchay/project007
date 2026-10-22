# Deploys the `wallet` Supabase Edge Function (Apple / Google Wallet passes) to project007.
# Usage (from the repo folder):  powershell -ExecutionPolicy Bypass -File scripts/deploy-wallet.ps1
# Verify JWT stays off: the Apple pass link is opened by the phone's browser without a session; the function
# checks sign-in itself for everything else.
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
npx supabase functions deploy wallet --no-verify-jwt --project-ref ymkyrlquyietmuukzwqe
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "wallet function deployed to project007 (ymkyrlquyietmuukzwqe)."
