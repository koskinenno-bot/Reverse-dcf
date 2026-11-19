@echo off
title Nomad Terminal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0muut\palvelin.ps1"
pause
