[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0, ValueFromRemainingArguments = $true)]
  [string[]] $FileName,

  [switch] $DryRun,

  [string] $ServerUrl,

  [string] $PublicBaseUrl = "https://vps-aad12be0.vps.ovh.net/assets/calques/hero-calques"
)

$ErrorActionPreference = "Stop"

$HeroCalqueFolder = "hero-calques"
$ObservedMaxBytes = 2 * 1024 * 1024
$ResizeAttempts = @(900, 800, 700, 600)

function Get-RepoRoot {
  return (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

function Read-DotEnv {
  param([string] $Path)

  $values = @{}

  if (-not (Test-Path $Path)) {
    return $values
  }

  Get-Content $Path | ForEach-Object {
    $line = [string] $_
    if ($line -match '^\s*#') {
      return
    }

    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
      $key = $matches[1]
      $value = $matches[2].Trim()

      if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
        $value = $value.Substring(1, $value.Length - 2)
      }

      $values[$key] = $value
    }
  }

  return $values
}

function Get-ConfigValue {
  param(
    [hashtable] $DotEnv,
    [string[]] $Names,
    [string] $Fallback = ""
  )

  foreach ($name in $Names) {
    $envValue = [Environment]::GetEnvironmentVariable($name)
    if (-not [string]::IsNullOrWhiteSpace($envValue)) {
      return @{
        Value = $envValue
        Source = "environment:$name"
      }
    }

    if ($DotEnv.ContainsKey($name) -and -not [string]::IsNullOrWhiteSpace($DotEnv[$name])) {
      return @{
        Value = $DotEnv[$name]
        Source = ".env.local:$name"
      }
    }
  }

  return @{
    Value = $Fallback
    Source = "default"
  }
}

function Format-Bytes {
  param([long] $Bytes)

  if ($Bytes -ge 1MB) {
    return ("{0:N2} Mo" -f ($Bytes / 1MB))
  }

  if ($Bytes -ge 1KB) {
    return ("{0:N0} Ko" -f ($Bytes / 1KB))
  }

  return "$Bytes o"
}

function Get-ImageInfo {
  param([string] $Path)

  Add-Type -AssemblyName System.Drawing
  $item = Get-Item -LiteralPath $Path
  $image = [System.Drawing.Image]::FromFile($Path)

  try {
    return @{
      Path = $Path
      Bytes = [long] $item.Length
      Width = [int] $image.Width
      Height = [int] $image.Height
      Sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
    }
  } finally {
    $image.Dispose()
  }
}

function Compress-PngToMaxDimension {
  param(
    [string] $SourcePath,
    [string] $OutputPath,
    [int] $MaxDimension
  )

  Add-Type -AssemblyName System.Drawing
  $image = [System.Drawing.Image]::FromFile($SourcePath)

  try {
    $scale = [Math]::Min(1.0, $MaxDimension / [double] ([Math]::Max($image.Width, $image.Height)))
    $width = [Math]::Max(1, [int] [Math]::Round($image.Width * $scale))
    $height = [Math]::Max(1, [int] [Math]::Round($image.Height * $scale))
    $bitmap = New-Object System.Drawing.Bitmap($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)

    try {
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)

      try {
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.DrawImage($image, 0, 0, $width, $height)
      } finally {
        $graphics.Dispose()
      }

      $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $bitmap.Dispose()
    }
  } finally {
    $image.Dispose()
  }
}

function Get-UploadErrorMessage {
  param($ErrorRecord)

  if ($ErrorRecord.ErrorDetails -and $ErrorRecord.ErrorDetails.Message) {
    return [string] $ErrorRecord.ErrorDetails.Message
  }

  return [string] $ErrorRecord.Exception.Message
}

function Test-TooLargeError {
  param([string] $Message)

  return $Message -match "too large|file too large|taille|trop lourd"
}

