@echo off
chcp 65001 > nul
echo ====================================================
echo  Запуск локального сервера для проверки сайта
echo ====================================================
echo.
echo Сайт доступен по адресу: http://localhost:8085/
echo Админка доступна по адресу: http://localhost:8085/admin.html
echo.
start http://localhost:8085/
python -m http.server 8085
