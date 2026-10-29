@echo off
setlocal
chcp 65001 > nul 2>&1

set "SCRIPT_DIR=%~dp0"
if "%~1"=="" goto prompt
rem Forward CheckOnly and explicit StageAll to the versioned implementation.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%push-agentvn-editor.ps1" %*
goto result

:prompt
echo Default: publish staged changes only. Stage selected files first.
set /p "MESSAGE=Enter a commit message: "
if "%MESSAGE%"=="" set "MESSAGE=Update AgentVN Editor"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%push-agentvn-editor.ps1" -Message "%MESSAGE%"

:result
set "EXITCODE=%ERRORLEVEL%"
if not "%EXITCODE%"=="0" (
  echo.
  echo [AgentVN Editor] Push failed with exit code %EXITCODE%.
)
exit /b %EXITCODE%
