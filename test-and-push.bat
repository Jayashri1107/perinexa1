@echo off
setlocal EnableExtensions
title Perinexa - test, build, commit and push
cd /d "%~dp0"
set "LOG=%~dp0test-and-push.log"

echo.
echo   Perinexa: test, build, commit and push
echo   ======================================
echo   1. runs all the tests   - about 10 to 20 minutes
echo   2. builds the website
echo   3. commits all the changes
echo   4. pushes to GitHub: master and main
echo.
echo   If a step fails, it stops and nothing is pushed.
echo   MongoDB must be running. You can leave "npm run dev" open.
echo.
pause

for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD') do set "BRANCH=%%b"
if /i not "%BRANCH%"=="master" goto :wrongbranch

echo.
echo   Step 1 of 4: the tests are running.
echo   This window stays still for many minutes. That is normal. Please wait...
echo ==== npm test ==== > "%LOG%"
call npm test >> "%LOG%" 2>&1
if errorlevel 1 goto :testsfailed
echo   Tests passed.

echo.
echo   Step 2 of 4: building the website...
echo ==== npm run build ==== >> "%LOG%"
call npm run build >> "%LOG%" 2>&1
if errorlevel 1 goto :buildfailed
echo   Build passed.

echo.
echo   Step 3 of 4: commit...
echo ==== git ==== >> "%LOG%"
git add -A -- . ":(exclude)test-and-push.bat" >> "%LOG%" 2>&1
if errorlevel 1 goto :commitfailed
git diff --cached --quiet
if not errorlevel 1 goto :nothingnew
git status --short >> "%LOG%" 2>&1
git commit -q -m "Payroll: accounts login, staff, attendance file, deductions, advances, lock, payslips, lists" --trailer "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>" --trailer "Claude-Session: https://claude.ai/code/session_011oukXPBd73Gxo8Y1KnXWGJ" >> "%LOG%" 2>&1
if not errorlevel 1 goto :committed
rem An older Git does not know --trailer: once more, without it
git commit -q -m "Payroll: accounts login, staff, attendance file, deductions, advances, lock, payslips, lists" >> "%LOG%" 2>&1
if errorlevel 1 goto :commitfailed
:committed
echo   Committed.
goto :push

:nothingnew
echo   Nothing new to commit - going on to the push.

:push
echo.
echo   Step 4 of 4: push to GitHub. If a sign-in window opens, sign in.
git push origin master
if errorlevel 1 goto :pushfailed
git push origin master:main
if errorlevel 1 goto :pushfailed

echo.
echo   DONE. The code is on GitHub: master and main.
echo.
echo   To deploy:
echo   1. GitHub - Actions - wait for the green tick on main.
echo   2. On the server, once only: add PAYROLL_KEY to server/.env - see docs/RUNBOOK.md.
echo   3. On the server:  sudo /opt/perinexa/app/deploy/deploy.sh
goto :end

:wrongbranch
echo.
echo   STOPPED: this folder is on the branch "%BRANCH%", not on master.
echo   Nothing was changed. Tell Claude this line.
goto :end

:testsfailed
echo.
echo   TESTS FAILED. Nothing was committed. Nothing was pushed.
echo   The last lines of the log:
echo.
powershell -NoProfile -Command "Get-Content -Tail 30 -LiteralPath '%LOG%'"
echo.
echo   Tell Claude: "tests failed, read the log".
goto :end

:buildfailed
echo.
echo   BUILD FAILED. Nothing was committed. Nothing was pushed.
echo.
powershell -NoProfile -Command "Get-Content -Tail 30 -LiteralPath '%LOG%'"
echo.
echo   Tell Claude: "build failed, read the log".
goto :end

:commitfailed
echo.
echo   COMMIT FAILED. Nothing was pushed.
echo.
powershell -NoProfile -Command "Get-Content -Tail 20 -LiteralPath '%LOG%'"
echo.
echo   Tell Claude: "commit failed, read the log".
goto :end

:pushfailed
echo.
echo   PUSH FAILED. The commit is saved on this laptop, but GitHub does not have it.
echo   Check the internet and your GitHub sign-in, then double-click this file again.
goto :end

:end
echo.
pause
endlocal
