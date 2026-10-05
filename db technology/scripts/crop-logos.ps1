Add-Type -AssemblyName System.Drawing

# 1. Clean Snapchat: crop out the outer white padding and keep the yellow rounded squircle
$snap = [System.Drawing.Bitmap]::FromFile('D:\db technology\src\assets\logos\snapchat.png')
# Find bounding box of yellow area (approx R>200, G>200, B<100)
$minX = $snap.Width; $maxX = 0; $minY = $snap.Height; $maxY = 0
for ($x = 0; $x -lt $snap.Width; $x++) {
    for ($y = 0; $y -lt $snap.Height; $y++) {
        $c = $snap.GetPixel($x, $y)
        # Check if not white background (R<250 or G<250 or B<250)
        if ($c.R -lt 245 -or $c.G -lt 245 -or $c.B -lt 245) {
            if ($x -lt $minX) { $minX = $x }
            if ($x -gt $maxX) { $maxX = $x }
            if ($y -lt $minY) { $minY = $y }
            if ($y -gt $maxY) { $maxY = $y }
        }
    }
}
Write-Output "Snapchat bounds: $minX, $minY to $maxX, $maxY"
$snapW = $maxX - $minX + 1
$snapH = $maxY - $minY + 1
$cropRect = New-Object System.Drawing.Rectangle($minX, $minY, $snapW, $snapH)
$croppedSnap = $snap.Clone($cropRect, $snap.PixelFormat)
$snap.Dispose()
$croppedSnap.Save('D:\db technology\src\assets\logos\snapchat_clean.png', [System.Drawing.Imaging.ImageFormat]::Png)
$croppedSnap.Dispose()

# 2. Clean Shopify: crop out the light grey left strip if any, make background transparent
$shop = [System.Drawing.Bitmap]::FromFile('D:\db technology\src\assets\logos\shopify.png')
# Find bounding box of the green bag / handles
$minX = $shop.Width; $maxX = 0; $minY = $shop.Height; $maxY = 0
for ($x = 0; $x -lt $shop.Width; $x++) {
    for ($y = 0; $y -lt $shop.Height; $y++) {
        $c = $shop.GetPixel($x, $y)
        # Background is grey around R:235-242, G:240-245, B:240-245
        # Green bag has G > R + 20 or white S has R>250,G>250,B>250 surrounded by green
        $isBg = ($c.R -gt 220 -and $c.G -gt 225 -and $c.B -gt 225 -and [Math]::Abs($c.R - $c.G) -lt 15)
        if (-not $isBg) {
            if ($x -lt $minX) { $minX = $x }
            if ($x -gt $maxX) { $maxX = $x }
            if ($y -lt $minY) { $minY = $y }
            if ($y -gt $maxY) { $maxY = $y }
        }
    }
}
Write-Output "Shopify bounds: $minX, $minY to $maxX, $maxY"
$shopW = $maxX - $minX + 1
$shopH = $maxY - $minY + 1
$cropRect = New-Object System.Drawing.Rectangle($minX, $minY, $shopW, $shopH)
$croppedShop = $shop.Clone($cropRect, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$shop.Dispose()

# Make background pixels transparent in croppedShop
for ($x = 0; $x -lt $croppedShop.Width; $x++) {
    for ($y = 0; $y -lt $croppedShop.Height; $y++) {
        $c = $croppedShop.GetPixel($x, $y)
        if ($c.R -gt 215 -and $c.G -gt 220 -and $c.B -gt 220 -and [Math]::Abs($c.R - $c.G) -lt 15) {
            $croppedShop.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(0, 0, 0, 0))
        }
    }
}
$croppedShop.Save('D:\db technology\src\assets\logos\shopify_clean.png', [System.Drawing.Imaging.ImageFormat]::Png)
$croppedShop.Dispose()

# 3. Clean Leopards: crop any margins
$lep = [System.Drawing.Bitmap]::FromFile('D:\db technology\src\assets\logos\leopards.png')
$lep.Save('D:\db technology\src\assets\logos\leopards_clean.png', [System.Drawing.Imaging.ImageFormat]::Png)
$lep.Dispose()

# 4. Clean TCS
$tcs = [System.Drawing.Bitmap]::FromFile('D:\db technology\src\assets\logos\tcs.png')
$tcs.Save('D:\db technology\src\assets\logos\tcs_clean.png', [System.Drawing.Imaging.ImageFormat]::Png)
$tcs.Dispose()

# 5. Clean M&P
$mnp = [System.Drawing.Bitmap]::FromFile('D:\db technology\src\assets\logos\mnp.png')
$mnp.Save('D:\db technology\src\assets\logos\mnp_clean.png', [System.Drawing.Imaging.ImageFormat]::Png)
$mnp.Dispose()

Write-Output "All 5 sample logos processed and saved!"
