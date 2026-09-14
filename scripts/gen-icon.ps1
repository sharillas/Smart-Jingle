Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$assets = Join-Path $root "assets"
New-Item -ItemType Directory -Force -Path $assets | Out-Null

function New-IconBitmap([double]$size) {
  $bmp = [System.Drawing.Bitmap]::new([int]$size, [int]$size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  $r = $size * 0.20
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $path.AddArc(0, 0, $r, $r, 180, 90)
  $path.AddArc($size - $r, 0, $r, $r, 270, 90)
  $path.AddArc($size - $r, $size - $r, $r, $r, 0, 90)
  $path.AddArc(0, $size - $r, $r, $r, 90, 90)
  $path.CloseFigure()

  $rect = [System.Drawing.Rectangle]::new(0, 0, [int]$size, [int]$size)
  $bg = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    $rect,
    [System.Drawing.Color]::FromArgb(255, 26, 34, 51),
    [System.Drawing.Color]::FromArgb(255, 12, 16, 26),
    90)
  $g.FillPath($bg, $path)

  $border = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 62, 84, 122), [Math]::Max(1, $size * 0.012))
  $g.DrawPath($border, $path)

  $cy = $size / 2.0
  $cx = $size * 0.42
  $tri = $size * 0.16
  $triPts = [System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new([float]($cx - $tri * 0.5), [float]($cy - $tri)),
    [System.Drawing.PointF]::new([float]($cx - $tri * 0.5), [float]($cy + $tri)),
    [System.Drawing.PointF]::new([float]($cx + $tri * 0.75), [float]($cy))
  )
  $triRect = [System.Drawing.RectangleF]::new([float]($cx - $tri), [float]($cy - $tri), [float]($tri * 2), [float]($tri * 2))
  $triBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    $triRect,
    [System.Drawing.Color]::FromArgb(255, 84, 160, 255),
    [System.Drawing.Color]::FromArgb(255, 30, 111, 217),
    90)
  $g.FillPolygon($triBrush, $triPts)

  $barX = $cx + $tri * 1.15
  $barW = $size * 0.045
  $heights = @(($tri * 0.6), ($tri * 1.3), ($tri * 1.0), ($tri * 1.6))
  $barBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 111, 177, 255))
  $barBrush2 = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 47, 129, 247))
  for ($i = 0; $i -lt 4; $i++) {
    $h = $heights[$i]
    $x = $barX + $i * ($barW * 2.2)
    $y = $cy - $h / 2
    $br = if ($i % 2 -eq 0) { $barBrush } else { $barBrush2 }
    $g.FillEllipse($br, [float]$x, [float]$y, [float]$barW, [float]$barW)
    $g.FillRectangle($br, [float]$x, [float]($y + $barW / 2), [float]$barW, [float]($h - $barW))
    $g.FillEllipse($br, [float]$x, [float]($y + $h - $barW), [float]$barW, [float]$barW)
  }

  $g.Dispose()
  return $bmp
}

$png512 = New-IconBitmap 512
$png512.Save((Join-Path $assets "icon.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$png512.Dispose()
Write-Host "icon.png saved"

$sizes = @(256, 64, 48, 32, 16)
$pngBytes = @{}
foreach ($s in $sizes) {
  $b = New-IconBitmap $s
  $ms = [System.IO.MemoryStream]::new()
  $b.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $pngBytes[$s] = $ms.ToArray()
  $b.Dispose()
  $ms.Dispose()
}

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
[System.IO.File]::WriteAllBytes((Join-Path $assets "icon.ico"), $msIco.ToArray())
$bw.Dispose()
$msIco.Dispose()
Write-Host "icon.ico saved"
