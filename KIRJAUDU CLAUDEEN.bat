@echo off
title Kirjaudu Claudeen
echo.
echo   Taman avulla laskurin tekoalyanalyysi kayttaa omaa Claude-tiliasi.
echo   Kirjaudu selaimessa normaalilla Claude-tunnuksellasi. Kun kirjautuminen
echo   on valmis, kirjoita /exit tai sulje tama ikkuna.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$c = Get-Command claude.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source; if (-not $c) { $p = Join-Path $env:USERPROFILE '.local\bin\claude.exe'; if (Test-Path $p) { $c = $p } }; if (-not $c) { $c = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Claude-Data\*\claude-code\*\*\claude.exe') -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName }; if (-not $c) { Write-Host 'Claudea ei loytynyt tasta koneesta.'; exit 1 }; Set-Location $env:USERPROFILE; & $c"
pause
