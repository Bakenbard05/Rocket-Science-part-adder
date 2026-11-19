# Serves the part editor as static files, because ES modules and the
# vendored three.js addons cannot be loaded from file:// reliably.
#
# Usage:
#   .\serve.ps1                 # port 8137, opens the browser
#   .\serve.ps1 -Port 9000      # another port
#   .\serve.ps1 -NoBrowser      # do not open a browser
param(
    [int]$Port = 8137,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
# The schema of part.json lives in the docs folder of the repository: the editor
# reads it from /docs/part.schema.json, the loader has it in the DLL.
$docs = Join-Path (Split-Path -Parent (Split-Path -Parent $root)) 'docs'
$prefix = "http://localhost:$Port/"

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add($prefix)
try {
    $listener.Start()
} catch {
    Write-Host "Could not listen on $prefix - is the port busy?" -ForegroundColor Red
    Write-Host $_.Exception.Message
    exit 1
}

$types = @{
    '.html' = 'text/html; charset=utf-8'
    '.htm'  = 'text/html; charset=utf-8'
    '.js'   = 'text/javascript; charset=utf-8'
    '.mjs'  = 'text/javascript; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.gif'  = 'image/gif'
    '.svg'  = 'image/svg+xml'
    '.ico'  = 'image/x-icon'
    '.glb'  = 'model/gltf-binary'
    '.gltf' = 'model/gltf+json'
    '.obj'  = 'text/plain; charset=utf-8'
    '.bin'  = 'application/octet-stream'
    '.wasm' = 'application/wasm'
}

Write-Host "Part editor: $prefix"
Write-Host "Press Ctrl+C to stop."

if (-not $NoBrowser) {
    Start-Process $prefix
}

while ($listener.IsListening) {
    $context = $listener.GetContext()
    $request = $context.Request
    $response = $context.Response
    try {
        $relative = [Uri]::UnescapeDataString($request.Url.AbsolutePath).TrimStart('/')
        if ([string]::IsNullOrWhiteSpace($relative)) { $relative = 'index.html' }
        $relative = $relative -replace '/', [System.IO.Path]::DirectorySeparatorChar

        # The docs folder of the repository is served under /docs/.
        $base = $root
        if ($relative.StartsWith('docs' + [System.IO.Path]::DirectorySeparatorChar)) {
            $base = $docs
            $relative = $relative.Substring('docs'.Length).TrimStart([System.IO.Path]::DirectorySeparatorChar)
        }

        $full = [System.IO.Path]::GetFullPath((Join-Path $base $relative))
        $rootFull = [System.IO.Path]::GetFullPath($base)

        if (-not $full.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
            $response.StatusCode = 403
            $response.Close()
            continue
        }
        if (Test-Path -LiteralPath $full -PathType Container) {
            $full = Join-Path $full 'index.html'
        }
        if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
            $response.StatusCode = 404
            $body = [Text.Encoding]::UTF8.GetBytes("Not found: $relative")
            $response.ContentType = 'text/plain; charset=utf-8'
            $response.ContentLength64 = $body.Length
            $response.OutputStream.Write($body, 0, $body.Length)
            $response.Close()
            continue
        }

        $bytes = [System.IO.File]::ReadAllBytes($full)
        $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
        $response.ContentType = if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' }
        $response.ContentLength64 = $bytes.Length
        # No cache at all: the editor changes its modules all the time and a
        # stale module in the browser is worse than a reload.
        $response.Headers['Cache-Control'] = 'no-store, no-cache, must-revalidate'
        $response.Headers['Pragma'] = 'no-cache'
        $response.Headers['Expires'] = '0'
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
    } catch {
        $response.StatusCode = 500
    } finally {
        $response.Close()
    }
}
