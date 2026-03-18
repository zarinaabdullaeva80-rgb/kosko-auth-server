@echo off
chcp 65001 >nul
REM ============================================
REM  KOSKO Auto-Import: Discount Cards (IgotoShop 11.3)
REM  Format: Tab-separated (Код  Наименование  Код карты  Владелец)
REM  Schedule with Windows Task Scheduler
REM ============================================

SET KOSKO_SERVER=https://kosko-auth-server.onrender.com
SET CSV_FILE=%~dp0loyalty_cards.csv

REM Also check Desktop
IF NOT EXIST "%CSV_FILE%" SET CSV_FILE=%USERPROFILE%\Desktop\Список.csv

REM Check if file exists
IF NOT EXIST "%CSV_FILE%" (
    echo [%date% %time%] CSV file not found
    echo Put the file next to this .bat or export from IgotoShop to Desktop
    pause
    exit /b 1
)

echo [%date% %time%] Starting KOSKO import from: %CSV_FILE%
echo.

powershell -ExecutionPolicy Bypass -Command ^
    "$lines = Get-Content '%CSV_FILE%' -Encoding UTF8; " ^
    "$total = $lines.Count - 1; $ok = 0; $err = 0; " ^
    "Write-Host ('Total cards: ' + $total); " ^
    "for ($i = 1; $i -lt $lines.Count; $i++) { " ^
    "    $parts = $lines[$i] -split \"`t\"; " ^
    "    $code = $parts[0].Trim(); " ^
    "    $name = $parts[1].Trim(); " ^
    "    if (-not $code -and -not $name) { continue }; " ^
    "    $isBarcode = $name -match '^\d{10,}$'; " ^
    "    $cardName = if ($isBarcode) { 'Card ' + $name } else { $name }; " ^
    "    $body = @{ phone = $code; name = $cardName; balance = 0; level = 'Стандарт'; source = 'IgotoShop' } | ConvertTo-Json -Compress; " ^
    "    try { " ^
    "        $r = Invoke-RestMethod -Uri '%KOSKO_SERVER%/api/loyalty' -Method POST -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($body)); " ^
    "        if ($r.ok) { $ok++ } else { $err++ }; " ^
    "    } catch { $err++ }; " ^
    "    if ($i %% 20 -eq 0) { Write-Host ('  Imported ' + $ok + '/' + $total + '...') }; " ^
    "}; " ^
    "Write-Host ''; " ^
    "Write-Host ('Done! Imported: ' + $ok + ', Errors: ' + $err);"

echo.
echo [%date% %time%] Import complete
pause
