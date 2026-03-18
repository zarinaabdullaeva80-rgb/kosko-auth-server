@echo off
chcp 65001 >nul
REM ============================================
REM  KOSKO Auto-Import: Loyalty Cards from CSV
REM  Put this .bat on the 1C computer
REM  Schedule with Windows Task Scheduler (every hour)
REM ============================================

SET KOSKO_SERVER=https://kosko-auth-server.onrender.com
SET CSV_FOLDER=C:\1C_Export
SET CSV_FILE=%CSV_FOLDER%\loyalty_cards.csv

REM Check if CSV file exists
IF NOT EXIST "%CSV_FILE%" (
    echo [%date% %time%] CSV file not found: %CSV_FILE%
    echo Make sure 1C exports to: %CSV_FILE%
    echo Format: phone;name;balance (semicolon separated)
    exit /b 1
)

echo [%date% %time%] Starting KOSKO loyalty import from %CSV_FILE%

REM Read CSV and send each line to KOSKO API
SET /A imported=0
SET /A errors=0

FOR /F "usebackq skip=1 tokens=1-3 delims=;" %%A IN ("%CSV_FILE%") DO (
    powershell -Command "try { $r = Invoke-RestMethod -Uri '%KOSKO_SERVER%/api/loyalty' -Method POST -ContentType 'application/json' -Body ('{\"phone\":\"%%A\",\"name\":\"%%B\",\"balance\":%%C}'); if($r.ok) { Write-Host 'OK: %%A' } else { Write-Host 'ERR: %%A' } } catch { Write-Host 'FAIL: %%A - ' + $_.Exception.Message }"
    SET /A imported+=1
)

echo [%date% %time%] Import complete. Processed: %imported% cards

REM Rename file to avoid re-import
SET BACKUP=%CSV_FOLDER%\loyalty_imported_%date:~-4%%date:~3,2%%date:~0,2%.csv
move "%CSV_FILE%" "%BACKUP%" >nul 2>&1
echo [%date% %time%] CSV moved to: %BACKUP%

pause
