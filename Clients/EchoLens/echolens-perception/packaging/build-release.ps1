#!/usr/bin/env pwsh
# Build the EchoLens Perception Probe release package (Windows x64).
#
#   pwsh packaging/build-release.ps1
#
# Produces dist/EchoLens-Probe-<ver>-win-x64.zip containing:
#   echolens-probe.exe + README.txt + Run-EchoLens-Probe.bat
#
# dist/ is git-ignored (build output); packaging/ holds the tracked sources.

$ErrorActionPreference = "Stop"
$crate = Split-Path $PSScriptRoot -Parent
Set-Location $crate

$ver = "v0.1.0-m1"
$dist = Join-Path $crate "dist"

Write-Host "Building release binary..."
cargo build --release --bin echolens-probe

New-Item -ItemType Directory -Path $dist -Force | Out-Null
Copy-Item "target/release/echolens-probe.exe" "$dist/echolens-probe.exe" -Force
Copy-Item "packaging/README.txt" "$dist/README.txt" -Force
Copy-Item "packaging/Run-EchoLens-Probe.bat" "$dist/Run-EchoLens-Probe.bat" -Force

$zip = Join-Path $dist "EchoLens-Probe-$ver-win-x64.zip"
if (Test-Path $zip) { Remove-Item $zip }
Compress-Archive -Path "$dist/echolens-probe.exe", "$dist/README.txt", "$dist/Run-EchoLens-Probe.bat" -DestinationPath $zip

$z = Get-Item $zip
Write-Host ("Done: {0}  ({1:N0} KB)" -f $z.FullName, ($z.Length / 1KB))
