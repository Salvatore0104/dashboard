---
name: dashboard-six-fixes
overview: 修复仪表盘项目中的6个问题：1)甘特图拖拽实时预览 2)删除模式需点击两次 3)同步人员按部门筛选 4)请假状态视觉增强 5)pre/post含义澄清与布局调整 6)项目颜色精简优化
todos:
  - id: fix-bar-drag-preview
    content: 修改 board.js paintBarDrag 实现拖拽实时像素预览，移除中途的 pixelsToRange/rangeToPixels 吸附转换，仅 mouseUp 时吸附到列
    status: completed
  - id: fix-delete-mode-batch
    content: 修改 board.js bindGanttEvents 中删除按钮事件，将 .find() 改为 .filter() 批量删除同一人在同一项目的全部分配
    status: completed
  - id: fix-sync-dept-filter
    content: 修改 admin.js renderSyncUsers 增加部门下拉筛选，已存在人员 checkbox 设为 disabled 且卡片灰色不可点击；更新 styles.css 对应样式
    status: completed
  - id: fix-leave-visual
    content: 使用 [skill:impeccable] 增强 .person-chip.leave 样式（降低不透明度、左侧实色边框、删除线）并强化 board.js renderPersonChip 中请假标识
    status: completed
  - id: fix-group-layout
    content: 修改 admin.js renderPersonCard 将 pre/post 译为中文前期/后期，重构卡片布局为两行结构将状态标签与操作按钮分离；更新 styles.css 对应布局
    status: completed
  - id: fix-project-colors
    content: 修改 admin.js CANDY_COLORS 数组为8种专业颜色（蓝绿琥珀红紫粉青靛蓝）
    status: completed
---

## 需求概述

对 Claw 项目排期看板进行6项功能与视觉修改，涉及前台看板（board.js）、后台管理（admin.js）和样式（styles.css）。

## 核心修改

1. **甘特图人员条拖拽/拉伸实时预览**：当前拖拽时 bar 因 `pixelsToRange` → `rangeToPixels` 链路中的 `Math.round` 导致跳跃吸附到列网格，而非平滑跟随鼠标。需改为拖拽过程中纯像素级实时预览，仅在 mouseUp 时才吸附到列。

2. **删除模式批量删除**：删除模式下点击删除按钮仅删除该人员在当前项目中的一条分配（使用 `.find()`），若存在多条分配则需点击多次。改为 `.filter()` 查找全部并一次性删除。

3. **同步人员按部门筛选 + 已存在人员灰色禁用**：同步钉钉人员弹窗中增加部门下拉筛选功能；已存在人员复选框设为 disabled，卡片灰色不可点击。

4. **请假状态视觉强化**：前台看板人员列表中请假人员的 chip 样式不够明显，需增强视觉提示（如降低不透明度、添加醒目标识或特殊纹理）。

5. **pre/post中文化 + 卡片布局调整**：管理员列表中 `pre`/`post` 缩写改为中文「前期」/「后期」；将状态标签（正常/请假）从操作按钮行独立出来，放在姓名下方，避免与请假和删除按钮混淆。

6. **项目颜色精简与美化**：将当前10种糖果色精简为6-8个专业美观的颜色。

## 技术栈

- 纯前端 HTML/CSS/JavaScript（无框架）
- 后端：Python Flask（app.py），本次仅涉及前端静态文件修改

## 修改策略

### 问题1：甘特图拖拽实时预览 - bar 背景颜色不随拖拽更新（board.js `paintBarDrag`）

**根因**：`paintBarDrag()` 在拖拽过程中更新了 bar 的 `transform`（位置）和 `width`，但没有更新 `background` 样式。bar 的渐变背景（由 `buildBarStyle()` 生成，叠加请假/冲突/出差状态）基于初始渲染时的日期范围计算，拖拽到新位置后日期变了但背景色不变，只有松手重新渲染后才更新。

