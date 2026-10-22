@echo off
rem The `tylia` command; the installer puts this folder on PATH (docs/ARCHITECTURE.md §5.19).
rem tylia.exe is a GUI program, which Windows doesn't give a console: paths start it without
rem waiting, and options (--help, --version) run it with its output piped to this console.
setlocal
set "TYLIA_EXE=%~dp0..\tylia.exe"
set "FIRST=%~1"
if "%FIRST:~0,1%"=="-" (
  "%TYLIA_EXE%" %* 2>&1 | findstr "^"
  exit /b
)
start "" "%TYLIA_EXE%" %*
