@echo off
setlocal
cd /d "%~dp0"
set "UVALUE_BUNDLED_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
set "UVALUE_ENV_ARG="
if exist ".env" set "UVALUE_ENV_ARG=--env-file=.env"
if exist "%UVALUE_BUNDLED_NODE%" (
  "%UVALUE_BUNDLED_NODE%" %UVALUE_ENV_ARG% backend\server.mjs
) else (
  node %UVALUE_ENV_ARG% backend\server.mjs
)
pause
