@echo off
setlocal DisableDelayedExpansion
cd /d "%~dp0"
if errorlevel 1 exit /b 1
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to start the rehearsal.
  pause
  exit /b 1
)
node "%~dp0hollow-lantern\rehearsal-launch.mjs" --start --binding "%~dp0.runtime\hollow-lantern\rehearsal-native-20260910\binding.json"
set "rehearsalExit=%ERRORLEVEL%"
if not "%rehearsalExit%"=="0" (
  echo The rehearsal could not finish normally. Review the message above.
  pause
)
exit /b %rehearsalExit%
