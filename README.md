# Claw Dashboard

项目排期甘特图看板

## 功能

- 甘特图可视化项目进度
- 拖拽分配人员到项目
- 拖拽时高亮显示（黄色=已有条，红色=无该项目）
- 请假/出差状态显示
- 电视看板大屏展示
- SQLite本地数据库 + SSE实时更新

## 快速开始

```bash
# 安装依赖
pip install flask flask-cors python-dotenv requests

# 启动服务
python app.py
```

访问 http://localhost:5000

## 项目结构

```
├── app.py          # Flask 后端
├── static/         # 静态页面
│   ├── index.html      # 首页
│   ├── dashboard.html   # 甘特图看板
│   ├── admin.html      # 后台管理
│   └── tv.html         # 电视看板
└── claw.db        # SQLite 数据库
```

## 页面说明

| 页面 | 地址 | 说明 |
|------|------|------|
| 首页 | / | 导航 |
| 看板 | /dashboard.html | 甘特图主页 |
| 管理 | /admin.html | 管理项目人员 |
| 电视 | /tv.html | 大屏展示 |

## 配置

编辑 `.env` 文件：

```env
PORT=5000
DINGTALK_APP_KEY=your_key
DINGTALK_APP_SECRET=your_secret
```

## 服务器部署

### 部署到 Linux 服务器

1. 上传项目文件到服务器：
```bash
scp -r ./claw-dashboard root@your-server:/var/www/
```

2. 在服务器上安装依赖：
```bash
cd /var/www/claw-dashboard
pip3 install --break-system-packages flask flask-cors python-dotenv
```

3. 创建 systemd 服务文件 `/etc/systemd/system/claw-dashboard.service`：
```ini
[Unit]
Description=Claw Dashboard - Gantt Chart Visualization
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/var/www/claw-dashboard
Environment="FLASK_ENV=production"
ExecStart=/usr/bin/python3 /var/www/claw-dashboard/app.py
Restart=always
RestartSec=5

StandardOutput=append:/var/log/claw-dashboard/access.log
StandardError=append:/var/log/claw-dashboard/error.log

[Install]
WantedBy=multi-user.target
```

4. 启用并启动服务：
```bash
systemctl daemon-reload
systemctl enable claw-dashboard
systemctl start claw-dashboard
```

### 服务器常用命令

```bash
# 查看服务状态
systemctl status claw-dashboard

# 重启服务
systemctl restart claw-dashboard

# 停止服务
systemctl stop claw-dashboard

# 启动服务
systemctl start claw-dashboard

# 查看日志
journalctl -u claw-dashboard --no-pager -f

# 查看访问日志
tail -f /var/log/claw-dashboard/access.log

# 查看错误日志
tail -f /var/log/claw-dashboard/error.log
```

### 注意事项

- **不要删除系统Python环境的虚拟环境**：如果项目需要虚拟环境，使用项目目录下的 `.venv`，并相应修改 systemd 服务中的 `ExecStart` 路径
- 确保日志目录存在：`mkdir -p /var/log/claw-dashboard`
- 数据库文件 `claw.db` 包含所有数据，备份时记得包含此文件
