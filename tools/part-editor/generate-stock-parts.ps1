# Generates tools/part-editor/stock-parts.js from the game's AllParts.txt, so the
# editor can take a stock part apart: its category, mass, modules and connection
# points become a part.json to start from.
#
# Usage:
#   .\generate-stock-parts.ps1
#   .\generate-stock-parts.ps1 -AllParts "D:\Games\Rocket Science\AllParts.txt"
param(
    [string]$AllParts = 'E:\SteamLibrary\steamapps\common\Rocket Science\AllParts.txt',
    [string]$Output = (Join-Path $PSScriptRoot 'stock-parts.js')
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $AllParts)) {
    Write-Host "AllParts.txt not found: $AllParts" -ForegroundColor Red
    exit 1
}

function Vec3($value) {
    if ($null -eq $value) { return @() }
    return @([math]::Round([double]$value.x, 5), [math]::Round([double]$value.y, 5), [math]::Round([double]$value.z, 5))
}

$parts = @()

foreach ($line in Get-Content -LiteralPath $AllParts -Encoding UTF8) {
    $text = $line.Trim()
    if (-not $text.StartsWith('{')) { continue }

    $schema = $text | ConvertFrom-Json

    $attachments = @()
    foreach ($connection in @($schema.partConnections)) {
        if ($null -eq $connection) { continue }

        $attachment = [ordered]@{
            id = [int]$connection.id
            position = Vec3 $connection.position
            shape = $connection.shape
        }

        if ($null -ne $connection.direction) {
            $attachment.direction = Vec3 $connection.direction
        }
        if ($null -ne $connection.rotation -and $null -ne $connection.rotation.value) {
            $rotation = $connection.rotation.value
            $attachment.rotation = @(
                [math]::Round([double]$rotation.x, 6),
                [math]::Round([double]$rotation.y, 6),
                [math]::Round([double]$rotation.z, 6),
                [math]::Round([double]$rotation.w, 6)
            )
            $attachment.rotationOrder = 'ZXY'
        }
        if (@($connection.sockets).Count -gt 0) {
            # The comma keeps every socket an array of its own instead of
            # flattening all of them into one long list of numbers.
            $attachment.sockets = @(@($connection.sockets) | ForEach-Object { ,(Vec3 $_) })
        }
        if ($connection.flags -and $connection.flags -ne 'none') {
            $attachment.flags = $connection.flags
        }
        if ($null -ne $connection.center) {
            $attachment.center = Vec3 $connection.center
        }
        if ($null -ne $connection.dimensions) {
            $attachment.size = @(
                [math]::Round([double]$connection.dimensions.x, 5),
                [math]::Round([double]$connection.dimensions.y, 5),
                [math]::Round([double]$connection.dimensions.z, 5)
            )
        }

        $attachments += $attachment
    }

    $part = [ordered]@{
        name = $schema.name
        category = $schema.category
        mass = [math]::Round([double]$schema.mass, 3)
        description = $schema.description
        tags = @($schema.tags)
        impactTolerance = $schema.impactTolerance
        modules = $schema.config
        state = $schema.state
        attachments = $attachments
    }

    # Surface sockets: the defindexes and shapes the stock part carries. The
    # editor offers the same configs in its own list (dynamic-presets.js).
    $dynamic = @($schema.dynamicAttachmentConfigs | Where-Object { $null -ne $_ })
    if ($dynamic.Count -gt 0) {
        $part.dynamicAttachmentConfigs = @($dynamic | ForEach-Object {
            [ordered]@{ defindex = [int]$_.defindex; shape = $_.shape }
        })
    }
    if ($null -ne $schema.dynamicCurrPivot) {
        $part.dynamicCurrPivot = Vec3 $schema.dynamicCurrPivot
    }
    if ($null -ne $schema.radialSnapping) {
        $part.radialSnapping = $schema.radialSnapping
    }

    $variants = @($schema.variants | Where-Object { $null -ne $_ })
    if ($variants.Count -gt 0) {
        $part.variants = $variants
    }

    $parts += $part
}

$json = $parts | ConvertTo-Json -Depth 12 -Compress
$header = "// Generated from the game's AllParts.txt - do not edit by hand.`n" +
          "// Run tools/part-editor/generate-stock-parts.ps1 again when the game updates.`n" +
          "export const STOCK_PARTS = "
$content = $header + $json + ";" + "`n"

[System.IO.File]::WriteAllText($Output, $content, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ("Wrote {0} stock parts to {1} ({2:N0} bytes)" -f $parts.Count, $Output, $content.Length) -ForegroundColor Green
