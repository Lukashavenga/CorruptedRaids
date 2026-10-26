@echo off
rem Starts Corrupted Raids for a stream. Double-click it.
rem
rem All this file does is make sure there is something to run - Node, and the
rem two installs - and hand over to scripts\start-stream.ts, which has the rest
rem and says why. It stays open on a failure so the reason can be read.
title Corrupted Raids
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get the LTS from https://nodejs.org and run this again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo First run: installing the game...
  call npm.cmd install
  if errorlevel 1 goto failed
)
rem From inside web\, not with --prefix: run from the root, npm takes the root
rem package for something to install and writes "dungeon-engine": "file:.."
rem into web\package.json, which then shows as a change nobody made.
if not exist web\node_modules (
  echo First run: installing the web pages...
  pushd web
  call npm.cmd install
  if errorlevel 1 (
    popd
    goto failed
  )
  popd
)

call npm.cmd run --silent stream
if errorlevel 1 goto failed
exit /b 0

:failed
echo.
echo Corrupted Raids did not start. The reason is above.
pause
exit /b 1
