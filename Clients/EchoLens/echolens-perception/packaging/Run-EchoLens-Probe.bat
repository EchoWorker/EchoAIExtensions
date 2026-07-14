@echo off
REM EchoLens Perception Probe -- double-click launcher.
REM Keeps the console window open so you can read the output.
title EchoLens Perception Probe
echolens-probe.exe %*
echo.
echo (window stays open -- close it when you're done)
pause >nul
