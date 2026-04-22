#!/bin/bash
#
# Claw Dashboard Docker 打包脚本
# 使用: bash build-docker.sh
#

set -e

IMAGE_NAME="claw-dashboard"
TAG="latest"
OUTPUT="/home/${IMAGE_NAME}.tar"

echo "[步骤1/三] 正在构建 Docker 镜像 ${IMAGE_NAME}:${TAG} ..."
docker build -t "${IMAGE_NAME}:${TAG}" .

echo ""
echo "[步骤2/三] 正在保存镜像到 ${OUTPUT} ..."
docker save -o "${OUTPUT}" "${IMAGE_NAME}:${TAG}"

echo ""
echo "[步骤3/三] 完成！"
echo ""
echo "========================================"
echo "  镜像已保存到: ${OUTPUT}"
echo "========================================"
echo ""
echo "导出文件大小: $(du -h ${OUTPUT} | cut -f1)"
echo ""
echo "在目标服务器导入:"
echo "  docker load -i ${OUTPUT}"
echo ""
echo "运行容器:"
echo "  docker run -d \\"
echo "    -p 5000:5000 \\"
echo "    -v /data/claw:/data \\"
echo "    --name claw-dashboard \\"
echo "    ${IMAGE_NAME}:${TAG}"
echo ""
