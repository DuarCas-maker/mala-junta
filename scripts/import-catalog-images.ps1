param(
  [string]$Workbook = "C:\Users\duarc\Downloads\Supabase Snippet Untitled query 637.xlsx",
  [string]$ImagesZip = "C:\Users\duarc\Downloads\Imagenes-20260814T201008Z-1-001.zip",
  [string]$EnvFile = ".env.local",
  [string]$Bucket = "catalogo-imagenes",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.IO.Compression.FileSystem

function Read-DotEnvValue([string]$Path, [string]$Name) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }

  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if ($trimmed -eq "" -or $trimmed.StartsWith("#")) { continue }
    $index = $trimmed.IndexOf("=")
    if ($index -lt 1) { continue }
    $key = $trimmed.Substring(0, $index).Trim()
    if ($key -ne $Name) { continue }
    return $trimmed.Substring($index + 1).Trim().Trim('"').Trim("'")
  }

  return $null
}

function Read-ZipEntryText($entry) {
  $reader = New-Object System.IO.StreamReader($entry.Open())
  try {
    return $reader.ReadToEnd()
  } finally {
    $reader.Dispose()
  }
}

function Get-XlsxColumnIndex([string]$CellRef) {
  $letters = ([regex]::Match($CellRef, "^[A-Z]+")).Value
  $number = 0
  foreach ($char in $letters.ToCharArray()) {
    $number = $number * 26 + ([int][char]$char - [int][char]"A" + 1)
  }
  return $number
}

function Read-XlsxRows([string]$Path) {
  $zip = [System.IO.Compression.ZipFile]::OpenRead($Path)
  try {
    $sharedStrings = @()
    $sharedEntry = $zip.GetEntry("xl/sharedStrings.xml")
    if ($sharedEntry) {
      [xml]$sharedXml = Read-ZipEntryText $sharedEntry
      $sharedNs = New-Object System.Xml.XmlNamespaceManager($sharedXml.NameTable)
      $sharedNs.AddNamespace("x", "http://schemas.openxmlformats.org/spreadsheetml/2006/main")
      foreach ($si in $sharedXml.SelectNodes("//x:si", $sharedNs)) {
        $sharedStrings += (($si.SelectNodes(".//x:t", $sharedNs) | ForEach-Object { $_."#text" }) -join "")
      }
    }

    [xml]$sheetXml = Read-ZipEntryText $zip.GetEntry("xl/worksheets/sheet1.xml")
    $sheetNs = New-Object System.Xml.XmlNamespaceManager($sheetXml.NameTable)
    $sheetNs.AddNamespace("x", "http://schemas.openxmlformats.org/spreadsheetml/2006/main")

    $matrix = @()
    foreach ($row in $sheetXml.SelectNodes("//x:sheetData/x:row", $sheetNs)) {
      $values = @{}
      foreach ($cell in $row.SelectNodes("x:c", $sheetNs)) {
        $column = Get-XlsxColumnIndex $cell.r
        $valueNode = $cell.SelectSingleNode("x:v", $sheetNs)
        $value = ""
        if ($valueNode) { $value = $valueNode.InnerText }
        if ($cell.t -eq "s" -and $value -ne "") {
          $value = $sharedStrings[[int]$value]
        } elseif ($cell.t -eq "inlineStr") {
          $value = (($cell.SelectNodes(".//x:t", $sheetNs) | ForEach-Object { $_."#text" }) -join "")
        }
        $values[$column] = $value
      }

      $max = 0
      if ($values.Keys.Count) { $max = ($values.Keys | Measure-Object -Maximum).Maximum }
      $matrix += ,(1..$max | ForEach-Object { if ($values.ContainsKey($_)) { $values[$_] } else { "" } })
    }

    $headers = $matrix[0]
    for ($rowIndex = 1; $rowIndex -lt $matrix.Count; $rowIndex++) {
      $object = [ordered]@{}
      for ($columnIndex = 0; $columnIndex -lt $headers.Count; $columnIndex++) {
        $object[$headers[$columnIndex]] = if ($columnIndex -lt $matrix[$rowIndex].Count) { $matrix[$rowIndex][$columnIndex] } else { "" }
      }
      [pscustomobject]$object
    }
  } finally {
    $zip.Dispose()
  }
}

