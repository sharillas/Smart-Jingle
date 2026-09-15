param(
  [Parameter(Mandatory=$true)][string]$OutPath,
  [int]$MaxWidth = 1100
)

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class SJWin32 {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

$proc = Get-Process "Smart Jingle" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { Write-Error "Smart Jingle window not found"; exit 1 }

if ([SJWin32]::IsIconic($proc.MainWindowHandle)) {
  [void][SJWin32]::ShowWindow($proc.MainWindowHandle, 9) # SW_RESTORE
  Start-Sleep -Milliseconds 500
}
[void][SJWin32]::SetForegroundWindow($proc.MainWindowHandle)
Start-Sleep -Milliseconds 900

$r = New-Object SJWin32+RECT
[void][SJWin32]::GetWindowRect($proc.MainWindowHandle, [ref]$r)
$w = $r.Right - $r.Left
$h = $r.Bottom - $r.Top
if ($w -le 0 -or $h -le 0) { Write-Error "Bad window rect"; exit 1 }

$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)

$scale = [Math]::Min(1.0, $MaxWidth / $w)
$nw = [int]($w * $scale)
$nh = [int]($h * $scale)
$final = New-Object System.Drawing.Bitmap($nw, $nh)
$g2 = [System.Drawing.Graphics]::FromImage($final)
$g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g2.DrawImage($bmp, 0, 0, $nw, $nh)

$dir = Split-Path -Parent $OutPath
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$final.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $g2.Dispose(); $bmp.Dispose(); $final.Dispose()
Write-Host "saved $OutPath ($nw x $nh)"
