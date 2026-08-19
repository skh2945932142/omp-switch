$ErrorActionPreference = "Stop"

$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$testRoot = [IO.Path]::GetFullPath((Join-Path $workspaceRoot (".tmp-packaged-cli-" + [guid]::NewGuid().ToString("N"))))
$workspacePrefix = $workspaceRoot + [IO.Path]::DirectorySeparatorChar
if (-not $testRoot.StartsWith($workspacePrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to create test data outside the workspace"
}

function Invoke-PackagedCli([string]$cliPath, [string]$label) {
  $stdoutPath = Join-Path $testRoot "$label.stdout"
  $stderrPath = Join-Path $testRoot "$label.stderr"
  $testHome = Join-Path $testRoot "$label-home"
  $testData = Join-Path $testRoot "$label-data"
  New-Item -ItemType Directory -Force -Path $testHome, $testData | Out-Null

  $previousData = $env:OMP_SWITCH_DATA_DIR
  $previousUserProfile = $env:USERPROFILE
  $previousHome = $env:HOME
  try {
    $env:OMP_SWITCH_DATA_DIR = $testData
    $env:USERPROFILE = $testHome
    $env:HOME = $testHome
    & $cliPath list 1> $stdoutPath 2> $stderrPath
    $exitCode = $LASTEXITCODE
  } finally {
    $env:OMP_SWITCH_DATA_DIR = $previousData
    $env:USERPROFILE = $previousUserProfile
    $env:HOME = $previousHome
  }

  $stdout = if (Test-Path $stdoutPath) { [string](Get-Content -Raw $stdoutPath) } else { "" }
  $stderr = if (Test-Path $stderrPath) { [string](Get-Content -Raw $stderrPath) } else { "" }
  if ($exitCode -ne 0) { throw "$label CLI exited with ${exitCode}: $stderr" }
  if ([string]::IsNullOrWhiteSpace($stdout)) { throw "$label CLI did not write JSON" }
  if (-not [string]::IsNullOrWhiteSpace($stderr)) { throw "$label CLI wrote to stderr: $stderr" }

  $response = $stdout | ConvertFrom-Json
  if ($response.version -ne 1 -or -not $response.ok) { throw "$label CLI returned an invalid response envelope" }
}

try {
  New-Item -ItemType Directory -Force -Path $testRoot | Out-Null
  $unpackedCli = Join-Path $workspaceRoot "dist\win-unpacked\omp-switch-cli.exe"
  if (-not (Test-Path $unpackedCli)) { throw "Missing unpacked CLI: $unpackedCli" }
  $unpackedBridge = Join-Path $workspaceRoot "dist\win-unpacked\resources\secret-bridge\omp-switch-secret.exe"
  if (-not (Test-Path $unpackedBridge)) { throw "Missing unpacked secret bridge: $unpackedBridge" }
  Invoke-PackagedCli $unpackedCli "unpacked"

  $portableZip = Get-ChildItem -Path (Join-Path $workspaceRoot "dist") -Filter "OMP-Switch-*-win.zip" -File | Select-Object -First 1
  if (-not $portableZip) { throw "Missing portable ZIP" }
  $portableRoot = Join-Path $testRoot "portable"
  Expand-Archive -LiteralPath $portableZip.FullName -DestinationPath $portableRoot -Force
  $portableCli = Get-ChildItem -Path $portableRoot -Filter "omp-switch-cli.exe" -File -Recurse | Select-Object -First 1 -ExpandProperty FullName
  if (-not $portableCli) { throw "Portable ZIP did not contain omp-switch-cli.exe" }
  $portableBridge = Get-ChildItem -Path $portableRoot -Filter "omp-switch-secret.exe" -File -Recurse | Select-Object -First 1 -ExpandProperty FullName
  if (-not $portableBridge) { throw "Portable ZIP did not contain omp-switch-secret.exe" }
  Invoke-PackagedCli $portableCli "portable"

  Write-Host "Packaged JSON CLI verified for unpacked and portable builds."
} finally {
  if (Test-Path $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}
