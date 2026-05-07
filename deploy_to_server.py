import paramiko
import time

host = '192.168.5.2'
port = 48655
username = 'root'
password = 'Qq23525130@'

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
