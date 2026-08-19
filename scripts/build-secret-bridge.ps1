# Publishes the Windows secret bridge as a Native AOT binary.
#
# Why a wrapper instead of a plain `dotnet publish`: the ILCompiler shells out to `vswhere.exe` to
# locate the MSVC linker and expects it on PATH. Visual Studio always installs vswhere at a fixed
# location, but does not put it on PATH, so a machine with the C++ workload installed can still fail
# to link with a confusing MSB3073. Prepending that fixed directory keeps the build working in a
# plain shell as well as in a Developer Command Prompt.

$ErrorActionPreference = "Stop"

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$project = Join-Path $projectRoot "native/secret-bridge/OmpSwitch.SecretBridge.csproj"
$output = Join-Path $projectRoot "native/secret-bridge/publish"

$vswhereDir = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer"
if (Test-Path (Join-Path $vswhereDir "vswhere.exe")) {
  if (($env:PATH -split [IO.Path]::PathSeparator) -notcontains $vswhereDir) {
    $env:PATH = $vswhereDir + [IO.Path]::PathSeparator + $env:PATH
  }
} else {
  Write-Host "vswhere.exe was not found; relying on the ambient toolchain environment." -ForegroundColor Yellow
}

dotnet publish $project -c Release -r win-x64 -o $output
if ($LASTEXITCODE -ne 0) {
  throw @"
Native AOT publish failed (exit $LASTEXITCODE).

Native AOT links with the MSVC toolchain, so the build needs the Visual Studio
"Desktop development with C++" workload (or the standalone Build Tools) in addition to the .NET SDK.
Install it, or run this from a Developer Command Prompt so link.exe is discoverable.
"@
}

$binary = Join-Path $output "omp-switch-secret.exe"
if (-not (Test-Path $binary)) { throw "Publish reported success but $binary is missing" }
Write-Host ("Secret bridge published: {0:N2} MB" -f ((Get-Item $binary).Length / 1MB))
