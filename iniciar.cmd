@echo off
setlocal
title CNPJ Prospect - local
cd /d "%~dp0"

echo ============================================
echo  CNPJ Prospect - inicio local
echo ============================================
echo.

if not exist "data\cnpj.duckdb" (
  echo [ERRO] Banco nao encontrado: data\cnpj.duckdb
  echo Rode: npm run sample ^&^& npm run ingest:sample
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [1/3] Instalando dependencias...
  call npm install
  if errorlevel 1 (
    echo [ERRO] Falha no npm install.
    pause
    exit /b 1
  )
) else (
  echo [1/3] Dependencias ok.
)

echo [2/3] Compilando TypeScript...
call npm run build
if errorlevel 1 (
  echo [ERRO] Falha na compilacao.
  pause
  exit /b 1
)

echo [3/3] Abrindo http://localhost:3000
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 3; Start-Process 'http://localhost:3000'"

set NODE_ENV=production
set PORT=3000
set HOST=127.0.0.1
node dist/src/api/server.js

echo.
echo Servidor encerrado.
pause
