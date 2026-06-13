Add-Type -AssemblyName System.Drawing

$iconDirectory = Join-Path $PSScriptRoot "..\src\icons"
$sizes = 16, 32, 48, 128

foreach ($size in $sizes) {
    $scale = $size / 128
    $bitmap = [System.Drawing.Bitmap]::new($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([System.Drawing.Color]::Transparent)

    $backgroundPath = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $radius = 40 * $scale
    $diameter = $radius * 2
    $bounds = [System.Drawing.RectangleF]::new(0, 0, $size, $size)
    $backgroundPath.AddArc($bounds.Left, $bounds.Top, $diameter, $diameter, 180, 90)
    $backgroundPath.AddArc($bounds.Right - $diameter, $bounds.Top, $diameter, $diameter, 270, 90)
    $backgroundPath.AddArc(
        $bounds.Right - $diameter,
        $bounds.Bottom - $diameter,
        $diameter,
        $diameter,
        0,
        90
    )
    $backgroundPath.AddArc($bounds.Left, $bounds.Bottom - $diameter, $diameter, $diameter, 90, 90)
    $backgroundPath.CloseFigure()

    $gradient = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
        [System.Drawing.PointF]::new(16 * $scale, 12 * $scale),
        [System.Drawing.PointF]::new(112 * $scale, 116 * $scale),
        [System.Drawing.ColorTranslator]::FromHtml("#8178ff"),
        [System.Drawing.ColorTranslator]::FromHtml("#5d78dc")
    )
    $graphics.FillPath($gradient, $backgroundPath)

    $pen = [System.Drawing.Pen]::new([System.Drawing.Color]::White, [Math]::Max(1.5, 10 * $scale))
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

    $graphics.DrawRectangle($pen, 22 * $scale, 23 * $scale, 39 * $scale, 32 * $scale)
    $graphics.DrawRectangle($pen, 70 * $scale, 73 * $scale, 39 * $scale, 32 * $scale)

    $connector = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $connector.StartFigure()
    $connector.AddBezier(
        41.5 * $scale,
        55 * $scale,
        41.5 * $scale,
        70 * $scale,
        49 * $scale,
        78 * $scale,
        70 * $scale,
        78 * $scale
    )
    $graphics.DrawPath($pen, $connector)

    $output = Join-Path $iconDirectory "icon-$size.png"
    $bitmap.Save($output, [System.Drawing.Imaging.ImageFormat]::Png)

    $connector.Dispose()
    $pen.Dispose()
    $gradient.Dispose()
    $backgroundPath.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
}

Write-Output "Generated WorkTrace AI icons: $($sizes -join ', ')px"
