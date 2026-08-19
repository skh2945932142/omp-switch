# Fills the version and SHA256 placeholders in the package-manager manifests from a built release.
#
# Run after `pnpm package:win`, or against a downloaded release directory:
#   pnpm render:packaging                     # uses dist/
#   pnpm render:packaging -Source C:\assets   # uses another directory
#
# Writes rendered copies into packaging/out/ and leaves the committed templates untouched, so the
# repository never carries a hash that does not match a published asset.

param(
  [string]$Source = "dist",
  [string]$Destination = "packaging/out"
)

$ErrorActionPreference = "Stop"

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$sourceDir = [IO.Path]::GetFullPath((Join-Path $projectRoot $Source))
$outDir = [IO.Path]::GetFullPath((Join-Path $projectRoot $Destination))

if (-not (Test-Path $sourceDir)) { throw "Asset directory not found: $sourceDir. Run pnpm package:win first." }

$version = (Get-Content -Raw (Join-Path $projectRoot "package.json") | ConvertFrom-Json).version

function Get-Asset([string]$pattern, [string]$label) {
  # Version-qualified: a dist/ directory that still holds an older build would otherwise be picked
  # alphabetically and stamp the manifests with the wrong release hash.
  $candidates = @(Get-ChildItem -Path $sourceDir -Filter $pattern -File | Where-Object { $_.Name -like "*$version*" })
  if ($candidates.Count -eq 0) { throw "Missing $label for version $version in ${sourceDir} (pattern: $pattern)" }
  if ($candidates.Count -gt 1) { throw "Ambiguous $label for version ${version}: $($candidates.Name -join ', ')" }
  $asset = $candidates[0]
  [pscustomobject]@{
    Name = $asset.Name
    Hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $asset.FullName).Hash.ToLowerInvariant()
  }
}

$installer = Get-Asset "*Setup*.exe" "NSIS installer"
$portable = Get-Asset "*-win.zip" "portable ZIP"

Write-Host "version   : $version"
Write-Host "installer : $($installer.Name)  $($installer.Hash)"
Write-Host "portable  : $($portable.Name)  $($portable.Hash)"

# URL-encode the asset names once; GitHub replaces spaces with dots in download URLs.
$installerUrlName = $installer.Name -replace " ", "."
$portableUrlName = $portable.Name -replace " ", "."

$replacements = @{
  "REPLACE_WITH_SHA256_OF_NSIS_INSTALLER" = $installer.Hash
  "REPLACE_WITH_SHA256_OF_PORTABLE_ZIP"   = $portable.Hash
}

if (Test-Path $outDir) { Remove-Item -LiteralPath $outDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

foreach ($template in Get-ChildItem -Path (Join-Path $projectRoot "packaging") -Recurse -File -Include *.yaml, *.json, *.nuspec, *.ps1 |
  Where-Object { $_.FullName -notlike "$outDir*" }) {
  $relative = $template.FullName.Substring((Join-Path $projectRoot "packaging").Length).TrimStart([IO.Path]::DirectorySeparatorChar)
  $target = Join-Path $outDir $relative
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null

  $content = Get-Content -Raw -LiteralPath $template.FullName
  foreach ($key in $replacements.Keys) { $content = $content.Replace($key, $replacements[$key]) }
  $content = $content -replace "0\.2\.0", $version
  $content = $content.Replace("OMP.Switch.Setup.$version.exe", $installerUrlName)
  $content = $content.Replace("OMP.Switch-$version-win.zip", $portableUrlName)
  [IO.File]::WriteAllText($target, $content, [Text.UTF8Encoding]::new($false))
  Write-Host "rendered  : $relative"
}

$stillTemplated = Get-ChildItem -Path $outDir -Recurse -File | Select-String -Pattern "REPLACE_WITH_" -SimpleMatch
if ($stillTemplated) { throw "Unreplaced placeholder remains: $($stillTemplated -join ', ')" }

Write-Host "`nRendered manifests are in $outDir. Review them before submitting to winget-pkgs, a Scoop bucket, or the Chocolatey feed."
