@echo off
setlocal EnableExtensions

cd /d "%~dp0"

if not exist "node_modules\" (
  echo [ERROR] node_modules not found.
  echo Please run "npm install" first.
  pause
  exit /b 1
)

set "NODE_EXE="
set "NODE_DIR="

for %%P in (
  "%ProgramFiles%\nodejs\node.exe"
  "%ProgramFiles(x86)%\nodejs\node.exe"
  "%LocalAppData%\Programs\nodejs\node.exe"
) do (
  if not defined NODE_EXE if exist "%%~P" (
    set "NODE_EXE=%%~fP"
    set "NODE_DIR=%%~dpP"
  )
)

if not defined NODE_EXE (
  for /f "delims=" %%I in ('where node 2^>nul') do (
    if not defined NODE_EXE (
      set "NODE_EXE=%%~fI"
      set "NODE_DIR=%%~dpI"
    )
  )
)

if not defined NODE_EXE (
  echo [ERROR] node.exe not found.
  echo Please install Node.js 18 or later, then reopen this window.
  pause
  exit /b 1
)

set "NPM_CLI=%NODE_DIR%node_modules\npm\bin\npm-cli.js"
if not exist "%NPM_CLI%" (
  echo [ERROR] npm CLI not found under "%NODE_DIR%".
  echo Please reinstall Node.js or fix the installation.
  pause
  exit /b 1
)

echo Starting development server...
start "Infinite Canvas AI Dev" "%ComSpec%" /k ""%NODE_EXE%" "%NPM_CLI%" run dev"

timeout /t 5 /nobreak >nul
start "" "http://localhost:3000"

exit /b 0
