$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:WRANGLER_WRITE_LOGS = "false"
$env:WRANGLER_LOG_PATH = Join-Path $ProjectRoot ".wrangler\logs"

Set-Location $ProjectRoot
& ".\node_modules\.bin\wrangler.cmd" dev `
  --config ".\wrangler.local.jsonc" `
  --ip "0.0.0.0" `
  --port 3000 `
  --env-file ".env" `
  --persist-to ".wrangler\state" `
  --log-level "warn"
