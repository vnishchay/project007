# Deploy after applying migrations 54 and 55. Reuses existing reminder VAPID and cron secrets.
param([Parameter(Mandatory = $true)][string]$ProjectRef)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
if ($ProjectRef -notmatch '^[a-z0-9]{20}$') { throw 'Use the 20-character Supabase project reference.' }
npx supabase functions deploy recovery-alerts --no-verify-jwt --project-ref $ProjectRef
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host 'Recovery alert function deployed. Check the alert status in the owner app after enabling notifications.'
Write-Host 'If reminders were never configured, follow the Recovery rollout section in README.md first.'
