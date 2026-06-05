#!/bin/bash
# Claw Dashboard 快速部署脚本（服务器端执行）
set -e

PROJECT_DIR="${PROJECT_DIR:-/root/claw-dashboard}"
DATA_DIR="${DATA_DIR:-/data/claw}"

echo "========== Claw Dashboard 部署 =========="
cd "$PROJECT_DIR"
echo "[1/4] 拉取最新代码..."
git pull
echo "[2/4] 构建 Docker 镜像..."
docker build -t claw-dashboard:latest .
echo "[3/4] 停止旧容器..."
docker stop claw-dashboard 2>/dev/null || true
docker rm claw-dashboard 2>/dev/null || true
echo "[4/4] 启动新容器..."
docker run -d \
  --name claw-dashboard \
  -p 5000:5000 \
  -v "$DATA_DIR:/data/claw" \
  --restart=always \
  claw-dashboard:latest
echo "========== 部署完成 =========="
docker ps --filter name=claw-dashboard
