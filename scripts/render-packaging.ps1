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

function Resolve-ProjectPath([string]$value) {
  if ([IO.Path]::IsPathRooted($value)) { return [IO.Path]::GetFullPath($value) }
  return [IO.Path]::GetFullPath((Join-Path $projectRoot $value))
}

$sourceDir = Resolve-ProjectPath $Source
$outDir = Resolve-ProjectPath $Destination

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

# Asset names are space-free by construction (see build.artifactName), so the uploaded asset name is
# exactly the local file name and needs no transformation.
$installerUrlName = $installer.Name
$portableUrlName = $portable.Name

$replacements = @{
  "REPLACE_WITH_SHA256_OF_NSIS_INSTALLER" = $installer.Hash
  "REPLACE_WITH_SHA256_OF_PORTABLE_ZIP"   = $portable.Hash
}

$templateRoot = Join-Path $projectRoot "packaging"
$committedOutputDir = [IO.Path]::GetFullPath((Join-Path $templateRoot "out"))

if (Test-Path $outDir) { Remove-Item -LiteralPath $outDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

foreach ($template in Get-ChildItem -Path $templateRoot -Recurse -File -Include *.yaml, *.json, *.nuspec, *.ps1 |
  Where-Object { $_.FullName -notlike "$outDir*" -and $_.FullName -notlike "$committedOutputDir*" }) {
  $relative = $template.FullName.Substring($templateRoot.Length).TrimStart([IO.Path]::DirectorySeparatorChar)
  $target = Join-Path $outDir $relative
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null

  $content = Get-Content -Raw -LiteralPath $template.FullName
  foreach ($key in $replacements.Keys) { $content = $content.Replace($key, $replacements[$key]) }
  $content = $content -replace "0\.2\.0", $version
  $content = $content.Replace("OMP-Switch-Setup-$version.exe", $installerUrlName)
  $content = $content.Replace("OMP-Switch-$version-win.zip", $portableUrlName)
  [IO.File]::WriteAllText($target, $content, [Text.UTF8Encoding]::new($false))
  Write-Host "rendered  : $relative"
}

$stillTemplated = Get-ChildItem -Path $outDir -Recurse -File | Select-String -Pattern "REPLACE_WITH_" -SimpleMatch
if ($stillTemplated) { throw "Unreplaced placeholder remains: $($stillTemplated -join ', ')" }

# The Scoop bucket is served from this repository, so its manifest must carry a real hash in a
# tracked file rather than a placeholder. Update it in place.
$bucketPath = Join-Path $projectRoot "bucket/omp-switch.json"
if (Test-Path $bucketPath) {
  $bucket = Get-Content -Raw -LiteralPath $bucketPath | ConvertFrom-Json
  $bucketUrl = "https://github.com/skh2945932142/omp-switch/releases/download/v$version/$portableUrlName"
  if ($bucket.version -eq $version -and $bucket.architecture."64bit".url -eq $bucketUrl -and $bucket.architecture."64bit".hash -eq $portable.Hash) {
    Write-Host "unchanged : bucket/omp-switch.json already matches the published asset"
  } else {
    $nodeScript = @'
const fs = require("node:fs");
const [path, version, url, hash] = process.argv.slice(1);
const manifest = JSON.parse(fs.readFileSync(path, "utf8"));
manifest.version = version;
manifest.architecture["64bit"].url = url;
manifest.architecture["64bit"].hash = hash;
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
'@
    $json = (& node -e $nodeScript $bucketPath $version $bucketUrl $portable.Hash | Out-String).TrimEnd("`r", "`n")
    if ($LASTEXITCODE -ne 0) { throw "Failed to render bucket/omp-switch.json" }
    [IO.File]::WriteAllText($bucketPath, "$json`n", [Text.UTF8Encoding]::new($false))
    Write-Host "updated   : bucket/omp-switch.json (tracked; commit this)"
  }
} else {
  Write-Host "bucket/omp-switch.json not found; skipping the Scoop bucket update." -ForegroundColor Yellow
}

Write-Host "`nRendered manifests are in $outDir. Review them before submitting to winget-pkgs or the Chocolatey feed."
Write-Host "The hashes above must come from the PUBLISHED release assets, not a local rebuild: a local"
Write-Host "build is not byte-identical to the CI build, so its hash would never match what users download."
