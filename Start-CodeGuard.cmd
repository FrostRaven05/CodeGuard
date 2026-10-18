@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -Command "$taskNode = (Get-Command node -ErrorAction Stop).Source; $taskLogDir = Join-Path (Get-Location).Path '.local'; New-Item -ItemType Directory -Path $taskLogDir -Force | Out-Null; Start-Process -FilePath $taskNode -ArgumentList 'scripts/start.mjs' -WorkingDirectory (Get-Location).Path -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskLogDir 'launch.log') -RedirectStandardError (Join-Path $taskLogDir 'launch-error.log')"
if errorlevel 1 pause
