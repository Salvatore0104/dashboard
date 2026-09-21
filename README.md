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

### Docker 部署（推荐）

**前提条件**：服务器已安装 Docker。

#### 初次部署

```bash
# 1. 克隆项目
git clone https://github.com/Salvatore0104/dashboard.git /root/claw-dashboard
cd /root/claw-dashboard

# 2. 构建镜像
docker build -t claw-dashboard:latest .

# 3. 启动容器（挂载 /data/claw 持久化数据库）
docker run -d \
  --name claw-dashboard \
  -p 5000:5000 \
  -v /data/claw:/data/claw \
  --restart=always \
  claw-dashboard:latest
```

#### 更新部署

```bash
cd /root/claw-dashboard
git pull
docker build -t claw-dashboard:latest .
docker stop claw-dashboard
docker rm claw-dashboard
docker run -d \
  --name claw-dashboard \
  -p 5000:5000 \
  -v /data/claw:/data/claw \
  --restart=always \
  claw-dashboard:latest
```

也可以直接运行服务器上的 `deploy.sh` 一键更新：

```bash
cd /root/claw-dashboard && bash deploy.sh
```

#### Docker 常用命令

```bash
# 查看容器状态
docker ps --filter name=claw-dashboard

# 查看日志
docker logs -f --tail=50 claw-dashboard

# 停止容器
docker stop claw-dashboard

# 重启容器
docker restart claw-dashboard
```

### 手动部署（不使用 Docker）

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

## 本地项目组织同步

项目组织同步默认使用安全的 `mock` 模式，不会写入 wowidea.top。复制 `.env.local.example` 为 `.env.local` 后启动：

```powershell
python -m venv .venv
.\\.venv\\Scripts\\Activate.ps1
pip install -r requirements.txt
python app.py
```

后台项目列表中的“同步组织”按钮会创建本地测试组织绑定、生成同步预览并记录同步日志。默认定时任务关闭；需要验证 10 分钟调度时设置 `SYNC_SCHEDULER_ENABLED=true`。

真实 API 联调必须先撤销曾在聊天或其他不安全位置暴露的旧 Key，再将新 Key 通过本地环境变量提供，并显式设置 `EASYAI_SYNC_MODE=real`。真实模式会调用线上管理 API，所有组织名称会带 `[TEST][dashboard-local]` 前缀。

后台系统配置也支持填写 wowidea.top 管理 Key。Key 会在后端加密保存，页面只显示末四位脱敏摘要；建议生产环境设置 `EASYAI_CONFIG_ENCRYPTION_KEY`，本地未设置时会生成被 `.gitignore` 忽略的本地加密密钥文件。

新增接口：

- `GET /api/project-sync/:projectId/status`：项目组织绑定和最近运行记录
- `POST /api/project-sync/:projectId/preview`：生成成员匹配预览
- `POST /api/project-sync/:projectId/run`：执行一次同步
- `GET /api/project-sync/runs`：查看同步运行记录
- `GET /api/project-sync/identities`：查看身份匹配记录
- `POST /api/project-sync/identities/:userId/confirm`：人工确认 EasyAI 用户关联

项目同步只按钉钉 `userid/unionid` 匹配既有 EasyAI 用户，不再按姓名兜底，也不会创建 EasyAI 账号。预览接口为只读；正式同步会先写入身份映射，再通过追加组织成员接口加入组织，不会替换用户已有组织关系。真实环境还必须显式设置 `EASYAI_DINGTALK_BIND_PATH`（例如部署提供的用户身份绑定接口路径，支持 `{user_id}` 占位符）；未设置时会拒绝写入，避免误调用会自动注册账号的钉钉同步接口。
