@echo off
echo Qq23525130@
echo y | plink -P 48655 -batch root@192.168.5.2 "cd /root/claw-dashboard && git pull && docker build -t claw-dashboard:latest . && docker stop claw-dashboard 2>/dev/null; docker rm claw-dashboard 2>/dev/null; docker run -d --name claw-dashboard -p 5000:5000 -v /data/claw:/data/claw --restart=always claw-dashboard:latest"
pause
