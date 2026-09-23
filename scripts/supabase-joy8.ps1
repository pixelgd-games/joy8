param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$SupabaseArgs
)

$ErrorActionPreference = "Stop"

$ProjectRef = "lsazydefvnuqglultqii"
$ProjectName = "Joy8"
$Root = Split-Path -Parent $PSScriptRoot
$EnvFile = Join-Path $Root ".env.supabase.local"

function Stop-Joy8Supabase {
  param([string]$Message)
  Write-Host $Message -ForegroundColor Red
  exit 1
}

if (!(Test-Path -LiteralPath $EnvFile)) {
  Stop-Joy8Supabase "Missing .env.supabase.local. Copy .env.supabase.local.example, then fill Joy8 token and DB password."
}

foreach ($rawLine in Get-Content -LiteralPath $EnvFile -Encoding UTF8) {
  $line = $rawLine.Trim()

  if ($line -eq "" -or $line.StartsWith("#")) {
    continue
  }

  $pair = $line -split "=", 2

  if ($pair.Count -ne 2) {
    continue
  }

  $name = $pair[0].Trim()
  $value = $pair[1].Trim()

  if ($value.Length -ge 2) {
    $first = $value[0]
    $last = $value[$value.Length - 1]

    if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) {
      $value = $value.Substring(1, $value.Length - 2)
    }
  }

  if ($name -match "^[A-Za-z_][A-Za-z0-9_]*$") {
    Set-Item -Path "Env:$name" -Value $value
  }
}

if ([string]::IsNullOrWhiteSpace($env:SUPABASE_ACCESS_TOKEN)) {
  Stop-Joy8Supabase "Missing SUPABASE_ACCESS_TOKEN in .env.supabase.local."
}

if ([string]::IsNullOrWhiteSpace($env:SUPABASE_PROJECT_ID)) {
  $env:SUPABASE_PROJECT_ID = $ProjectRef
}

if ($env:SUPABASE_PROJECT_ID -ne $ProjectRef) {
  Stop-Joy8Supabase "SUPABASE_PROJECT_ID must be $ProjectRef for Joy8."
}

if ($SupabaseArgs.Count -eq 0) {
  $SupabaseArgs = @("projects", "list")
}

$isProjectsList = $SupabaseArgs.Count -ge 2 -and $SupabaseArgs[0] -eq "projects" -and $SupabaseArgs[1] -eq "list"

if (!$isProjectsList) {
  $projectList = & npx.cmd supabase --workdir $Root projects list --output json 2>&1

  if ($LASTEXITCODE -ne 0) {
    $projectList | Write-Output
    exit $LASTEXITCODE
  }

  try {
    $projects = ($projectList -join "`n") | ConvertFrom-Json
  } catch {
    Stop-Joy8Supabase "Could not parse the Supabase project list. Stop before running command."
  }

  $joy8Project = $projects | Where-Object {
    ($_.id -eq $ProjectRef -or $_.ref -eq $ProjectRef) -and $_.name -eq $ProjectName -and $_.linked -eq $true
  }

  if ($null -eq $joy8Project) {
    Stop-Joy8Supabase "Supabase token does not show Joy8 / $ProjectRef. Stop before running command."
  }
}

$isDbQuery = $SupabaseArgs.Count -ge 2 -and $SupabaseArgs[0] -eq "db" -and $SupabaseArgs[1] -eq "query"

if ($SupabaseArgs.Count -ge 2 -and $SupabaseArgs[0] -eq "auth-config") {
  & node (Join-Path $PSScriptRoot "auth-config-joy8.mjs") @($SupabaseArgs | Select-Object -Skip 1)
  exit $LASTEXITCODE
}

if ($isDbQuery) {
  if ([string]::IsNullOrWhiteSpace($env:SUPABASE_DB_PASSWORD)) {
    Stop-Joy8Supabase "Missing SUPABASE_DB_PASSWORD in .env.supabase.local."
  }
  $env:PGPASSWORD = $env:SUPABASE_DB_PASSWORD
}

& npx.cmd supabase --workdir $Root @SupabaseArgs
exit $LASTEXITCODE
