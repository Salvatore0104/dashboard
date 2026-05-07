FROM python:3.11-slim

WORKDIR /app

# 安装依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制应用代码
COPY . .

# 暴露端口
EXPOSE 5000

# 设置环境变量
ENV DB_PATH=/data/claw/claw.db

# 创建数据目录
RUN mkdir -p /data/claw

# 启动命令 - 使用外部数据库
CMD ["python", "app.py"]
