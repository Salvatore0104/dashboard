@echo off
echo Qq23525130@
echo y | plink -P 48655 -batch root@192.168.5.2 "cd /root/claw-dashboard && git pull && docker build -t claw-dashboard:latest . && docker stop claw-dashboard && docker rm claw-dashboard && docker run -d --name claw-dashboard -p 5000:5000 --restart=always claw-dashboard:latest python app.py"
pause
