@echo off
REM 一键部署脚本（需先配置 SSH key 到服务器，或手动输入密码）
REM 使用方法: 将下方 YOUR_SERVER_IP、YOUR_SSH_PORT、YOUR_USER 替换为实际值
REM
REM set SERVER=YOUR_SERVER_IP
REM set PORT=YOUR_SSH_PORT
REM set USER=YOUR_USER
REM set PROJECT_DIR=/root/claw-dashboard
REM
REM echo y | plink -P %PORT% -batch %USER%@%SERVER% "cd %PROJECT_DIR% && git pull && docker build -t claw-dashboard:latest . && docker stop claw-dashboard 2>/dev/null; docker rm claw-dashboard 2>/dev/null; docker run -d --name claw-dashboard -p 5000:5000 -v /data/claw:/data/claw --restart=always claw-dashboard:latest"
REM pause

echo 请先编辑此文件，将 YOUR_SERVER_IP、YOUR_SSH_PORT、YOUR_USER 替换为实际服务器信息
pause
