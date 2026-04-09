# Claw Dashboard

项目排期甘特图看板

## 最近更新

- 修复请假信息悬浮提示，显示完整日期范围
- 移除重复图标，优化界面显示
- 简化删除模式操作
- 移除多选拖拽功能，保留单条拖拽调整

## 功能

- 甘特图可视化项目进度
- 拖拽分配人员到项目
- 拖拽时高亮显示（黄色=已有条，红色=无该项目）
- 请假/出差状态显示
- 电视看板大屏展示
- SQLite本地数据库 + SSE实时更新

## 项目结构

```
claw-dashboard/
├── app.py                 # Flask 后端主程序
│   ├── /api/projects      # 项目管理 API
│   ├── /api/persons       # 人员管理 API
│   ├── /api/assignments   # 分配管理 API
│   ├── /api/config        # 配置管理 API
│   ├── /api/events        # SSE 实时事件推送
│   └── /api/dingtalk      # 钉钉集成 API
│
├── static/                # 静态资源目录
│   ├── index.html         # 首页（导航页面）
│   ├── dashboard.html     # 甘特图看板主页面
│   ├── admin.html         # 后台管理页面
│   └── tv.html            # 电视大屏展示页面
│
├── requirements.txt       # Python 依赖列表
├── README.md              # 项目说明文档
├── .gitignore             # Git 忽略规则
├── claw.db                # SQLite 数据库文件（运行时生成）
│
└── deploy.sh              # 一键部署脚本（服务器用）
```

## 快速开始

### 本地开发

```bash
# 克隆项目
git clone https://github.com/Salvatore0104/dashboard.git
cd dashboard

# 安装依赖
pip install flask flask-cors python-dotenv requests

# 启动服务
python app.py
```

访问 http://localhost:5000

### 页面说明

| 页面 | 地址 | 说明 |
|------|------|------|
| 首页 | / | 导航入口 |
| 看板 | /dashboard.html | 甘特图主页面，拖拽分配人员 |
| 管理 | /admin.html | 管理项目、人员、请假配置 |
| 电视 | /tv.html | 大屏展示模式 |

## 服务器部署

### 方式一：一键部署（推荐）

1. 在服务器上下载并运行部署脚本：
```bash
# 下载部署脚本
curl -O https://raw.githubusercontent.com/Salvatore0104/dashboard/main/deploy.sh
chmod +x deploy.sh

# 运行部署（需要 root 权限）
sudo bash deploy.sh
```

2. 如需从 GitHub 自动拉取代码：
```bash
GITHUB_REPO=https://github.com/Salvatore0104/dashboard.git sudo bash deploy.sh
```

### 方式二：手动部署

1. 上传项目到服务器：
```bash
scp -r ./claw-dashboard root@your-server:/var/www/
```

2. 在服务器上安装依赖：
```bash
cd /var/www/claw-dashboard
pip3 install --break-system-packages flask flask-cors python-dotenv requests
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

# 查看实时日志
journalctl -u claw-dashboard --no-pager -f

# 查看访问日志
tail -f /var/log/claw-dashboard/access.log

# 查看错误日志
tail -f /var/log/claw-dashboard/error.log
```

## 配置

### 环境变量

可在 `.env` 文件中配置：

```env
PORT=5000
DINGTALK_APP_KEY=your_app_key
DINGTALK_APP_SECRET=your_app_secret
```

### 数据库

数据库文件 `claw.db` 位于项目目录，包含：
- 项目信息
- 人员信息
- 项目分配记录
- 请假配置
- 系统设置

备份时请包含此文件。

## API 接口

| 接口 | 方法 | 说明 |
|------|------|------|
| /api/projects | GET/POST | 项目列表/创建项目 |
| /api/projects/:id | PUT/DELETE | 更新/删除项目 |
| /api/persons | GET/POST | 人员列表/创建人员 |
| /api/assignments | GET/POST | 分配列表/创建分配 |
| /api/config | GET/PUT | 配置获取/更新 |
| /api/events | GET | SSE 实时事件流 |
