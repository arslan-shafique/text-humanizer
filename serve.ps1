<#
  serve.ps1 — minimal static file server for local testing.

  The site itself needs no server at all: you can just double-click
  index.html. This is only here for convenience when you want to test
  it over http:// (which behaves the same way as the live site will).

  Usage:   powershell -ExecutionPolicy Bypass -File serve.ps1
  Then open http://localhost:8080  and press Ctrl+C here to stop.
#>

param([int]$Port = 8080)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$mime = @{
  ".html" = "text/html; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".js"   = "application/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".svg"  = "image/svg+xml"
  ".ico"  = "image/x-icon"
  ".txt"  = "text/plain; charset=utf-8"
  ".md"   = "text/plain; charset=utf-8"
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")

try { $listener.Start() }
catch { Write-Host "Could not bind to port $Port. Try another: -Port 8081"; exit 1 }

Write-Host "Serving $root"
Write-Host "  ->  http://localhost:$Port"
Write-Host "Press Ctrl+C to stop."

while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
  } catch { break }

  $rel = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart("/"))
  if ([string]::IsNullOrWhiteSpace($rel)) { $rel = "index.html" }

  $full = Join-Path $root $rel
  # Keep requests inside the site folder
  $resolved = $null
  try { $resolved = (Resolve-Path -LiteralPath $full -ErrorAction Stop).Path } catch { }

  if ($resolved -and $resolved.StartsWith($root) -and (Test-Path -LiteralPath $resolved -PathType Leaf)) {
    $ext = [System.IO.Path]::GetExtension($resolved).ToLower()
    $type = $mime[$ext]
    if (-not $type) { $type = "application/octet-stream" }
    $bytes = [System.IO.File]::ReadAllBytes($resolved)
    $ctx.Response.ContentType = $type
    $ctx.Response.StatusCode = 200
    $ctx.Response.ContentLength64 = $bytes.Length
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    Write-Host ("200  " + $rel)
  } else {
    $msg = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $rel")
    $ctx.Response.StatusCode = 404
    $ctx.Response.ContentType = "text/plain; charset=utf-8"
    $ctx.Response.ContentLength64 = $msg.Length
    $ctx.Response.OutputStream.Write($msg, 0, $msg.Length)
    Write-Host ("404  " + $rel)
  }
  $ctx.Response.OutputStream.Close()
}

$listener.Stop()