function Invoke-CalqueUpload {
  param(
    [string] $Endpoint,
    [string] $Token,
    [string] $CalqueName,
    [string] $Path
  )

  $bytes = [IO.File]::ReadAllBytes($Path)
  $payload = @{
    kind = "hero"
    folder = $HeroCalqueFolder
    fileName = $CalqueName
    file_name = $CalqueName
    content_base64 = [Convert]::ToBase64String($bytes)
  } | ConvertTo-Json -Compress

  try {
    $response = Invoke-WebRequest `
      -Method Post `
      -Uri $Endpoint `
      -Headers @{ "X-GVG-Token" = $Token } `
      -ContentType "application/json" `
      -Body $payload `
      -TimeoutSec 90 `
      -UseBasicParsing

    return @{
      Ok = $true
      StatusCode = [int] $response.StatusCode
      Message = ""
    }
  } catch {
    $message = Get-UploadErrorMessage $_
    $statusCode = 0

    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      $statusCode = [int] $_.Exception.Response.StatusCode
    }

    return @{
      Ok = $false
      StatusCode = $statusCode
      Message = $message
      TooLarge = (Test-TooLargeError $message)
    }
  }
}

function Verify-PublicCalque {
  param(
    [string] $BaseUrl,
    [string] $CalqueName
  )

  $encodedName = [Uri]::EscapeDataString($CalqueName)
  $url = "$($BaseUrl.TrimEnd('/'))/$encodedName"
  $response = Invoke-WebRequest -Method Head -Uri $url -TimeoutSec 20 -UseBasicParsing

  return @{
    Url = $url
    StatusCode = [int] $response.StatusCode
    ContentLength = $response.Headers["Content-Length"]
    ContentType = $response.Headers["Content-Type"]
  }
}

$repoRoot = Get-RepoRoot
$dotEnvPath = Join-Path $repoRoot ".env.local"
$dotEnv = Read-DotEnv $dotEnvPath
$serverConfig = if (-not [string]::IsNullOrWhiteSpace($ServerUrl)) {
  @{
    Value = $ServerUrl
    Source = "argument:ServerUrl"
  }
} else {
  Get-ConfigValue $dotEnv @("GVG_SERVER_URL", "GVG_VPS_URL") "http://152.228.128.157"
}
$tokenConfig = Get-ConfigValue $dotEnv @("GVG_API_TOKEN", "GVG_SERVER_TOKEN")
$server = [string] $serverConfig.Value
$server = $server.TrimEnd("/")
$endpoint = "$server/api/v1/calques/$HeroCalqueFolder/base64"
$sourceDir = Join-Path $repoRoot "public\hero-calques"

Write-Host "Hero calque source: $sourceDir"
Write-Host "Upload endpoint: $endpoint"
Write-Host "Server source: $($serverConfig.Source)"

if ([string]::IsNullOrWhiteSpace($tokenConfig.Value)) {
  if ($DryRun) {
    Write-Warning "Token absent. Dry-run possible, upload impossible tant que GVG_API_TOKEN n'est pas disponible."
  } else {
    throw "GVG_API_TOKEN absent. Configure l'environnement ou .env.local."
  }
} else {
  Write-Host "Token: present ($($tokenConfig.Source))"
}

$hadError = $false

foreach ($rawName in $FileName) {
  $calqueName = [IO.Path]::GetFileName($rawName)

  if ($calqueName -ne $rawName) {
    Write-Error "Nom invalide '$rawName'. Passe uniquement le nom du fichier, sans chemin."
    $hadError = $true
    continue
  }

  if (-not $calqueName.ToLowerInvariant().EndsWith(".png")) {
    Write-Error "Fichier invalide '$calqueName'. Seuls les PNG sont acceptes."
    $hadError = $true
    continue
  }

  $sourcePath = Join-Path $sourceDir $calqueName

  if (-not (Test-Path -LiteralPath $sourcePath)) {
    Write-Error "Fichier introuvable: $sourcePath"
    $hadError = $true
    continue
  }

  $originalInfo = Get-ImageInfo $sourcePath
  Write-Host ""
  Write-Host "== $calqueName =="
  Write-Host "Original: $(Format-Bytes $originalInfo.Bytes) / $($originalInfo.Width)x$($originalInfo.Height) / sha256=$($originalInfo.Sha256)"

  if ($DryRun) {
    if ($originalInfo.Bytes -gt $ObservedMaxBytes) {
      Write-Host "Dry-run: upload original tente en premier, puis compression si le VPS repond 'file too large'."
      Write-Host "Dry-run: dimensions de compression candidates: $($ResizeAttempts -join ', ') px max."
    } else {
      Write-Host "Dry-run: upload direct probable, puis verification publique."
    }

    continue
  }

  $uploadPath = $sourcePath
  $sentInfo = $originalInfo
  $upload = Invoke-CalqueUpload $endpoint $tokenConfig.Value $calqueName $uploadPath

  if (-not $upload.Ok -and $upload.TooLarge) {
    Write-Host "Upload original refuse pour taille excessive. Preparation d'une copie temporaire PNG..."
    $uploadedCompressed = $false
    $tempRoot = Join-Path ([IO.Path]::GetTempPath()) "hero-calques-upload"
    New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null

    foreach ($maxDimension in $ResizeAttempts) {
      $tempPath = Join-Path $tempRoot $calqueName
      Compress-PngToMaxDimension $sourcePath $tempPath $maxDimension
      $sentInfo = Get-ImageInfo $tempPath
      Write-Host "Compression candidate max=$maxDimension px: $(Format-Bytes $sentInfo.Bytes) / $($sentInfo.Width)x$($sentInfo.Height)"
      $upload = Invoke-CalqueUpload $endpoint $tokenConfig.Value $calqueName $tempPath

      if ($upload.Ok) {
        $uploadPath = $tempPath
        $uploadedCompressed = $true
        break
      }

      if (-not $upload.TooLarge) {
        break
      }
    }

    if (-not $uploadedCompressed -and -not $upload.Ok) {
      Write-Error "Upload KO pour $calqueName : $($upload.Message)"
      $hadError = $true
      continue
    }
  }

  if (-not $upload.Ok) {
    Write-Error "Upload KO pour $calqueName : $($upload.Message)"
    $hadError = $true
    continue
  }

  Write-Host "Upload OK: status=$($upload.StatusCode), envoye=$(Format-Bytes $sentInfo.Bytes), dimensions=$($sentInfo.Width)x$($sentInfo.Height)"

  try {
    $public = Verify-PublicCalque $PublicBaseUrl $calqueName
    Write-Host "Verification publique OK: status=$($public.StatusCode), length=$($public.ContentLength), type=$($public.ContentType)"
    Write-Host "URL: $($public.Url)"
  } catch {
    Write-Error "Verification publique KO pour $calqueName : $($_.Exception.Message)"
    $hadError = $true
  }
}

if ($hadError) {
  exit 1
}

Write-Host ""
Write-Host "Termine."
