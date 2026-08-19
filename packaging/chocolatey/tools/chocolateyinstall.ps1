$ErrorActionPreference = "Stop"

# Downloads the signed release asset rather than embedding the installer, so the package stays small
# and the checksum is verified against the published SHA256SUMS.txt.
$version = "0.2.0"
$packageArgs = @{
  packageName    = $env:ChocolateyPackageName
  fileType       = "exe"
  url64bit       = "https://github.com/skh2945932142/omp-switch/releases/download/v$version/OMP-Switch-Setup-$version.exe"
  checksum64     = "REPLACE_WITH_SHA256_OF_NSIS_INSTALLER"
  checksumType64 = "sha256"
  # NSIS per-user install. /S is silent; /D sets the directory and must come last, unquoted.
  silentArgs     = "/S"
  validExitCodes = @(0)
}

Install-ChocolateyPackage @packageArgs

Write-Host "OMP Switch installs per user. Stored API keys are encrypted with this Windows account's" -ForegroundColor Yellow
Write-Host "DPAPI key and cannot be read by other accounts or moved to another machine." -ForegroundColor Yellow
