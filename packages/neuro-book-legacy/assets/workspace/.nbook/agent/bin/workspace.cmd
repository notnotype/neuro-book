@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "SOURCE_RELATIVE_PATH=server\workspace-files\workspace-command.ts"

call :resolve_application_root
if errorlevel 1 (
    echo 无法定位 NeuroBook Application Root。 1>&2
    exit /b 1
)

set "PRODUCT_COMMAND=%APPLICATION_ROOT%\.output\server\commands\product-command.mjs"
set "SOURCE_SCRIPT=%APPLICATION_ROOT%\%SOURCE_RELATIVE_PATH%"
if defined BUN (
    set "BUN_RUNTIME=%BUN%"
) else if exist "%APPLICATION_ROOT%\..\runtime\bun\bun.exe" (
    set "BUN_RUNTIME=%APPLICATION_ROOT%\..\runtime\bun\bun.exe"
) else (
    set "BUN_RUNTIME=bun"
)

if /I "%NODE_ENV%"=="development" (
    call :is_source_dev
    if not errorlevel 1 goto run_source_dev
)
if exist "%PRODUCT_COMMAND%" goto run_product
call :is_product_present
if not errorlevel 1 (
    echo Product Runtime 不完整：缺少 .output/server/commands/product-command.mjs。 1>&2
    exit /b 1
)
call :is_source_dev
if not errorlevel 1 goto run_source_dev

echo 无法定位可运行的 NeuroBook workspace CLI。 1>&2
exit /b 1

:run_product
set "NEURO_BOOK_APPLICATION_ROOT=%APPLICATION_ROOT%"
"%BUN_RUNTIME%" --no-install --no-env-file "%PRODUCT_COMMAND%" command workspace %*
set "EXIT_CODE=%ERRORLEVEL%"
exit /b %EXIT_CODE%

:run_source_dev
set "NEURO_BOOK_APPLICATION_ROOT=%APPLICATION_ROOT%"
"%BUN_RUNTIME%" --no-install "%SOURCE_SCRIPT%" %*
set "EXIT_CODE=%ERRORLEVEL%"
exit /b %EXIT_CODE%

:resolve_application_root
if defined NEURO_BOOK_APPLICATION_ROOT (
    for %%I in ("%NEURO_BOOK_APPLICATION_ROOT%") do set "APPLICATION_ROOT=%%~fI"
    exit /b 0
)
for %%I in ("%SCRIPT_DIR%") do set "CANDIDATE=%%~fI"
:resolve_application_root_loop
if exist "%CANDIDATE%\package.json" (
    if exist "%CANDIDATE%\%SOURCE_RELATIVE_PATH%" goto application_root_found
    if exist "%CANDIDATE%\.output\server\commands\product-command.mjs" goto application_root_found
    if exist "%CANDIDATE%\.output\runtime-image.json" goto application_root_found
    if exist "%CANDIDATE%\.output\server\index.mjs" goto application_root_found
)
for %%I in ("%CANDIDATE%\..") do set "PARENT=%%~fI"
if /I "%PARENT%"=="%CANDIDATE%" exit /b 1
set "CANDIDATE=%PARENT%"
goto resolve_application_root_loop
:application_root_found
set "APPLICATION_ROOT=%CANDIDATE%"
exit /b 0

:is_source_dev
if not exist "%APPLICATION_ROOT%\node_modules" exit /b 1
if not exist "%SOURCE_SCRIPT%" exit /b 1
exit /b 0

:is_product_present
if exist "%APPLICATION_ROOT%\.output\runtime-image.json" exit /b 0
if exist "%APPLICATION_ROOT%\.output\runtime-image.ready" exit /b 0
if exist "%APPLICATION_ROOT%\.output\server\runtime-contract.json" exit /b 0
if exist "%APPLICATION_ROOT%\.output\server\index.mjs" exit /b 0
exit /b 1
