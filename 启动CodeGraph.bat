@echo off
setlocal
cd /d "%~dp0"
title CodeGraph Studio

where pwsh >nul 2>nul
if %ERRORLEVEL% equ 0 (
    pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1" %*
    exit /b %ERRORLEVEL%
)

echo [ERROR] PowerShell 7 (pwsh) not found in PATH.
echo Please install PowerShell 7 or ensure pwsh is in system PATH.
pause
exit /b 1