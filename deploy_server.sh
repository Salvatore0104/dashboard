#!/bin/bash
# Claw Dashboard 部署脚本
# 在服务器上执行此脚本

set -e

echo "========== Claw Dashboard 部署脚本 =========="

# 1. 拉取最新代码
echo "[1/5] 拉取最新代码..."
cd /data/claw
git pull

# 2. 构建 Docker 镜像
echo "[2/5] 构建 Docker 镜像..."
docker build -t claw-dashboard:latest .

# 3. 停止并删除旧容器（如果存在）
echo "[3/5] 停止旧容器..."
docker stop claw-dashboard 2>/dev/null || true
docker rm claw-dashboard 2>/dev/null || true

# 4. 启动新容器（使用外部数据库）
echo "[4/5] 启动新容器..."
docker run -d \
  --name claw-dashboard \
  -p 5000:5000 \
  --restart=always \
  -v /data/claw:/data/claw \
  -e DB_PATH=/data/claw/claw.db \
  claw-dashboard:latest \
  python app.py

# 5. 验证
echo "[5/5] 验证部署..."
sleep 2
docker ps | grep claw-dashboard

echo ""
echo "========== 部署完成 =========="
echo "访问地址: http://服务器IP:5000"
echo "数据库:   /data/claw/claw.db (已保留)"
