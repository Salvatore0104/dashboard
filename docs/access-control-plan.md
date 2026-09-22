# Dashboard 权限升级：实现与验收

实施基线：`b2af8f3`；开发分支：`feat/dashboard-access-control`。

## 产品约定

仅 Dashboard 前后端改造。TV 继续匿名展示，保持布局、项目、人员、请假类型和日期。
前台编辑看板与后台管理只允许角色数组含 `operator`、`manager`、`admin` 的访问者。
其他用户仍能看到入口，进入后显示无权限并可返回 TV。
登录生命周期完全交给主站；看板不提供登录页、续期、过期登录提示或登录跳转。
身份无法验证时保持不可操作。

## 实现

- `access_control.py` 默认保护全部 `/api/` 请求，仅 GET/HEAD `/api/tv/data`、`/api/tv/events` 放行。
- 每个受保护请求固定向 `https://wowidea.top/api/auth/self` 验证访问者 Bearer；不缓存权限，不使用同步管理员凭据，不接受客户端角色。缺失/失效 401，角色不符 403，上游故障/格式异常 503。禁止跟随上游重定向。
- `GET /api/access` 只返回已验证用户 ID 和管理能力。既有手动同步、绑定、分配触发同步及删除清理审计采用验证后的身份，定时调度保留独立 scheduler 身份。
- TV 白名单保留显示字段，排除外部身份、绑定、配置状态和凭据；隐藏人员、排期和出差人员关联一致过滤。历史人员主键可能等同钉钉 ID，因此公开人员关联使用进程内 HMAC 标识；重启后重新获取整份快照即可。
- SSE 只发送 `invalidate` 与空对象，旧 `/api/events` 不再提供数据流。主题缓存保存与迁移均只保留主题展示字段。health 仅返回状态，删除全开放 CORS。
- `static/access.js` 在初始化业务前验证权限。每次请求读取当前主站 token；现代 token 存储存在时不退回旧存储中的残留 token。兼容仅有旧 `auth.user.token` 的环境。
- storage、焦点恢复、页面恢复和请求失败触发身份核对；权限失效或账号改变时清空 DOM 并重新加载空壳，销毁旧业务状态和计时器。异步响应读取后再次检查身份，避免旧账号数据回填。
- 管理页与编辑页所有 fetch 通过统一封装，CSV/JSON 使用认证请求和 Blob 下载。无刷新令牌访问，无令牌 URL。

## 本地验证（2026-09-22）

使用 `backend-ops-management` 的运维边界要求及 `playwright` 浏览器验收流程。

- 原有 56 项回归保留，新增 9 项后端安全测试，共 65 项。
- 安全测试遍历注册业务 API 的所有方法，验证匿名/普通用户在进入业务处理前被拒绝；验证角色数组、多角色、未知角色、伪造令牌、上游异常、禁用身份、审计身份、SSE、白名单和缓存头。
- `tests/serve_access_acceptance.py` 提供临时数据库与 mock 身份的本地服务，不启动调度器，明确禁止真实上游请求。
- `tests/access-browser-checks.js` 用 Playwright CLI 验证匿名空壳、普通用户拒绝、三种管理角色、导出认证、token 更新、跨页面账号切换、退出、失效身份、上游故障、TV 与旧缓存清理、同源 iframe 存储变化及不允许同源存储时拒绝访问。
- TV 截图：本地 `output/playwright/tv-access.png`（不提交构建产物）。

复现命令：

```powershell
.venv/Scripts/python.exe -m unittest discover -q
.venv/Scripts/python.exe tests/serve_access_acceptance.py
npx --yes --package @playwright/cli playwright-cli -s=dashboard-access open http://127.0.0.1:5011/admin.html
npx --yes --package @playwright/cli playwright-cli -s=dashboard-access run-code --filename tests/access-browser-checks.js
```

## 发布前尚需真实环境验收

本地模拟浏览器不是生产 iframe 验收。公开 API 文档本轮确认 `/auth/self`、`/auth/introspect` 存在，但没有响应 schema。真实 user/operator/manager 的角色数组契约沿用前次已验证结果，本轮没有重新登录这些账号；真实 admin 尚未验收。

发布前需验证真实主站 iframe 的 sandbox/同源存储、Authorization 反代透传、三个真实账号及真实 admin（若可用），并确认当前响应中的用户 ID、role 数组和 status。不得以这些验收触发生产组织同步或其他业务写入。

本轮没有生产变更、数据库迁移或生产备份。生产仍沿用之前发布；部署不包含本次授权，待明确授权后再准备当前生产版本与数据/配置备份，并记录实际回滚位置。源码回退基点为 `b2af8f3`，不能据此重置其他人的工作。

实施期间发现：初始未跟踪文件 `新建文本文档.txt` 后续只读检查已不存在。本任务没有对该文件执行读取、编辑、删除或移动，原因未确认；未伪造内容恢复。

## 追加调整：归档项目退出组织同步

按用户最新要求，结束日期早于当天的项目不再参与组织同步；结束日期为当天、未来或为空的项目继续沿用原规则。
全局预览、全局执行、定时任务和一致性核对排除归档项目；单项目预览/执行返回明确跳过结果。
归档项目的创建绑定、名称和日期描述更新均不调用平台，现有组织及成员保持原样。
这取代旧的“项目到期后清空组织成员”行为；未归档项目内的到期排期成员处理、显式删除项目的清理策略不变。
日期延长至未归档范围后重新参与同步。新增边界与一致性测试，并将旧的到期清成员测试改为归档不变更测试。

真实主站只读补充核对：2026-09-22 实际 `/custom/kaoqin` 页面使用同源 `https://wowidea.top/kaoqin/tv.html?theme=dark&lang=zh-CN` iframe，未设置 sandbox；伪造 Bearer 调用 self/introspect 均返回 401。这不等于新版生产反代与真实角色验收已完成。
