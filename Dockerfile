FROM registry.cn-shanghai.aliyuncs.com/easyaigc/sandbox:latest

WORKDIR /opt/dashboard

# 安装依赖
COPY requirements.txt .
ARG PIP_INDEX_URL=https://pypi.org/simple
RUN pip install --no-cache-dir -r requirements.txt

# 复制应用代码
COPY . .

# 暴露端口
EXPOSE 5000

# 设置环境变量
ENV DB_PATH=/data/claw/claw.db
ENV EASYAI_CONFIG_KEY_FILE=/data/claw/.easyai-config.key

# 创建数据目录
RUN mkdir -p /data/claw

# 启动命令 - 使用外部数据库
ENTRYPOINT ["python"]
CMD ["app.py"]
