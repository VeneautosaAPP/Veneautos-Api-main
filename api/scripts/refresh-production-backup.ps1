# Refresca el backup de la base de datos de producción (Supabase) a SQL plano local.
# NO toca nada en Railway/Supabase/Vercel: solo lee (pg_dump) y guarda en local.
#
# Uso: powershell -ExecutionPolicy Bypass -File api\scripts\refresh-production-backup.ps1
#
# Salida: api\backups\produccion_dump_PUBLIC_YYYY-MM-DD.sql  (listo para restaurar en PG16 local)

$ErrorActionPreference = 'Stop'

$pgBin = "$env:LOCALAPPDATA\Temp\opencode\pg17\pgsql\bin"
$pgDump = "$pgBin\pg_dump.exe"

if (-not (Test-Path $pgDump)) { throw "No se encontró pg_dump en $pgDump" }

$conn = 'postgresql://postgres.yqtojjbeihgptjzgjggy:dmeraksauriojagalosaurio6963@aws-1-sa-east-1.pooler.supabase.com:6543/postgres'

$stamp = Get-Date -Format 'yyyy-MM-dd'
$out = Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..')).Path "backups\produccion_dump_PUBLIC_$stamp.sql"

Write-Host "Generando dump de producción (solo schema public)..."
& $pgDump -d $conn --format=plain --no-owner --no-privileges -n 'public' --file="$out"
if ($LASTEXITCODE -ne 0) { throw "pg_dump falló (exit $LASTEXITCODE)" }

Write-Host "Limpiando lineas incompatibles con PG16..."
$content = Get-Content $out
$content = $content | Where-Object { $_ -notmatch '^SET transaction_timeout' -and $_ -notmatch '^CREATE SCHEMA public;' }
$content | Set-Content $out -Encoding UTF8

Write-Host "Backup listo: $out ($((Get-Item $out).Length) bytes)"