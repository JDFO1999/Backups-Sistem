@echo off
title Sistema Gestion de Backups
echo ======================================================
echo    INICIANDO SISTEMA DE GESTION DE BACKUPS
echo ======================================================
echo.

cd /d "%~dp0"

echo [1/2] Iniciando Backend FastAPI (Puerto 8000)...
start "Backend - Gestion Backups" cmd /k "cd backend && venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload"

timeout /t 3 /nobreak >nul

echo [2/2] Iniciando Frontend Vite (Puerto 5173)...
start "Frontend - Gestion Backups" cmd /k "cd frontend && npm run dev -- --host 127.0.0.1 --port 5173"

timeout /t 3 /nobreak >nul

echo Abriendo panel en el navegador...
start http://127.0.0.1:5173

echo.
echo ======================================================
echo  Sistema iniciado con exito!
echo  Puedes minimizar esta ventana.
echo ======================================================
pause