**方案**：在 `paintBarDrag()` 中，`pixelsToRange` → `getMergedPreview` → `rangeToPixels` 链路保持不变，因为需要精确的日期范围来判断 merge。关键是在此基础上**增加一步**：根据 preview 的日期范围（`merged.start`, `merged.end`）重新计算 bar 的 `background` 渐变并设置到 `bar.style.background`。复用 `buildBarStyle` 的逻辑（或提取为独立函数），传入新的 `rowStart`/`rowEnd` 偏移量来计算渐变覆盖层。

具体修改：

1. 提取 `buildBarStyle` 中的渐变覆盖层生成逻辑，使其可根据日期范围独立调用
2. 在 `paintBarDrag` 中，利用已有的 `range` 和 `merged` 结果，计算新的渐变 background 并设置到 bar 上

### 问题2：删除模式批量删除（board.js `bindGanttEvents`）

**根因**：第569行 `const assignment = this.state.assignments.find(...)` 只返回第一条匹配。

**方案**：改为 `const assignments = this.state.assignments.filter(...)`，遍历全部匹配项并逐一调用 DELETE API，最后刷新数据。

### 问题3：同步人员部门筛选 + 禁用（admin.js `renderSyncUsers` + styles.css）

**方案**：

- 在 `syncPersonsList` 上方插入一个 `<select>` 下拉框，选项为所有不重复的部门名称 + 「全部」。
- 切换部门时过滤 `state.syncUsers` 并重新渲染。
- 已存在人员的卡片：在 `sync-user-card` 上设置 `pointer-events: none` 和更明显灰色样式（降低不透明度至0.5），checkbox 添加 `disabled` 属性。

### 问题4：请假状态视觉强化（styles.css + board.js）

**核心规则**：

- **仅当天正在请假的**才变灰色（`isCurrentlyOnLeave` 为 true），用户需明确看到该人员不可用
- 不需要删除线，直接灰色即可
- **灰色 chip 仍然可以拖拽**（保持 `cursor: grab`，不设置 `pointer-events: none`）
- **未来请假**不需要改变 chip 外观，只需保留现有的红色「请假」标签标记
- **过去请假**不处理

**方案**：

- `.person-chip.leave` 样式：`opacity: 0.5`、`background: #e5e7eb`、`color: #6b7280`、`border-color: #d1d5db`，但明确保留 `cursor: grab` 和可拖拽交互
- 在 `renderPersonChip` 中，仅当 `leave?.isCurrentlyOnLeave` 时才添加 `.leave` 类
- 在 `renderPersonChip` 中，未来请假 (`isFutureLeave`) 保留现有红色「请假」标签

### 问题5：pre/post中文化 + 卡片布局（admin.js `renderPersonCard` + styles.css）

**方案**：

- 新增映射函数将 `group_type` 值翻译：`pre` → 前期、`post` → 后期、`other` → 其他。
- 调整 `.admin-person-card` 布局为两行结构：
- 第一行：头像 + 姓名 + 部门/分组信息（中文）
- 第二行：状态标签（正常/请假），左对齐显示
- 按钮行保持独立在右侧

### 问题6：项目颜色精简（admin.js `CANDY_COLORS`）

**方案**：将 `CANDY_COLORS` 从10种糖果色（`#7dd3fc`, `#86efac`, `#fda4af`, `#fcd34d`, `#c4b5fd`, `#f0abfc`, `#67e8f9`, `#fdba74`, `#a7f3d0`, `#93c5fd`）替换为8种专业色彩：

```js
const CANDY_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#6366f1"];
```

这些颜色涵盖蓝、绿、琥珀、红、紫、粉、青、靛蓝，适用于项目管理场景，视觉专业且辨识度高。

## 使用的技能扩展

### Skill

- **Impeccable（前端设计工具集）**
- 用途：为问题4（请假状态视觉强化）和问题6（颜色精简）提供专业的设计建议，确保请假 chip 样式和项目颜色调色板达到高水准视觉效果
- 预期成果：生成增强的请假状态 CSS 规则和优化的项目颜色调色板方案