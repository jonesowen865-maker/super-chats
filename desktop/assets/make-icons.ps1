Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Drawing.Drawing2D

function Draw-Icon([int]$size, [string]$outPng) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.Clear([System.Drawing.Color]::Transparent)

    # Rounded background
    $r = [int]($size * 0.22)
    $p = [int]($size * 0.03)
    $w = $size - $p*2
    $bgPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $bgPath.AddArc($p,         $p,         $r*2, $r*2, 180, 90)
    $bgPath.AddArc($p+$w-$r*2, $p,         $r*2, $r*2, 270, 90)
    $bgPath.AddArc($p+$w-$r*2, $p+$w-$r*2, $r*2, $r*2,   0, 90)
    $bgPath.AddArc($p,         $p+$w-$r*2, $r*2, $r*2,  90, 90)
    $bgPath.CloseFigure()
    $gradBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        [System.Drawing.Point]::new(0,0),
        [System.Drawing.Point]::new($size,$size),
        [System.Drawing.Color]::FromArgb(255,10,10,28),
        [System.Drawing.Color]::FromArgb(255,18,8,32)
    )
    $g.FillPath($gradBrush, $bgPath)
    $borderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(80,255,225,53), [float]([Math]::Max(1,$size/128)))
    $g.DrawPath($borderPen, $bgPath)

    $s = $size / 256.0
    # Glow behind bolt
    $glowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(60,255,180,0))
    $glow = [System.Drawing.PointF[]]@(
        [System.Drawing.PointF]::new([float](150*$s), [float](26*$s)),
        [System.Drawing.PointF]::new([float](94*$s),  [float](136*$s)),
        [System.Drawing.PointF]::new([float](126*$s), [float](136*$s)),
        [System.Drawing.PointF]::new([float](106*$s), [float](232*$s)),
        [System.Drawing.PointF]::new([float](162*$s), [float](120*$s)),
        [System.Drawing.PointF]::new([float](130*$s), [float](120*$s))
    )
    for ($i=1;$i-le 6;$i++) {
        $expanded = $glow | ForEach-Object { [System.Drawing.PointF]::new($_.X+$i*0.7,$_.Y+$i*0.7) }
        $g.FillPolygon($glowBrush, $expanded)
    }
    # Main lightning bolt
    $bolt = [System.Drawing.PointF[]]@(
        [System.Drawing.PointF]::new([float](150*$s), [float](26*$s)),
        [System.Drawing.PointF]::new([float](94*$s),  [float](136*$s)),
        [System.Drawing.PointF]::new([float](126*$s), [float](136*$s)),
        [System.Drawing.PointF]::new([float](106*$s), [float](232*$s)),
        [System.Drawing.PointF]::new([float](162*$s), [float](120*$s)),
        [System.Drawing.PointF]::new([float](130*$s), [float](120*$s))
    )
    $boltBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255,255,225,53))
    $g.FillPolygon($boltBrush, $bolt)
    # Highlight
    $hi = [System.Drawing.PointF[]]@(
        [System.Drawing.PointF]::new([float](150*$s), [float](26*$s)),
        [System.Drawing.PointF]::new([float](118*$s), [float](96*$s)),
        [System.Drawing.PointF]::new([float](140*$s), [float](96*$s)),
        [System.Drawing.PointF]::new([float](150*$s), [float](26*$s))
    )
    $hiBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(120,255,255,255))
    $g.FillPolygon($hiBrush, $hi)

    $g.Dispose()
    $bmp.Save($outPng, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "Saved $outPng"
}

function Png-To-Ico([string]$pngPath, [string]$icoPath) {
    $png    = [System.IO.File]::ReadAllBytes($pngPath)
    $pngLen = $png.Length
    $offset = 22
    $hdr  = [byte[]](0,0, 1,0, 1,0)
    $dir  = [byte[]](
        0,0,0,0,
        1,0, 32,0,
        [byte]($pngLen-band 0xFF),[byte](($pngLen-shr 8)-band 0xFF),[byte](($pngLen-shr 16)-band 0xFF),[byte](($pngLen-shr 24)-band 0xFF),
        [byte]($offset-band 0xFF),[byte](($offset-shr 8)-band 0xFF),0,0
    )
    $s = [System.IO.File]::OpenWrite($icoPath)
    $s.Write($hdr,0,$hdr.Length); $s.Write($dir,0,$dir.Length); $s.Write($png,0,$png.Length)
    $s.Close()
    Write-Host "Saved $icoPath"
}

$base = Split-Path $MyInvocation.MyCommand.Path
Draw-Icon 256 "$base\icon.png"
Draw-Icon 32  "$base\tray-icon.png"
Png-To-Ico    "$base\icon.png" "$base\icon.ico"
Write-Host "Done!"
