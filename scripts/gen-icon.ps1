param(
  [ValidateSet("white", "black", "blue")]
  [string]$Color = "white"
)

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$assets = Join-Path $root "assets"
$srcPng = Join-Path $assets "icon.png"
$outIco = Join-Path $assets "icon.ico"

if (-not (Test-Path $srcPng)) { Write-Error "assets/icon.png not found"; exit 1 }

# ---- 1. Mono variant PNG (used for the window title bar icon) ----
$src = [System.Drawing.Bitmap]::FromFile($srcPng)
$fill = switch ($Color) {
  "white" { [System.Drawing.Color]::FromArgb(255, 255, 255, 255) }
  "black" { [System.Drawing.Color]::FromArgb(255, 0, 0, 0) }
  default  { [System.Drawing.Color]::FromArgb(255, 39, 144, 255) }
}
$mono = New-Object System.Drawing.Bitmap($src.Width, $src.Height)
for ($y = 0; $y -lt $src.Height; $y++) {
  for ($x = 0; $x -lt $src.Width; $x++) {
    $p = $src.GetPixel($x, $y)
    if ($p.A -gt 40) { $mono.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($p.A, $fill.R, $fill.G, $fill.B)) }
    else { $mono.SetPixel($x, $y, [System.Drawing.Color]::Transparent) }
  }
}
$monoPng = Join-Path $assets ("icon-" + $Color + ".png")
$mono.Save($monoPng, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host "$monoPng written (window title bar icon)"
$mono.Dispose()
$src.Dispose()

# ---- 2. icon.ico from the ORIGINAL colored icon (taskbar / shortcut / installer) ----
$srcOriginal = [System.Drawing.Bitmap]::FromFile($srcPng)
$sizes = @(256, 128, 64, 48, 32, 16)
$pngBytes = @{}
foreach ($s in $sizes) {
  $b = New-Object System.Drawing.Bitmap($s, $s)
  $g = [System.Drawing.Graphics]::FromImage($b)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.DrawImage($srcOriginal, 0, 0, $s, $s)
  $ms = [System.IO.MemoryStream]::new()
  $b.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $pngBytes[$s] = $ms.ToArray()
  $g.Dispose(); $b.Dispose(); $ms.Dispose()
}
$srcOriginal.Dispose()

$msIco = [System.IO.MemoryStream]::new()
$bw = [System.IO.BinaryWriter]::new($msIco)
$bw.Write([UInt16]0)
$bw.Write([UInt16]1)
$bw.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
foreach ($s in $sizes) {
  $data = $pngBytes[$s]
  $dim = if ($s -ge 256) { 0 } else { $s }
  $bw.Write([Byte]$dim)
  $bw.Write([Byte]$dim)
  $bw.Write([Byte]0)
  $bw.Write([Byte]0)
  $bw.Write([UInt16]1)
  $bw.Write([UInt16]32)
  $bw.Write([UInt32]$data.Length)
  $bw.Write([UInt32]$offset)
  $offset += $data.Length
}
foreach ($s in $sizes) {
  $bw.Write($pngBytes[$s])
}
$bw.Flush()
[System.IO.File]::WriteAllBytes($outIco, $msIco.ToArray())
$bw.Dispose()
$msIco.Dispose()
Write-Host "icon.ico regenerated from ORIGINAL colors (taskbar / shortcut / installer)"
