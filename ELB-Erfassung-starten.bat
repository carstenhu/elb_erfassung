@echo off
setlocal

cd /d "C:\ELB_Erfassung"

if not exist "node_modules" (
  echo Installiere Abhaengigkeiten...
  call npm install
)

start "" cmd /c "timeout /t 4 >nul && start http://localhost:5173"
call npm run desktop:dev
