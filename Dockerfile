# Claw Dashboard - Docker Image
FROM python:3.11-slim

WORKDIR /app

# 安装依赖（先复制 requirements 以利用缓存层）
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制应用代码
COPY app.py .
COPY static/ ./static/

# 创建数据库目录（SQLite 数据库运行时生成，可挂载持久化）
RUN mkdir -p /data
ENV DB_PATH=/data/claw.db

# 暴露端口
EXPOSE 5000

# 启动应用
CMD ["python", "app.py"]
