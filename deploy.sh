#!/bin/bash
#
# Claw Dashboard 一键部署脚本
# 用于在 Linux 服务器上快速部署 Claw Dashboard
#

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 配置
APP_DIR="/var/www/claw-dashboard"
SERVICE_NAME="claw-dashboard"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
LOG_DIR="/var/log/claw-dashboard"

echo_step() {
    echo -e "${GREEN}[Step]${NC} $1"
}

echo_warn() {
    echo -e "${YELLOW}[Warn]${NC} $1"
}

echo_error() {
    echo -e "${RED}[Error]${NC} $1"
}

# 检查是否为 root 用户
check_root() {
    if [[ $EUID -ne 0 ]]; then
        echo_error "请使用 root 用户运行此脚本"
        echo "提示: sudo bash deploy.sh"
        exit 1
    fi
}

# 安装依赖
install_dependencies() {
    echo_step "安装系统依赖..."

    # 检测包管理器
    if command -v apt-get &> /dev/null; then
        apt-get update
        apt-get install -y python3 python3-pip
    elif command -v yum &> /dev/null; then
        yum install -y python3 python3-pip
    elif command -v dnf &> /dev/null; then
        dnf install -y python3 python3-pip
    else
        echo_error "不支持的包管理器"
        exit 1
    fi

    echo_step "安装 Python 依赖..."
    pip3 install --break-system-packages flask flask-cors python-dotenv requests

    echo -e "${GREEN}依赖安装完成${NC}"
}

# 创建目录
create_directories() {
    echo_step "创建目录..."
    mkdir -p ${APP_DIR}
    mkdir -p ${LOG_DIR}
    echo -e "${GREEN}目录创建完成${NC}"
}

# 下载最新代码
download_code() {
    echo_step "下载最新代码..."

    # 如果是从 GitHub 下载
    if [[ -n "$GITHUB_REPO" ]]; then
        echo "从 GitHub 下载: $GITHUB_REPO"
        if command -v git &> /dev/null; then
            cd /tmp
            rm -rf claw-dashboard-temp
            git clone $GITHUB_REPO claw-dashboard-temp
            cp -r claw-dashboard-temp/* ${APP_DIR}/
            rm -rf claw-dashboard-temp
        else
            echo_warn "Git 未安装，跳过代码下载"
        fi
    else
        echo_warn "未设置 GITHUB_REPO 环境变量，请手动上传代码到 ${APP_DIR}"
    fi

    echo -e "${GREEN}代码准备完成${NC}"
}

# 创建 systemd 服务
create_service() {
    echo_step "创建 systemd 服务..."

    cat > ${SERVICE_FILE} << 'EOF'
[Unit]
Description=Claw Dashboard - Gantt Chart Visualization
Documentation=https://github.com/Salvatore0104/dashboard
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
EOF

    echo -e "${GREEN}服务文件创建完成${NC}"
}

# 配置权限
set_permissions() {
    echo_step "设置权限..."
    chmod +x ${APP_DIR}/app.py
    chmod 644 ${APP_FILE}
    echo -e "${GREEN}权限设置完成${NC}"
}

# 启动服务
start_service() {
    echo_step "启动服务..."

    systemctl daemon-reload
    systemctl enable ${SERVICE_NAME}
    systemctl restart ${SERVICE_NAME}

    sleep 2

    if systemctl is-active --quiet ${SERVICE_NAME}; then
        echo -e "${GREEN}服务启动成功！${NC}"
    else
        echo_error "服务启动失败，请检查日志:"
        echo "  journalctl -u ${SERVICE_NAME} -n 20"
        exit 1
    fi
}

# 显示服务状态
show_status() {
    echo ""
    echo "========================================"
    echo -e "${GREEN}部署完成！${NC}"
    echo "========================================"
    echo ""
    echo "访问地址:"
    echo "  http://$(hostname -I | awk '{print $1}'):5000"
    echo "  http://localhost:5000"
    echo ""
    echo "管理页面:"
    echo "  http://$(hostname -I | awk '{print $1}'):5000/admin.html"
    echo ""
    echo "常用命令:"
    echo "  查看状态: systemctl status ${SERVICE_NAME}"
    echo "  重启服务: systemctl restart ${SERVICE_NAME}"
    echo "  查看日志: journalctl -u ${SERVICE_NAME} -f"
    echo ""
}

# 主函数
main() {
    echo ""
    echo "========================================"
    echo "  Claw Dashboard 一键部署脚本"
    echo "========================================"
    echo ""

    check_root
    install_dependencies
    create_directories
    download_code
    create_service
    set_permissions
    start_service
    show_status
}

# 运行主函数
main "$@"
