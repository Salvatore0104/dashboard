# Claw Dashboard

项目排期、人员分配、请假与出差展示，以及 EasyAI 项目组织同步。

## 当前发布

2026-09-22：权限升级与归档同步调整已上线，用户确认验收通过。生产运行代码为 `0110182`；后续文档提交不改变生产代码。完整隔离测试 68 项通过。

- [正式入口](https://wowidea.top/kaoqin/)
- [主站嵌入页面](https://wowidea.top/custom/kaoqin)
- [匿名 TV 看板](https://wowidea.top/kaoqin/tv.html)
- [发布、验证与回滚记录](docs/access-production-release-20260922.md)

## 页面与权限

| 页面 | 路径 | 访问范围 |
| --- | --- | --- |
| 导航首页 | `/` | 公开入口 |
| TV 看板 | `/tv.html` | 匿名及所有用户可看 |
| 前台编辑看板 | `/dashboard.html` | 角色数组包含 `operator`、`manager` 或 `admin` |
| 后台管理 | `/admin.html` | 同上 |

普通用户仍能看到入口，进入受限页面后显示无权限并可返回 TV。看板复用主站当前访问令牌；登录、退出和令牌续期由主站负责，看板不提供独立登录或续期流程。

后端逐请求调用平台身份接口验证访问者，不信任客户端角色，不使用系统同步凭据代替访问者。缺失或失效身份返回 401，角色不足返回 403，上游验证异常返回 503 并拒绝操作。静态空壳公开，业务数据和操作由后端保护，CSV/JSON 导出也需认证。

TV 保留原布局、项目、人员、请假类型与日期，使用展示字段白名单，过滤隐藏人员及关联排期。SSE 仅发送失效通知，主题缓存只保存展示字段。详情见[权限方案](docs/access-control-plan.md)。

## 功能与组织同步

- 甘特图排期、拖拽分配与调整、人员分组、请假及出差提示。
- TV 只读展示、实时更新、JSON/CSV 导出。
- 钉钉人员及请假同步，既有 EasyAI 用户身份匹配、人工确认和审计。
- 项目组织单次同步、全局预览/同步、日志和可配置小时调度。
- 管理凭据加密保存；访问者身份与同步管理身份分离。

项目结束日期早于服务器当天时归档；当天、未来或无结束日期的项目继续参与同步。生产时区为 `Asia/Shanghai`。

- 归档项目退出手动、全局、定时同步和一致性核对，现有组织及成员原样保留，不因归档清空成员。
- 归档项目仍可本地编辑；名称和日期描述修改不写入平台。延期至未归档范围后重新参与同步。
- 未归档项目中离开或排期到期的托管成员仍按原规则处理。
- 显式删除项目保留平台组织，仅清理该项目托管关系；归档不等于删除。
- 组织名称使用项目名称，位于“执行项目组”下。满足唯一性、父组织和绑定约束时可复用同名组织。
- 新组织一次性初始化 `balance: 5000`、`balance_deduction_strategy: organization_first`；复用或重复同步不重置余额及扣费策略。
- 匹配既有用户，不创建平台账号，不修改登录资料、历史、个人余额或其他组织关系。

## 本地开发

```powershell
git clone https://github.com/Salvatore0104/dashboard.git
cd dashboard
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt
Copy-Item .env.local.example .env.local
.venv/Scripts/python.exe app.py
```

访问 `http://localhost:5000`。默认 mock 组织同步不会绕过页面鉴权；localhost 不会自动获得主站同源登录存储。

使用隔离数据库和模拟访问者测试管理页面：

```powershell
.venv/Scripts/python.exe -m unittest discover -q
.venv/Scripts/python.exe tests/serve_access_acceptance.py
```

验收服务仅监听 `127.0.0.1:5011`，使用临时数据、禁止真实上游请求，不启动生产调度。浏览器验收：

```powershell
npx --yes --package @playwright/cli playwright-cli -s=dashboard-access open http://127.0.0.1:5011/admin.html
npx --yes --package @playwright/cli playwright-cli -s=dashboard-access run-code --filename tests/access-browser-checks.js
```

## 配置与持久化

| 配置 | 说明 |
| --- | --- |
| `PORT` | 默认 5000 |
| `DB_PATH` | 本地默认 `claw.db`，生产 `/data/claw/claw.db` |
| `EASYAI_SYNC_MODE` | 默认 `mock`，`real` 使用真实平台管理接口 |
| `EASYAI_SYNC_ENABLED` | 组织同步能力开关 |
| `SYNC_SCHEDULER_ENABLED` | 默认关闭；后台保存的调度配置优先 |
| `EASYAI_CONFIG_KEY_FILE` | 凭据加密密钥文件，生产随 `/data/claw` 持久化 |
| `EASYAI_CONFIG_ENCRYPTION_KEY` | 可选显式加密密钥，不可提交 Git |
| `DINGTALK_APP_KEY` / `DINGTALK_APP_SECRET` | 钉钉凭据，也可在后台配置 |
| `EASYAI_DINGTALK_BIND_PATH` | 可选既有用户身份绑定接口；为空时仅保存本地映射，组织成员同步仍可执行 |

真实同步需配置正确的管理凭据并显式启用真实模式。数据库、环境文件及加密密钥不能进入 Git 或镜像；备份数据库时保留对应密钥，日志不得输出凭据。不要使用生产组织做开发测试。

## 生产部署与回滚

当前 Docker 容器名为 `claw-dashboard`，工作目录 `/opt/dashboard`，数据挂载 `/data/claw`，仅监听 `127.0.0.1:5000`，经主站 `/kaoqin/` 反代访问。反代需透传 Authorization；嵌入页需同源并允许访问主站存储。

更新流程：固定已验收提交 → 备份数据/密钥与运行配置 → 构建版本化镜像并执行隔离测试 → 保留旧容器后切换 → 验证健康、数据、权限、TV 和静态资源。不要直接删除旧容器或用未固定的 latest 覆盖回滚点。

应用回滚优先恢复旧容器并继续使用现有数据；数据库恢复需另外核对新增数据，不应自动覆盖。历史 `deploy.sh` 等脚本不代表当前生产发布流程，执行前须核对目标和备份条件。

## API 概览

以下是应用内路径，生产需加 `/kaoqin` 前缀。除两个 TV GET/HEAD 接口外，全部 `/api/` 业务接口需要有效管理角色 Bearer。

| 路径 | 方法 | 用途 |
| --- | --- | --- |
| `/api/access` | GET | 当前身份与管理能力 |
| `/api/tv/data` | GET | 公开展示数据白名单 |
| `/api/tv/events` | GET | 公开失效通知，无业务明细 |
| `/api/projects` | GET/POST | 项目读取/创建 |
| `/api/projects/:id` | PUT/DELETE | 修改/删除项目 |
| `/api/persons` | GET/POST | 人员读取/创建 |
| `/api/assignments` | GET/POST | 排期读取/创建 |
| `/api/config` | GET/POST | 配置读取/保存 |
| `/api/export`、`/api/export/assignments/csv` | GET | JSON/排期 CSV 导出 |
| `/api/project-sync/:id/preview`、`/api/project-sync/:id/run` | POST | 单项目预览/执行 |
| `/api/project-sync/global/preview`、`/api/project-sync/global/run` | POST | 全局预览/执行 |
| `/api/project-sync/schedule` | GET/POST | 调度读取/配置 |
| `/health` | GET | 非敏感健康状态 |

旧 `/api/events` 原始事件流已关闭。其余绑定、请假、同步日志等接口以 `app.py` 为准。

## 代码导航

- `app.py`：Flask API、TV 展示数据、SSE 与调度。
- `access_control.py`：后端身份校验及角色授权。
- `project_sync.py`：组织、身份匹配、归档过滤和审计。
- `static/access.js`：前端权限检查、认证请求与下载。
- `static/board.js`、`static/admin.js`：看板与管理页面。
- `test_*.py`、`tests/`：隔离测试与浏览器验收。
- `docs/`：阶段记录、权限方案、发布与回滚证据。历史规则以本 README 和最新发布记录为准。
