@echo off
chcp 65001 >nul
cd /d "%~dp0"

if exist ".venv\Scripts\python.exe" (
    echo 가상환경(.venv) 사용
    ".venv\Scripts\python.exe" -m pip install -q -r requirements.txt
    if errorlevel 1 goto :err
    ".venv\Scripts\python.exe" -m streamlit run app.py
) else (
    echo 시스템 Python 사용 (처음이면 .venv 만드는 걸 권장합니다)
    python -m pip install -q -r requirements.txt
    if errorlevel 1 goto :err
    python -m streamlit run app.py
)
goto :eof

:err
echo.
echo 실패: Python이 PATH에 있는지 확인하세요. https://www.python.org/downloads/
pause
exit /b 1
