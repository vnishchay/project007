# One-time setup for review reminders (Web Push), then deploys the `remind` Edge Function.
# Usage (from the repo folder):  powershell -ExecutionPolicy Bypass -File scripts/setup-reminders.ps1
# Run it again only to redeploy: pass -DeployOnly to keep the existing keys.
# It prints two things to finish by hand: one SQL line for the Supabase SQL Editor, and one Vercel variable.
param([switch]$DeployOnly, [string]$Contact = "")
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
$ref = "ymkyrlquyietmuukzwqe"

if (-not $DeployOnly) {
  # Push services can write to this address if something goes wrong. It isn't shown to anyone.
  if (-not $Contact) { $Contact = Read-Host "Contact email for push services" }
  if ($Contact -notmatch "^mailto:") { $Contact = "mailto:$Contact" }
  # The Web Push key pair. The private key goes only to Supabase secrets.
  $keys = npx --yes web-push@3.6.7 generate-vapid-keys --json | ConvertFrom-Json
  # A random secret so only our own cron job can call the function.
  $bytes = New-Object byte[] 32; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $cron = [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")

  npx supabase secrets set --project-ref $ref "VAPID_PUBLIC_KEY=$($keys.publicKey)" "VAPID_PRIVATE_KEY=$($keys.privateKey)" "VAPID_SUBJECT=$Contact" "REMIND_CRON_SECRET=$cron"
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

npx supabase functions deploy remind --no-verify-jwt --project-ref $ref
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "remind function deployed to project007 ($ref)."

if (-not $DeployOnly) {
  Write-Host ""
  Write-Host "1) In Supabase > SQL Editor, run this once (it stores the cron secret in Vault; don't share it):"
  Write-Host "   select vault.create_secret('https://$ref.supabase.co', 'project_url'); select vault.create_secret('$cron', 'remind_cron_secret');"
  Write-Host ""
  Write-Host "2) In Vercel > project007 > Settings > Environment Variables, add, then redeploy:"
  Write-Host "   VITE_VAPID_PUBLIC_KEY = $($keys.publicKey)"
  Write-Host ""
  Write-Host "Until step 2 is done the app hides the reminder switch and keeps Ready to rate on the home page instead."
}
