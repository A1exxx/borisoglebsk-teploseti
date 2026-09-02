@echo off
title Сайт МУП "Борисоглебские теплосети"
cd /d "%~dp0server"

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Не найден Node.js. Установите его с сайта https://nodejs.org
  echo   Нужна версия 18 или новее, затем запустите этот файл снова.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo.
  echo   Первый запуск, устанавливаю зависимости. Это займёт около минуты.
  echo.
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo   Не удалось установить зависимости. Проверьте подключение к интернету.
    pause
    exit /b 1
  )
)

echo.
echo   ==========================================================
echo.
echo     Сайт:   http://localhost:3000
echo     Панель: http://localhost:3000/admin
echo             логин admin, пароль teplo2026
echo.
echo   ==========================================================
echo.
echo   Браузер откроется сам. Чтобы остановить сайт, закройте это окно.
echo.

start "" http://localhost:3000
node server.js

echo.
echo   Сайт остановлен.
pause
