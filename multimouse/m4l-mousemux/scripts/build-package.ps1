[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$manifestPath = Join-Path $projectRoot 'bridge\Cargo.toml'
$distRoot = Join-Path $projectRoot 'dist'
$packageRoot = Join-Path $distRoot 'CoLaB MouseMux'

& cargo build --manifest-path $manifestPath --release --locked
if ($LASTEXITCODE -ne 0) { throw 'Rust release build failed.' }

# Rebuild only this generated package; never carry stale sidecars into a release.
$expectedPackageRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot 'dist\CoLaB MouseMux'))
if ([System.IO.Path]::GetFullPath($packageRoot) -ne $expectedPackageRoot) {
    throw 'Package path escaped the generated output directory.'
}
foreach ($outputPath in @($distRoot, $packageRoot)) {
    if ((Test-Path -LiteralPath $outputPath) -and
        ((Get-Item -LiteralPath $outputPath).Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
        throw "Refusing to rebuild through a directory link: $outputPath"
    }
}
if (Test-Path -LiteralPath $packageRoot) {
    Remove-Item -LiteralPath $packageRoot -Recurse -Force
}
& python (Join-Path $PSScriptRoot 'build-device.py')
if ($LASTEXITCODE -ne 0) { throw 'Max device build failed.' }
& python (Join-Path $projectRoot '..\..\skills\max-for-live-amxd\scripts\amxd.py') inspect (Join-Path $packageRoot 'CoLaB MouseMux.amxd')
if ($LASTEXITCODE -ne 0) { throw 'AMXD container validation failed.' }

New-Item -ItemType Directory -Force -Path (Join-Path $packageRoot 'bin') | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'bridge\target\release\mousemux-live-bridge.exe') -Destination (Join-Path $packageRoot 'bin\mousemux-live-bridge.exe')
Copy-Item -LiteralPath (Join-Path $projectRoot 'README.md') -Destination $packageRoot
Copy-Item -LiteralPath (Join-Path $projectRoot 'PROTOCOL.md') -Destination $packageRoot

$metadataText = & cargo metadata --manifest-path $manifestPath --locked --format-version 1
if ($LASTEXITCODE -ne 0) { throw 'Dependency metadata failed.' }
$metadata = $metadataText | ConvertFrom-Json
$notices = [System.Collections.Generic.List[string]]::new()
$notices.Add('# Rust dependency licenses')
foreach ($package in $metadata.packages) {
    if (-not $package.source) { continue }
    $notices.Add("- $($package.name) $($package.version): $($package.license)")
    $crateDirectory = Split-Path -Parent $package.manifest_path
    $licenseDestination = Join-Path $packageRoot "licenses\$($package.name)-$($package.version)"
    $licenseFiles = @(Get-ChildItem -LiteralPath $crateDirectory -File |
        Where-Object { $_.Name -match '^(LICENSE|LICENCE|COPYING|NOTICE|UNLICENSE)' })
    if ($package.license_file) {
        $customLicense = Join-Path $crateDirectory $package.license_file
        if (Test-Path -LiteralPath $customLicense) { $licenseFiles += Get-Item -LiteralPath $customLicense }
    }
    if ($licenseFiles.Count -gt 0) {
        New-Item -ItemType Directory -Force -Path $licenseDestination | Out-Null
        foreach ($licenseFile in ($licenseFiles | Sort-Object FullName -Unique)) {
            Copy-Item -LiteralPath $licenseFile.FullName -Destination $licenseDestination
        }
    }
}
$notices | Set-Content -LiteralPath (Join-Path $packageRoot 'THIRD_PARTY_NOTICES.md') -Encoding utf8
$hashes = Get-ChildItem -LiteralPath $packageRoot -Recurse -File |
    Where-Object { $_.Name -ne 'SHA256SUMS.txt' } |
    Sort-Object FullName |
    ForEach-Object {
        $digest = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        "$digest  $([System.IO.Path]::GetRelativePath($packageRoot, $_.FullName))"
    }
$hashes | Set-Content -LiteralPath (Join-Path $packageRoot 'SHA256SUMS.txt') -Encoding utf8
$archivePath = Join-Path $distRoot 'CoLaB-MouseMux-Windows.zip'
Compress-Archive -LiteralPath $packageRoot -DestinationPath $archivePath -Force
Write-Output "Package: $packageRoot"
Write-Output "Archive: $archivePath"
