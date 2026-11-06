@echo off
title Gatti Leituras - Leitor Inteligente de Livros
echo =======================================================
echo             GATTI LEITURAS (Edge Neural)
echo =======================================================
echo.
echo [1/3] Verificando e instalando pacotes necessarios...
python -m pip install -r requirements.txt --quiet --disable-pip-version-check
echo.
echo [2/3] Gerando link publico para celular e tablet...
start cmd /k "title Tunel Celular - Gatti Leituras && echo Copie o link abaixo e abra no celular: && npx -y localtunnel --port 8000"
echo.
echo [3/3] Abrindo aplicacao no PC...
start http://localhost:8000
echo.
python main.py
pause
