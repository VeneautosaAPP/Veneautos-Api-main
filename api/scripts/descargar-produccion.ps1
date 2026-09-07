# Descarga la base de datos de produccion (Supabase) a SQL plano local y, opcionalmente,
# la restaura en la BD local.
# NO toca nada en Railway/Supabase/Vercel: solo lee (pg_dump) y escribe en la BD local.
#
# Uso:
#   Solo descargar:              powershell -ExecutionPolicy Bypass -File api\scripts\descargar-produccion.ps1
#   Descargar y restaurar:       powershell -ExecutionPolicy Bypass -File api\scripts\descargar-produccion.ps1 -Restaurar
#   Con ruta custom del output:  ... -File api\scripts\descargar-produccion.ps1 -Salida "C:\ruta\backup.sql"
#
# El .bat de doble clic (descargar-produccion.bat) ya orquesta todo esto y pregunta al usuario.

param(
    [switch]$Restaurar,
    [string]$Salida = ''
)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Configuracion
# ---------------------------------------------------------------------------
$pgBin = "$env:LOCALAPPDATA\Temp\opencode\pg17\pgsql\bin"
$pgDump = "$pgBin\pg_dump.exe"
$psqlBin = "$env:LOCALAPPDATA\Temp\opencode\pg17\pgsql\bin\psql.exe"

# Conexion de PRODUCCION (pooler de transaccion, puerto 6543: el de sesion 5432 suele estar saturado)
$connProd = 'postgresql://postgres.yqtojjbeihgptjzgjggy:dmeraksauriojagalosaurio6963@aws-1-sa-east-1.pooler.supabase.com:6543/postgres'

# Conexion LOCAL (PostgreSQL 16 instalado en la PC)
$hostLocal = 'localhost'
$portLocal = 5432
$userLocal = 'vene'
$passLocal = 'vene'
$dbLocal = 'vene_autos'

# ---------------------------------------------------------------------------
# Paso 1: verificar herramientas PG17
# ---------------------------------------------------------------------------
if (-not (Test-Path $pgDump)) {
    Write-Host ""
    Write-Host "ERROR: No se encontro pg_dump 17 portable en:" -ForegroundColor Red
    Write-Host "  $pgDump" -ForegroundColor Yellow
    Write-Host "Ejecuta primero la descarga de binarios (ver docs/BACKUP_PRODUCCION_A_LOCAL.txt)." -ForegroundColor Yellow
    exit 1
}

# ---------------------------------------------------------------------------
# Paso 2: generar el dump de produccion (solo schema public)
# ---------------------------------------------------------------------------
$stamp = Get-Date -Format 'yyyy-MM-dd_HHmm'
if (-not $Salida) {
    $Salida = Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..')).Path "backups\produccion_dump_PUBLIC_$stamp.sql"
}

Write-Host ""
Write-Host "===================================================================="
Write-Host "  DESCARGA DE LA BASE DE PRODUCCION -> SQL local"
Write-Host "===================================================================="
Write-Host "Conectando a produccion (pooler 6543)..." -ForegroundColor Cyan
Write-Host "  Servidor: aws-1-sa-east-1.pooler.supabase.com (PostgreSQL 17.6)"
Write-Host "  Esquema:  public (solo los datos de la app)"

& $pgDump -d $connProd --format=plain --no-owner --no-privileges -n 'public' --file="$Salida"
if ($LASTEXITCODE -ne 0) { throw "pg_dump fallo (exit $LASTEXITCODE)" }

# Limpiar lineas incompatibles con PostgreSQL 16 local
$content = Get-Content $Salida
$content = $content | Where-Object { $_ -notmatch '^SET transaction_timeout' -and $_ -notmatch '^CREATE SCHEMA public;' }
# Escribir UTF-8 SIN BOM (el BOM puede romper psql de forma intermitente en Windows)
[System.IO.File]::WriteAllLines($Salida, $content, (New-Object System.Text.UTF8Encoding($false)))

$tamanoMB = [math]::Round((Get-Item $Salida).Length / 1MB, 2)
Write-Host ""
Write-Host "Backup listo:" -ForegroundColor Green
Write-Host "  $Salida"
Write-Host "  ($tamanoMB MB)"

# ---------------------------------------------------------------------------
# Paso 3 (opcional): restaurar en la BD local
# ---------------------------------------------------------------------------
if (-not $Restaurar) {
    Write-Host ""
    Write-Host "Descarga completada. El archivo quedo listo para restaurar desde la web:" -ForegroundColor Yellow
    Write-Host "  localhost:5173 -> Configuracion -> Backup and Restore -> Restaurar -> Docker local"
    exit 0
}

Write-Host ""
Write-Host "===================================================================="
Write-Host "  RESTAURA EN LA BD LOCAL"
Write-Host "===================================================================="
Write-Host "Destino: $dbLocal @ $hostLocal`:$portLocal (usuario $userLocal)"

$env:PGPASSWORD = $passLocal
$psql = "C:\Program Files\PostgreSQL\16\bin\psql.exe"

# Vaciar el esquema en sitio (sin DROP DATABASE, para no desconectar la API local si corre)
Write-Host "Vaciando esquema public..." -ForegroundColor Cyan
& $psql -h $hostLocal -p $portLocal -U $userLocal -d $dbLocal -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS public CASCADE;" -c "CREATE SCHEMA public AUTHORIZATION $userLocal;"
if ($LASTEXITCODE -ne 0) { throw "No se pudo vaciar el esquema local" }

Write-Host "Restaurando datos..." -ForegroundColor Cyan
$restoreOutput = & $psql -h $hostLocal -p $portLocal -U $userLocal -d $dbLocal -v ON_ERROR_STOP=1 -f $Salida 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "RESTORE FALLO - ultimas lineas de psql:" -ForegroundColor Red
    $restoreOutput | Where-Object { $null -ne $_ } | Select-Object -Last 25 | ForEach-Object { Write-Host $_.ToString() }
    throw "La restauracion fallo (exit $LASTEXITCODE)"
}

Write-Host ""
Write-Host "Restauracion COMPLETADA." -ForegroundColor Green
Write-Host "Datos en local:"
& $psql -h $hostLocal -p $portLocal -U $userLocal -d $dbLocal -t -A -c "SELECT '  Clientes: '||count(*) FROM customers; SELECT '  Ordenes:   '||count(*) FROM work_orders; SELECT '  Usuarios:  '||count(*) FROM users;"

Write-Host ""
Write-Host "IMPORTANTE: tras el restore, entra con una cuenta real de produccion" -ForegroundColor Yellow
Write-Host "(ej: granroko@gmail.com). El usuario admin@veneautos.local ya no existe."
Write-Host ""