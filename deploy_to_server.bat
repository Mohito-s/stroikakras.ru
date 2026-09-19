@echo off
chcp 65001 > nul
echo ====================================================
echo  Деплой сайта stroikakras.ru (GitHub -> VPS)
echo ====================================================

echo [1/2] Отправка изменений в GitHub...
git add .
git commit -m "Update site"
git push origin main

echo [2/2] Синхронизация на сервере VPS...
ssh -p 1993 roman@213.21.240.231 "cd /var/www/stroikakras.ru && git pull"

echo.
echo ====================================================
echo  Успешно! Сайт обновлен: https://stroikakras.ru/
echo ====================================================
pause