function Get-MimeType([string]$Extension) {
  switch ($Extension.ToLowerInvariant()) {
    ".jpg" { "image/jpeg" }
    ".jpeg" { "image/jpeg" }
    ".png" { "image/png" }
    ".webp" { "image/webp" }
    ".heic" { "image/heic" }
    ".heif" { "image/heif" }
    default { "application/octet-stream" }
  }
}

if (-not (Test-Path -LiteralPath $Workbook)) { throw "No existe el Excel: $Workbook" }
if (-not (Test-Path -LiteralPath $ImagesZip)) { throw "No existe el ZIP: $ImagesZip" }

$supabaseUrl = Read-DotEnvValue $EnvFile "NEXT_PUBLIC_SUPABASE_URL"
$serviceRoleKey = Read-DotEnvValue $EnvFile "SUPABASE_SERVICE_ROLE_KEY"

if (-not $DryRun) {
  if (-not $supabaseUrl) { throw "Falta NEXT_PUBLIC_SUPABASE_URL en $EnvFile." }
  if (-not $serviceRoleKey) { throw "Falta SUPABASE_SERVICE_ROLE_KEY en $EnvFile." }
}

$rows = Read-XlsxRows $Workbook
$rows = @($rows | Where-Object { $_.tipo -and $_.item_id -and $_.archivo_imagen })
if ($rows.Count -eq 0) { throw "El Excel no tiene filas validas con tipo, item_id y archivo_imagen." }

$zip = [System.IO.Compression.ZipFile]::OpenRead($ImagesZip)
$tempDir = Join-Path ([IO.Path]::GetTempPath()) ("mala-junta-catalogo-" + [guid]::NewGuid().ToString("N"))
$headers = @{
  apikey = $serviceRoleKey
  Authorization = "Bearer $serviceRoleKey"
}

try {
  New-Item -ItemType Directory -Path $tempDir | Out-Null

  $entriesByFileName = @{}
  foreach ($entry in $zip.Entries | Where-Object { -not $_.FullName.EndsWith("/") }) {
    $entriesByFileName[[IO.Path]::GetFileName($entry.FullName)] = $entry
  }

  $updated = 0
  foreach ($row in $rows) {
    $tipo = ([string]$row.tipo).Trim().ToLowerInvariant()
    $itemId = ([string]$row.item_id).Trim()
    $fileName = ([string]$row.archivo_imagen).Trim()
    if ($tipo -ne "producto" -and $tipo -ne "combo") { throw "Tipo invalido en ${itemId}: $tipo" }
    if (-not $entriesByFileName.ContainsKey($fileName)) { throw "No se encontro en el ZIP: $fileName" }

    $entry = $entriesByFileName[$fileName]
    $extension = [IO.Path]::GetExtension($fileName)
    $storagePath = "$tipo/$itemId$extension"
    $localPath = Join-Path $tempDir ([IO.Path]::GetFileName($storagePath))
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $localPath, $true)

    if ($DryRun) {
      Write-Output "DRYRUN $tipo $itemId <- $fileName"
      $updated++
      continue
    }

    $uploadUrl = "$supabaseUrl/storage/v1/object/$Bucket/$storagePath"
    $uploadHeaders = $headers.Clone()
    $uploadHeaders["x-upsert"] = "true"
    Invoke-RestMethod -Method Post -Uri $uploadUrl -Headers $uploadHeaders -InFile $localPath -ContentType (Get-MimeType $extension) | Out-Null

    $publicUrl = "$supabaseUrl/storage/v1/object/public/$Bucket/$storagePath"
    $table = if ($tipo -eq "producto") { "productos" } else { "combos" }
    $patchUrl = "$supabaseUrl/rest/v1/$table" + "?id=eq.$itemId"
    $body = @{ imagen_url = $publicUrl } | ConvertTo-Json -Compress
    $patchHeaders = $headers.Clone()
    $patchHeaders["Content-Type"] = "application/json"
    $patchHeaders["Prefer"] = "return=minimal"
    Invoke-RestMethod -Method Patch -Uri $patchUrl -Headers $patchHeaders -Body $body | Out-Null

    $updated++
    Write-Output "OK $tipo $itemId <- $fileName"
  }

  Write-Output "Imagenes actualizadas: $updated"
} finally {
  $zip.Dispose()
  if (Test-Path -LiteralPath $tempDir) {
    Remove-Item -LiteralPath $tempDir -Recurse -Force
  }
}
