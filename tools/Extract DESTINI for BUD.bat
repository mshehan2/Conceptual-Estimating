@echo off
REM ---------------------------------------------------------------------------
REM  Extract the DESTINI snapshot into the three small files BUD imports.
REM
REM  Put this next to destini-extract.py and double-click it. If your snapshot
REM  lives somewhere else, change SNAPSHOT below and nothing else.
REM ---------------------------------------------------------------------------

setlocal

set "SNAPSHOT=%~dp0DESTINI Snapshot"
if not exist "%SNAPSHOT%\" set "SNAPSHOT=Z:\Shared\Precon\06-DESTINI Estimator Info\DESTINI Snapshot"

set "OUT=%~dp0destini-extract"

echo.
echo   Snapshot : %SNAPSHOT%
echo   Output   : %OUT%
echo.

if not exist "%SNAPSHOT%\" (
  echo   Cannot find the snapshot folder.
  echo   Open this .bat in Notepad and set SNAPSHOT to the right path.
  echo.
  pause
  exit /b 1
)

REM Python launcher first, plain python second.
where py >nul 2>&1 && (set "PY=py -3") || (set "PY=python")

%PY% --version >nul 2>&1
if errorlevel 1 (
  echo   Python is not installed, or not on PATH.
  echo   Install it from https://www.python.org/downloads/ and tick
  echo   "Add python.exe to PATH" on the first screen.
  echo.
  pause
  exit /b 1
)

echo   Checking for duckdb...
%PY% -c "import duckdb" 2>nul
if errorlevel 1 (
  echo   Installing duckdb...
  %PY% -m pip install --quiet duckdb
  if errorlevel 1 (
    echo   pip could not install duckdb. Try: %PY% -m pip install duckdb
    echo.
    pause
    exit /b 1
  )
)

echo.
%PY% "%~dp0destini-extract.py" --snapshot "%SNAPSHOT%" --out "%OUT%"

echo.
echo   Done. Send back the three files in:
echo   %OUT%
echo.
pause
