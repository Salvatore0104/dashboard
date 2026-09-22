# 2026-09-22 生产发布

用户完成本地验收并授权更新现有 Docker。发布代码 main `52b534a`（业务合并 `00a55d3`，附加容器打包修复）。

- 入口：https://wowidea.top/kaoqin/
- 后台：https://wowidea.top/kaoqin/admin.html
- 容器：claw-dashboard；镜像 claw-dashboard:52b534a。
- 镜像 ID：sha256:1b96453329deb6ae84f842a9810f92839e1239af4eb37bc12eff45ad08663927。
- 代码目录：/root/dashboard-releases/52b534a；容器工作目录 /opt/dashboard，隔离基础镜像自带 /app/app。
- 监听保持 127.0.0.1:5000；Nginx 未改动、未重载。配置哈希 259f339c6806886c0d8dba0a1f8c1255e8f1133110fdd25b59762f1024112615。
- 数据继续使用 /data/claw/claw.db。凭据加密密钥路径 /data/claw/.easyai-config.key，在首次保存时生成并随数据挂载持久化。本地数据库、环境文件、日志和密钥未打入镜像。
- EASYAI_SYNC_MODE=real，EASYAI_SYNC_ENABLED=true，SYNC_SCHEDULER_ENABLED=false，TZ=Asia/Shanghai。未导入本地测试凭据、测试项目或绑定记录。
- 原有钉钉配置保留；wowidea 管理账号待上线后由管理员在系统配置填写。组织定时同步保持关闭。

## 验证

镜像内 56 项测试通过。使用生产库副本验证迁移，8 个项目、23 名人员、62 条分配、27 项配置均保留，SQLite integrity_check=ok。上线再次验证项目/人员/分配计数和数据库完整性。

容器 running/healthy。公网 health、后台、前台、TV、API 和静态文件均 200；SSE 响应为 text/event-stream。admin.js、board.js、styles.css 公网内容与发布源码一致。

浏览器验证后台活动项目 1 项、默认折叠归档 7 项，凭据区默认隐藏；前台与 TV 正常显示现有项目。其他运行容器 ID 与发布前相同。

## 备份与回滚

服务器备份目录 /root/dashboard-backups/20260922-55588ef（目录权限 700）。
包含停机前 SQLite 在线备份 claw.db、切换时最终备份 claw-final.db、旧容器配置 container-inspect.json、反代配置副本、构建日志。

旧容器 claw-dashboard-rollback-20260922 已停止且 restart=no，避免服务器重启时抢占端口。旧镜像 claw-dashboard:rollback-20260922 保留。

需要回滚应用时：停止新容器，将其改为其他名称；把旧容器改名回 claw-dashboard，恢复 restart=always 后启动。新迁移为新增表/列，不直接覆盖生产数据。如需恢复数据库，必须先保存最新数据库并核对上线后的新增数据，再使用 claw-final.db；不得无条件覆盖。无需修改 Nginx。

没有修改 EasyAI 平台代码、计费配置或现有组织，没有执行平台组织同步。部署只完成产品上线，凭据配置及正式同步属于后续运营操作。
