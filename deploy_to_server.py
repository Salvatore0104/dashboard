import paramiko
import os

# 从环境变量读取服务器信息，避免硬编码敏感数据
host = os.environ.get('DEPLOY_HOST', 'YOUR_SERVER_IP')
port = int(os.environ.get('DEPLOY_PORT', '22'))
username = os.environ.get('DEPLOY_USER', 'root')
password = os.environ.get('DEPLOY_PASSWORD', '')

if not password or host == 'YOUR_SERVER_IP':
    print("请设置环境变量 DEPLOY_HOST, DEPLOY_PORT, DEPLOY_USER, DEPLOY_PASSWORD")
    print("示例: set DEPLOY_HOST=192.168.x.x")
    exit(1)

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

print(f"连接 {host}:{port}...")
client.connect(host, port=port, username=username, password=password)

# 查找项目目录
print("查找项目目录...")
stdin, stdout, stderr = client.exec_command('find / -name "app.py" -type f 2>/dev/null | head -5')
output = stdout.read().decode()
print(f"找到: {output}")

# 查找 Dockerfile
stdin, stdout, stderr = client.exec_command('find / -name "Dockerfile" -type f 2>/dev/null | head -5')
output = stdout.read().decode()
print(f"Dockerfile: {output}")

client.close()
