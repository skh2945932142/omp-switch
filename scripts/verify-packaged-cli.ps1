$ErrorActionPreference = "Stop"

$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$testRoot = [IO.Path]::GetFullPath((Join-Path $workspaceRoot (".tmp-packaged-cli-" + [guid]::NewGuid().ToString("N"))))
$workspacePrefix = $workspaceRoot + [IO.Path]::DirectorySeparatorChar
if (-not $testRoot.StartsWith($workspacePrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to create test data outside the workspace"
}

function ConvertTo-WindowsCommandLineArgument([string]$value) {
  # Windows command-line parsing requires backslashes before embedded quotes to be doubled.
  $builder = [System.Text.StringBuilder]::new()
  $slash = [char]92
  $quote = [char]34
  [void]$builder.Append($quote)
  $backslashes = 0
  foreach ($character in $value.ToCharArray()) {
    if ($character -eq $slash) { $backslashes++; continue }
    if ($character -eq $quote) {
      for ($i = 0; $i -lt (2 * $backslashes + 1); $i++) { [void]$builder.Append($slash) }
      [void]$builder.Append($quote)
      $backslashes = 0
      continue
    }
    for ($i = 0; $i -lt $backslashes; $i++) { [void]$builder.Append($slash) }
    $backslashes = 0
    [void]$builder.Append($character)
  }
  for ($i = 0; $i -lt (2 * $backslashes); $i++) { [void]$builder.Append($slash) }
  [void]$builder.Append($quote)
  return $builder.ToString()
}

function Invoke-NativeCli([string]$cliPath, [string[]]$arguments, [string]$stdoutPath, [string]$stderrPath) {
  # The package script runs under Windows PowerShell 5.1/.NET Framework, where
  # ProcessStartInfo.ArgumentList is unavailable; serialize argv with Windows quoting rules.
  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $cliPath
  $startInfo.WorkingDirectory = Split-Path -Parent $cliPath
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.Arguments = (($arguments | ForEach-Object { ConvertTo-WindowsCommandLineArgument $_ }) -join " ")

  $process = [System.Diagnostics.Process]::Start($startInfo)
  if (-not $process) { throw "Failed to start packaged CLI: $cliPath" }
  try {
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    [IO.File]::WriteAllText($stdoutPath, $stdoutTask.GetAwaiter().GetResult(), [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText($stderrPath, $stderrTask.GetAwaiter().GetResult(), [Text.UTF8Encoding]::new($false))
    return $process.ExitCode
  } finally {
    $process.Dispose()
  }
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
    $agentDir = Join-Path $testHome ".omp\agent"
    New-Item -ItemType Directory -Force -Path $agentDir | Out-Null
    @("providers:", "  demo:", "    baseUrl: https://api.example.test/v1", "    api: openai-completions", "    auth: none", "    models:", "      - id: demo-1") | Set-Content -LiteralPath (Join-Path $agentDir "models.yml") -Encoding utf8
    "default: demo/demo-1" | Set-Content -LiteralPath (Join-Path $agentDir "config.yml") -Encoding utf8

    $exitCode = Invoke-NativeCli -cliPath $cliPath -arguments @("list") -stdoutPath $stdoutPath -stderrPath $stderrPath
    if ($exitCode -ne 0) { throw "$label list failed: $(Get-Content -Raw $stderrPath)" }
    $applyPatch = '{"roleAssignments":{"default":"demo/demo-1"}}'
    $exitCode = Invoke-NativeCli -cliPath $cliPath -arguments @("apply", "--profile", "default", "--patch", $applyPatch) -stdoutPath $stdoutPath -stderrPath $stderrPath
    if ($exitCode -ne 0) { throw "$label apply failed: $(Get-Content -Raw $stderrPath)" }
    $applyResponse = (Get-Content -Raw $stdoutPath) | ConvertFrom-Json
    if (-not $applyResponse.ok -or -not $applyResponse.data.snapshot.id) { throw "$label apply returned no snapshot ID" }
    $snapshotId = [string]$applyResponse.data.snapshot.id
    $settingsPath = Join-Path $agentDir "config.yml"
    Add-Content -LiteralPath $settingsPath -Value "# external edit"

    $exitCode = Invoke-NativeCli -cliPath $cliPath -arguments @("restore", "--profile", "default", "--snapshot", $snapshotId) -stdoutPath $stdoutPath -stderrPath $stderrPath
    if ($exitCode -eq 0) { throw "$label restore unexpectedly overwrote an external edit" }
    if (-not (Select-String -LiteralPath $settingsPath -Pattern "external edit" -Quiet)) { throw "$label restore modified the externally edited file" }

    $exitCode = Invoke-NativeCli -cliPath $cliPath -arguments @("restore", "--profile", "default", "--snapshot", $snapshotId, "--force") -stdoutPath $stdoutPath -stderrPath $stderrPath
    if ($exitCode -ne 0) { throw "$label forced restore failed: $(Get-Content -Raw $stderrPath)" }
    $restoreResponse = (Get-Content -Raw $stdoutPath) | ConvertFrom-Json
    if (-not $restoreResponse.ok) { throw "$label restore returned an invalid response" }
    if (Select-String -LiteralPath $settingsPath -Pattern "external edit" -Quiet) { throw "$label forced restore did not restore the snapshot" }
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
