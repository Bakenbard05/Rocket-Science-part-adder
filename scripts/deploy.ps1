# Builds PartAdder, deploys it into a Workshop mod folder and optionally zips it.
#
#   .\scripts\deploy.ps1 -WorkshopId 1234567890
#   .\scripts\deploy.ps1 -WorkshopId 1234567890 -Zip
#   .\scripts\deploy.ps1 -TargetDirectory "D:\mods\PartAdder"
#
# The target folder is treated as the mod folder and is mirrored: files that are no
# longer part of the build are removed. Never point it at the game root itself.

param(
    [string]$WorkshopId = '',
    [string]$TargetDirectory = '',
    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Release',
    [string]$GameRoot = 'E:\SteamLibrary\steamapps\common\Rocket Science',
    [switch]$NoBuild,
    [switch]$Zip
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$project = Join-Path $root 'RSExtension.csproj'
$output = Join-Path $root "bin\$Configuration\netstandard2.1"
$stage = Join-Path $root 'dist\staging'

function Resolve-Dotnet {
    $command = Get-Command dotnet -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }

    $fallback = 'C:\Program Files\dotnet\dotnet.exe'
    if (Test-Path $fallback) { return $fallback }

    throw "dotnet was not found. Install the .NET SDK or add it to PATH."
}

if (-not $NoBuild) {
    $dotnet = Resolve-Dotnet
    Write-Host "Building $Configuration..."
    & $dotnet build $project -c $Configuration -v m
    if ($LASTEXITCODE -ne 0) { throw "Build failed with exit code $LASTEXITCODE" }
}

if (-not (Test-Path (Join-Path $output 'RSExtension.dll'))) {
    throw "RSExtension.dll was not found in $output. Build first or drop -NoBuild."
}

if (-not $TargetDirectory) {
    if (-not $WorkshopId) {
        throw "Pass -WorkshopId <item id> or -TargetDirectory <folder>."
    }

    $steamApps = Split-Path -Parent (Split-Path -Parent $GameRoot)
    $TargetDirectory = Join-Path $steamApps "workshop\content\890520\$WorkshopId"
}

$targetFull = [System.IO.Path]::GetFullPath($TargetDirectory)
$gameFull = [System.IO.Path]::GetFullPath($GameRoot)
if ($targetFull.TrimEnd('\') -eq $gameFull.TrimEnd('\')) {
    throw "Refusing to deploy into the game root. Use the mod folder instead."
}

# Stage exactly what the game should see, so bin/ can contain build leftovers.
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null

Get-ChildItem $output -File -Filter '*.dll' |
    Where-Object { $_.Name -eq 'RSExtension.dll' } |
    Copy-Item -Destination $stage

$config = Join-Path $root 'config.json'
if (-not (Test-Path $config)) { throw "config.json is missing; the game will not load the mod." }
Copy-Item $config -Destination $stage

$preview = Join-Path $root 'preview.png'
if (Test-Path $preview) {
    Copy-Item $preview -Destination $stage
} else {
    Write-Warning "preview.png is missing; the mod will show no Workshop preview image."
}

$parts = Join-Path $output 'Parts'
if (-not (Test-Path $parts)) {
    Write-Warning "No Parts folder in the build output; the mod will load with zero parts."
} else {
    Copy-Item $parts -Destination (Join-Path $stage 'Parts') -Recurse
}

Write-Host "Deploying to $targetFull"
New-Item -ItemType Directory -Force -Path $targetFull | Out-Null

# robocopy exit codes 0-7 are success; 8+ are errors.
& robocopy $stage $targetFull /MIR /NFL /NDL /NJH /NJS /NP | Out-Host
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }
$global:LASTEXITCODE = 0

if ($Zip) {
    $dist = Join-Path $root 'dist'
    New-Item -ItemType Directory -Force -Path $dist | Out-Null
    $zipPath = Join-Path $dist ("PartAdder-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + ".zip")
    Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zipPath -Force
    Write-Host "Packaged $zipPath"
}

Write-Host "Done. Game log: %USERPROFILE%\AppData\LocalLow\unbeGames\Rocket Science\Player.log"
Write-Host "Mod log: $targetFull\PartAdder.log"
