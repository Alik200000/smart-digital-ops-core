@echo off
title Smart Digital Group - Ops & Profit Core
echo ======================================================
echo   Smart Digital Group - Ops & Profit Intelligence Core
echo   AI Automation & Systems Operations Core
echo ======================================================
echo.
echo [1/2] Zapusk servera na http://localhost:3000 ...
start "" "http://localhost:3000"
echo.
echo [2/2] Node.js backend startuet...
node server.js
pause
