@echo off
title LeadsFlow
cd /d "%~dp0"

echo =============================================
echo    LeadsFlow - Iniciando...
echo =============================================
echo.

if not exist "node_modules\" (
    echo Instalando dependencias pela primeira vez...
    npm install
    echo.
)

npx electron .
