[CmdletBinding()]
param(
  [switch] $DryRun,
  [switch] $KeepLocal,
  [string] $ServerUrl,
  [string] $LocalRoot,
  [string] $PublicBaseUrl = "https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics",
  [string] $EndpointTemplate = "/api/v1/profile-cosmetics/{assetType}/base64",
  [string] $ManifestPath
)

$ErrorActionPreference = "Stop"

function Get-RepoRoot {
  return (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

function Read-DotEnv {
  param([string] $Path)

  $values = @{}
  if (-not (Test-Path -LiteralPath $Path)) {
    return $values
  }

  Get-Content -LiteralPath $Path | ForEach-Object {
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
    return ("{0:N2} MiB" -f ($Bytes / 1MB))
  }

  if ($Bytes -ge 1KB) {
    return ("{0:N0} KiB" -f ($Bytes / 1KB))
  }

  return "$Bytes B"
}

function ConvertTo-UrlSegment {
  param([string] $Value)
  return [Uri]::EscapeDataString($Value)
}

function Test-SafePngFileName {
  param([string] $FileName)

  if ([string]::IsNullOrWhiteSpace($FileName)) {
    return $false
  }

  if ($FileName -ne [IO.Path]::GetFileName($FileName)) {
    return $false
  }

  if ($FileName.Contains("/") -or $FileName.Contains("\") -or $FileName.Contains("..")) {
    return $false
  }

  if ([IO.Path]::IsPathRooted($FileName)) {
    return $false
  }

  if ($FileName.Length -gt 180) {
    return $false
  }

  if ($FileName -notmatch "(?i)\.png$") {
    return $false
  }

  $forbiddenChars = [char[]]('/\:*?"<>|')
  if ($FileName.IndexOfAny($forbiddenChars) -ge 0) {
    return $false
  }

  return $FileName -notmatch "[\x00-\x1F]"
}

function Get-PngInfo {
  param([string] $Path)

  Add-Type -AssemblyName System.Drawing
  $item = Get-Item -LiteralPath $Path
  $image = [System.Drawing.Image]::FromFile($Path)

  try {
    $isPng = $image.RawFormat.Guid -eq [System.Drawing.Imaging.ImageFormat]::Png.Guid
    $flags = [int] $image.Flags
    $hasAlpha = (($flags -band 2) -ne 0) -or (($flags -band 4) -ne 0)

    return @{
      Path = $Path
      Bytes = [long] $item.Length
      Width = [int] $image.Width
      Height = [int] $image.Height
      Mode = [string] $image.PixelFormat
      IsPng = [bool] $isPng
      HasAlpha = [bool] $hasAlpha
      Sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
    }
  } finally {
    $image.Dispose()
  }
}

function Get-PublicAssetInfo {
  param(
    [string] $Url,
    [string] $TempDirectory
  )

  try {
    $head = Invoke-WebRequest -Method Head -Uri $Url -TimeoutSec 20 -UseBasicParsing
  } catch {
    $statusCode = if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      [int] $_.Exception.Response.StatusCode
    } else {
      0
    }

    return @{
      Exists = $false
      StatusCode = $statusCode
      ContentType = ""
      ContentLength = ""
      Info = $null
      Error = $_.Exception.Message
    }
  }

  $tempName = [IO.Path]::Combine($TempDirectory, ([Guid]::NewGuid().ToString("N") + ".png"))
  Invoke-WebRequest -Method Get -Uri $Url -OutFile $tempName -TimeoutSec 45 -UseBasicParsing

  return @{
    Exists = $true
    StatusCode = [int] $head.StatusCode
    ContentType = [string] ($head.Headers["Content-Type"] -join ";")
    ContentLength = [string] ($head.Headers["Content-Length"] -join ";")
    Info = Get-PngInfo $tempName
    Error = ""
  }
}

function Get-UploadErrorMessage {
  param($ErrorRecord)

  if ($ErrorRecord.ErrorDetails -and $ErrorRecord.ErrorDetails.Message) {
    return [string] $ErrorRecord.ErrorDetails.Message
  }

  return [string] $ErrorRecord.Exception.Message
}

function ConvertFrom-JsonMaybe {
  param($Text)

  try {
    if ($null -eq $Text) {
      return $null
    }

    if ($Text -is [byte[]]) {
      $Text = [System.Text.Encoding]::UTF8.GetString($Text)
    } else {
      $Text = [string] $Text
    }

    if ([string]::IsNullOrWhiteSpace($Text)) {
      return $null
    }

    return $Text | ConvertFrom-Json
  } catch {
    return [pscustomobject] @{ raw = $Text }
  }
}

function Get-FirstPropertyValue {
  param(
    $Object,
    [string[]] $Names,
    $Fallback = $null
  )

  if (-not $Object) {
    return $Fallback
  }

  foreach ($name in $Names) {
    $property = $Object.PSObject.Properties[$name]
    if ($property -and $null -ne $property.Value) {
      return $property.Value
    }
  }

  return $Fallback
}

function Invoke-ProfileCosmeticUpload {
  param(
    [string] $Server,
    [string] $Template,
    [string] $Token,
    [string] $AssetType,
    [string] $FileName,
    [string] $Path
  )

  $bytes = [IO.File]::ReadAllBytes($Path)
  $relativeEndpoint = $Template.Replace("{assetType}", [Uri]::EscapeDataString($AssetType))
  $endpoint = ([Uri]::new(([Uri]::new("$($Server.TrimEnd('/'))/")), $relativeEndpoint.TrimStart("/"))).ToString()
  $payload = @{
    asset_type = $AssetType
    fileName = $FileName
    file_name = $FileName
    content_base64 = [Convert]::ToBase64String($bytes)
  } | ConvertTo-Json -Compress
  $payloadBytes = [System.Text.Encoding]::UTF8.GetBytes($payload)

  try {
    $response = Invoke-WebRequest `
      -Method Post `
      -Uri $endpoint `
      -Headers @{ "X-GVG-Token" = $Token } `
      -ContentType "application/json" `
      -Body $payloadBytes `
      -TimeoutSec 90 `
      -UseBasicParsing

    return @{
      Ok = $true
      StatusCode = [int] $response.StatusCode
      Endpoint = $endpoint
      Body = ConvertFrom-JsonMaybe $response.Content
      Message = ""
    }
  } catch {
    $message = Get-UploadErrorMessage $_
    $statusCode = 0
    $body = $null

    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      $statusCode = [int] $_.Exception.Response.StatusCode
      try {
        $reader = New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())
        $body = ConvertFrom-JsonMaybe $reader.ReadToEnd()
      } catch {
        $body = $null
      }
    }

    return @{
      Ok = $false
      StatusCode = $statusCode
      Endpoint = $endpoint
      Body = $body
      Message = $message
    }
  }
}

function Test-UploadResponseMatchesLocal {
  param(
    $UploadBody,
    [string] $AssetType,
    [string] $FileName,
    $Info
  )

  if (-not $UploadBody) {
    return $false
  }

  $responseType = [string] (Get-FirstPropertyValue $UploadBody @("asset_type", "assetType") "")
  $responseName = [string] (Get-FirstPropertyValue $UploadBody @("filename", "file_name", "fileName") "")
  $responseSha = [string] (Get-FirstPropertyValue $UploadBody @("sha256") "")
  $responseWidth = [int] (Get-FirstPropertyValue $UploadBody @("width") 0)
  $responseHeight = [int] (Get-FirstPropertyValue $UploadBody @("height") 0)
  $responseSize = [long] (Get-FirstPropertyValue $UploadBody @("size") 0)
  $responseSuccess = [bool] (Get-FirstPropertyValue $UploadBody @("success", "ok") $false)

  return (
    $responseSuccess -and
    ($responseType -eq $AssetType) -and
    ($responseName -eq $FileName) -and
    ($responseSha.ToLowerInvariant() -eq $Info.Sha256) -and
    ($responseWidth -eq $Info.Width) -and
    ($responseHeight -eq $Info.Height) -and
    ($responseSize -eq $Info.Bytes)
  )
}

$repoRoot = Get-RepoRoot
$dotEnv = Read-DotEnv (Join-Path $repoRoot ".env.local")

if ([string]::IsNullOrWhiteSpace($LocalRoot)) {
  $LocalRoot = Join-Path $repoRoot "public\profile-cosmetics"
}

if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
  $ManifestPath = Join-Path $repoRoot "scripts\profile-cosmetics-upload-manifest.json"
}

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

$tempDirectory = Join-Path ([IO.Path]::GetTempPath()) ("profile-cosmetics-verify-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tempDirectory | Out-Null

$manifest = [ordered] @{
  generated_at = (Get-Date).ToUniversalTime().ToString("o")
  dry_run = [bool] $DryRun
  keep_local = [bool] $KeepLocal
  server_url = $server
  endpoint_template = $EndpointTemplate
  public_base_url = $PublicBaseUrl.TrimEnd("/")
  local_root = $LocalRoot
  assets = @()
  summary = $null
}

try {
  Write-Host "Profile cosmetics staging: $LocalRoot"
  Write-Host "Upload endpoint template: $($server.TrimEnd('/'))$EndpointTemplate"
  Write-Host "Public base URL: $PublicBaseUrl"
  Write-Host "Server source: $($serverConfig.Source)"
  if ($DryRun) {
    Write-Host "Mode: DryRun (no upload, no local cleanup)"
  } else {
    Write-Host "Token: $(if ([string]::IsNullOrWhiteSpace($tokenConfig.Value)) { 'missing' } else { "present ($($tokenConfig.Source))" })"
    Write-Host "KeepLocal: $([bool] $KeepLocal)"
  }

  $folders = @(
    @{ AssetType = "avatar"; Folder = "avatars"; RequiresAlpha = $false },
    @{ AssetType = "frame"; Folder = "frames"; RequiresAlpha = $true }
  )

  $uploaded = 0
  $skipped = 0
  $failed = 0
  $cleaned = 0
  $dryRunUploads = 0
  $hadError = $false

  foreach ($folderConfig in $folders) {
    $folderPath = Join-Path $LocalRoot $folderConfig.Folder
    if (-not (Test-Path -LiteralPath $folderPath)) {
      Write-Warning "Missing folder: $folderPath"
      continue
    }

    Get-ChildItem -LiteralPath $folderPath -Filter "*.png" -File | Sort-Object Name | ForEach-Object {
      $file = $_
      $info = Get-PngInfo $file.FullName
      $encodedName = ConvertTo-UrlSegment $file.Name
      $url = "$($PublicBaseUrl.TrimEnd('/'))/$($folderConfig.Folder)/$encodedName"

      Write-Host ""
      Write-Host "== $($folderConfig.AssetType.ToUpperInvariant()) $($file.Name) =="
      Write-Host "LOCAL bytes=$(Format-Bytes $info.Bytes) dims=$($info.Width)x$($info.Height) mode=$($info.Mode) alpha=$($info.HasAlpha) sha256=$($info.Sha256)"

      $record = [ordered] @{
        local_path = $file.FullName
        asset_type = $folderConfig.AssetType
        remote_folder = $folderConfig.Folder
        filename = $file.Name
        public_url = $url
        local_sha256 = $info.Sha256
        endpoint_sha256 = $null
        http_sha256 = $null
        width = $info.Width
        height = $info.Height
        size = $info.Bytes
        png_mode = $info.Mode
        alpha = $info.HasAlpha
        upload_status = ""
        http_status = ""
        http_content_type = ""
        already_exists = $false
        local_cleaned = $false
        error = ""
      }

      if (-not (Test-SafePngFileName $file.Name)) {
        $record.upload_status = "failed"
        $record.error = "Unsafe PNG filename"
        $failed++
        $hadError = $true
        $manifest.assets += [pscustomobject] $record
        Write-Warning "Unsafe filename: $($file.Name)"
        return
      }

      if (-not $info.IsPng) {
        $record.upload_status = "failed"
        $record.error = "Not a PNG"
        $failed++
        $hadError = $true
        $manifest.assets += [pscustomobject] $record
        Write-Warning "Not a PNG: $($file.FullName)"
        return
      }

      if ($info.Width -ne 1024 -or $info.Height -ne 1024) {
        $record.upload_status = "failed"
        $record.error = "Invalid dimensions: expected 1024x1024"
        $failed++
        $hadError = $true
        $manifest.assets += [pscustomobject] $record
        Write-Warning "Invalid dimensions for $($file.Name): $($info.Width)x$($info.Height)"
        return
      }

      if ($folderConfig.RequiresAlpha -and -not $info.HasAlpha) {
        $record.upload_status = "failed"
        $record.error = "Frame has no alpha channel"
        $failed++
        $hadError = $true
        $manifest.assets += [pscustomobject] $record
        Write-Warning "Frame alpha missing: $($file.FullName)"
        return
      }

      $remoteBefore = Get-PublicAssetInfo $url $tempDirectory
      if ($remoteBefore.Exists) {
        $record.http_status = "exists:$($remoteBefore.StatusCode)"
        $record.http_content_type = $remoteBefore.ContentType
        $record.http_sha256 = $remoteBefore.Info.Sha256

        $sameRemote =
          $remoteBefore.Info.Sha256 -eq $info.Sha256 -and
          $remoteBefore.Info.Width -eq $info.Width -and
          $remoteBefore.Info.Height -eq $info.Height

        if ($sameRemote) {
          $record.upload_status = "skip_existing"
          $record.already_exists = $true
          $skipped++
          Write-Host "SKIP existing remote matches local sha/dimensions."
        } else {
          $record.upload_status = "failed_collision"
          $record.error = "Remote filename exists with different sha/dimensions"
          $failed++
          $hadError = $true
          Write-Warning "STOP collision: remote filename exists but differs."
        }

        $manifest.assets += [pscustomobject] $record
        return
      }

      $record.http_status = "missing:$($remoteBefore.StatusCode)"

      if ($DryRun) {
        $record.upload_status = "dryrun_upload"
        $dryRunUploads++
        Write-Host "DRYRUN would upload via dedicated endpoint to: $url"
        $manifest.assets += [pscustomobject] $record
        return
      }

      if ([string]::IsNullOrWhiteSpace($tokenConfig.Value)) {
        $record.upload_status = "failed"
        $record.error = "GVG_API_TOKEN missing"
        $failed++
        $hadError = $true
        $manifest.assets += [pscustomobject] $record
        Write-Warning "GVG_API_TOKEN missing. Configure environment or .env.local."
        return
      }

      $upload = Invoke-ProfileCosmeticUpload $server $EndpointTemplate $tokenConfig.Value $folderConfig.AssetType $file.Name $file.FullName
      if (-not $upload.Ok) {
        $record.upload_status = "failed"
        $record.error = "Endpoint refused upload: status=$($upload.StatusCode) $($upload.Message)"
        $failed++
        $hadError = $true
        $manifest.assets += [pscustomobject] $record
        Write-Warning "Upload KO for $($file.Name): status=$($upload.StatusCode) $($upload.Message)"
        return
      }

      if (-not (Test-UploadResponseMatchesLocal $upload.Body $folderConfig.AssetType $file.Name $info)) {
        $record.upload_status = "failed"
        $record.error = "Endpoint response does not match local file"
        $failed++
        $hadError = $true
        $manifest.assets += [pscustomobject] $record
        Write-Warning "Upload response mismatch for $($file.Name)."
        return
      }

      $record.endpoint_sha256 = [string] $upload.Body.sha256
      $record.already_exists = [bool] (Get-FirstPropertyValue $upload.Body @("already_exists", "alreadyExists") $false)
      Write-Host "UPLOAD accepted: status=$($upload.StatusCode), sha256=$($record.endpoint_sha256)"

      $remoteAfter = Get-PublicAssetInfo $url $tempDirectory
      $verified =
        $remoteAfter.Exists -and
        $remoteAfter.StatusCode -eq 200 -and
        $remoteAfter.ContentType -match "image/png" -and
        $remoteAfter.Info.Sha256 -eq $info.Sha256 -and
        $remoteAfter.Info.Width -eq $info.Width -and
        $remoteAfter.Info.Height -eq $info.Height -and
        (-not $folderConfig.RequiresAlpha -or $remoteAfter.Info.HasAlpha)

      $record.http_status = if ($remoteAfter.Exists) { "verified:$($remoteAfter.StatusCode)" } else { "missing:$($remoteAfter.StatusCode)" }
      $record.http_content_type = $remoteAfter.ContentType
      $record.http_sha256 = if ($remoteAfter.Info) { $remoteAfter.Info.Sha256 } else { $null }

      if (-not $verified) {
        $record.upload_status = "failed"
        $record.error = "Remote HTTP verification failed"
        $failed++
        $hadError = $true
        $manifest.assets += [pscustomobject] $record
        Write-Warning "Remote verification failed for $($file.Name)."
        return
      }

      $record.upload_status = if ($record.already_exists) { "already_exists" } else { "uploaded" }
      $uploaded++
      Write-Host "VERIFIED status=200 type=$($remoteAfter.ContentType) sha256=$($remoteAfter.Info.Sha256)"

      if (-not $KeepLocal) {
        Remove-Item -LiteralPath $file.FullName -Force
        $record.local_cleaned = $true
        $cleaned++
        Write-Host "LOCAL CLEANED: $($file.FullName)"
      } else {
        Write-Host "LOCAL KEPT because -KeepLocal is set."
      }

      $manifest.assets += [pscustomobject] $record
    }
  }

  $manifest.summary = [ordered] @{
    uploaded = $uploaded
    skipped_existing = $skipped
    dryrun_uploads = $dryRunUploads
    failed = $failed
    local_files_cleaned = $cleaned
    total_assets = $manifest.assets.Count
  }

  $manifestDirectory = Split-Path -Parent $ManifestPath
  if (-not [string]::IsNullOrWhiteSpace($manifestDirectory)) {
    New-Item -ItemType Directory -Force -Path $manifestDirectory | Out-Null
  }
  $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ManifestPath -Encoding UTF8
  Write-Host ""
  Write-Host "Manifest: $ManifestPath"
  Write-Host "Uploaded: $uploaded"
  Write-Host "Skipped existing: $skipped"
  Write-Host "Dry-run uploads: $dryRunUploads"
  Write-Host "Failed: $failed"
  Write-Host "Local files cleaned: $cleaned"

  if ($hadError) {
    exit 1
  }
} finally {
  Remove-Item -LiteralPath $tempDirectory -Recurse -Force -ErrorAction SilentlyContinue
}
