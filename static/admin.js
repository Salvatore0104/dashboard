(function () {
  const CANDY_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#6366f1"];
  // 与 board.js 保持一致的部门列表
  const DEPTS = [
    { name: "总经办", color: "#6366f1" },
    { name: "演艺制作部", color: "#8b5cf6" },
    { name: "项目管理组", color: "#a855f7" },
    { name: "前期美术", color: "#3b82f6" },
    { name: "后期制作", color: "#10b981" },
    { name: "VJ组", color: "#06b6d4" },
    { name: "视觉工程部", color: "#f59e0b" },
    { name: "综合管理部", color: "#d97706" },
    { name: "市场部", color: "#ec4899" },
    { name: "其他", color: "#64748b" }
  ];
  const state = {
    projects: [],
    persons: [],
    assignments: [],
    config: {},
    editingProjectId: null,
    editingLeavePersonId: null,
    selectedColor: CANDY_COLORS[0],
    businessTripProjectId: null,
    syncUsers: [],
    syncDeptFilter: ""
  };
  const els = {};

  window.AdminApp = { init };

  function init() {
    cache();
    installIcons();
    bind();
    loadAll();
  }

  function cache() {
    [
      "navTitle", "projectBody", "personList", "leaveRecordList", "projectCount", "personCount", "leaveRecordCount",
      "projectModal", "businessTripModal", "syncPersonsModal", "leaveModal", "configModal", "toast",
      "projectModalTitle", "projectName", "projectStart", "projectEnd", "projectColorPicker",
      "btProjectId", "btProjectName", "projectBusinessTrip", "projectBusinessTripStart", "projectBusinessTripEnd", "businessTripPersons",
      "syncPersonsList", "syncPersonsStatus", "leavePersonName", "leaveType", "leaveStart", "leaveEnd",
      "projectTitle", "defaultAssignDays", "dingAppKey", "dingAppSecret", "dingTestResult",
      "themePrimary", "deptColorGrid", "statusColorGrid", "tripUpcomingColor", "tripActiveColor", "leaveActiveColor", "leaveUpcomingColor", "conflictColor"
    ].forEach((id) => els[id] = document.getElementById(id));
  }

  function installIcons() {
    document.querySelectorAll("[data-icon]").forEach((el) => el.innerHTML = Icons.svg(el.dataset.icon));
    document.querySelectorAll("[data-nav-icon]").forEach((el) => el.insertAdjacentHTML("afterbegin", Icons.svg(el.dataset.navIcon)));
  }

  function bind() {
    byId("addProjectBtn").addEventListener("click", () => openProjectModal());
    byId("syncPersonsBtn").addEventListener("click", openSyncPersonsModal);
    byId("configBtn").addEventListener("click", openConfigModal);
    byId("syncLeaveBtn").addEventListener("click", syncLeaveNow);
    byId("exportJsonBtn").addEventListener("click", () => location.href = "api/export");
    byId("exportCsvBtn").addEventListener("click", () => location.href = "api/export/assignments/csv");
    byId("saveProjectBtn").addEventListener("click", saveProject);
    byId("saveBusinessTripBtn").addEventListener("click", saveBusinessTrip);
    byId("fetchDingUsersBtn").addEventListener("click", fetchDingUsers);
    byId("saveSelectedPersonsBtn").addEventListener("click", saveSelectedPersons);
    byId("saveLeaveBtn").addEventListener("click", saveLeave);
    byId("clearLeaveBtn").addEventListener("click", clearLeave);
    byId("saveConfigBtn").addEventListener("click", saveConfig);
    byId("resetConfigBtn").addEventListener("click", resetConfigDefaults);
    byId("testDingTalkBtn").addEventListener("click", testDingTalk);
    byId("editDingBtn").addEventListener("click", enableDingEdit);
    byId("saveDingBtn").addEventListener("click", saveDingConfig);
    els.projectBusinessTrip.addEventListener("change", () => renderBusinessTripPersonPicker(currentTripProject()));
    document.querySelectorAll("[data-close-modal]").forEach((btn) => btn.addEventListener("click", () => closeModal(btn.dataset.closeModal)));
  }

  async function loadAll() {
    const [projects, persons, assignments, config] = await Promise.all([
      fetchJson("api/projects"),
      fetchJson("api/persons"),
      fetchJson("api/assignments"),
      fetchJson("api/config").catch(() => ({}))
    ]);
    state.projects = projects;
    state.persons = persons;
    state.assignments = assignments;
    state.config = config || {};
    window.ThemeStore?.save(state.config);
    applyThemeConfig();
    renderProjects();
    renderPersons();
    renderLeaves();
  }

  function applyThemeConfig() {
    const title = state.config.project_title || "Claw 项目排期看板";
    document.title = `后台管理 - ${title}`;
    els.navTitle.textContent = `${title} · 后台管理`;
    els.navTitle.classList.remove("loading");
    applyTheme(state.config.theme_primary || "#3157d5");
    // 状态颜色 CSS 变量
    document.documentElement.style.setProperty("--trip-upcoming", state.config.trip_upcoming_color || "#15803d");
    document.documentElement.style.setProperty("--trip-active", state.config.trip_active_color || "#c2410c");
    document.documentElement.style.setProperty("--leave-active", state.config.leave_active_color || "#dc2626");
    document.documentElement.style.setProperty("--leave-upcoming", state.config.leave_upcoming_color || "#2563eb");
    document.documentElement.style.setProperty("--trip", state.config.trip_active_color || "#c2410c");
    document.documentElement.style.setProperty("--leave", state.config.leave_active_color || "#dc2626");
    // 显示 brand-mark（去掉 loading 类）
    document.querySelector(".brand-mark")?.classList.remove("loading");
  }

  function renderProjects() {
    els.projectCount.textContent = `${state.projects.length} 个`;
    if (!state.projects.length) {
      els.projectBody.innerHTML = `<tr><td colspan="7" class="table-empty">暂无项目</td></tr>`;
      return;
    }
    els.projectBody.innerHTML = state.projects.map((p) => {
      const tripPersons = parseJsonArray(p.business_trip_persons).map(personName).join("、") || "-";
      return `<tr>
        <td><span class="color-swatch" style="background:${esc(p.color || CANDY_COLORS[0])}"></span><strong>${esc(p.name)}</strong></td>
        <td>${esc(p.start_date)}</td>
        <td>${esc(p.end_date)}</td>
        <td>${p.business_trip == 1 ? '<span class="tag tag-trip">已启用</span>' : '<span class="tag">未启用</span>'}</td>
        <td>${p.business_trip == 1 ? `${esc(p.business_trip_start || "-")} ~ ${esc(p.business_trip_end || "-")}` : "-"}</td>
        <td>${esc(tripPersons)}</td>
        <td class="actions">
          <button class="btn btn-sm" data-edit-project="${esc(p.id)}">${Icons.svg("admin")}编辑</button>
          <button class="btn btn-warning btn-sm" data-trip-project="${esc(p.id)}">${Icons.svg("plane")}出差</button>
          <button class="btn btn-danger btn-sm" data-delete-project="${esc(p.id)}">${Icons.svg("trash")}删除</button>
        </td>
      </tr>`;
    }).join("");
    els.projectBody.querySelectorAll("[data-edit-project]").forEach((btn) => btn.addEventListener("click", () => openProjectModal(btn.dataset.editProject)));
    els.projectBody.querySelectorAll("[data-trip-project]").forEach((btn) => btn.addEventListener("click", () => openBusinessTripModal(btn.dataset.tripProject)));
    els.projectBody.querySelectorAll("[data-delete-project]").forEach((btn) => btn.addEventListener("click", () => deleteProject(btn.dataset.deleteProject)));
  }

  function renderPersons() {
    els.personCount.textContent = `${state.persons.length} 人`;
    if (!state.persons.length) {
      els.personList.innerHTML = empty("users", "暂无人员，可以手动添加或配置钉钉后同步。");
      return;
    }
    const groups = groupBy(state.persons, (p) => p.department || "未分组");
    els.personList.innerHTML = [...groups.entries()].map(([dept, persons]) => `
      <section class="admin-person-section">
        <div class="admin-person-head">
          <span class="color-swatch" style="background:${personColor(persons[0])}"></span>
          <strong>${esc(dept)}</strong>
          <span class="tag">${persons.length} 人</span>
        </div>
        <div class="admin-person-grid">${persons.map(renderPersonCard).join("")}</div>
      </section>`).join("");
    els.personList.querySelectorAll("[data-leave-person]").forEach((btn) => btn.addEventListener("click", () => openLeaveModal(btn.dataset.leavePerson)));
    els.personList.querySelectorAll("[data-delete-person]").forEach((btn) => btn.addEventListener("click", () => deletePerson(btn.dataset.deletePerson)));
  }

  // 获取人员出差状态：出差中（今天在区间内）> 即将出差（今天还没到开始日期）
  function getPersonTrip(person) {
    const today = startOfDay();
    const personId = String(person.id);
    for (const project of state.projects) {
      if (project.business_trip != 1 || !project.business_trip_start || !project.business_trip_end) continue;
      let btPersons = [];
      try { btPersons = JSON.parse(project.business_trip_persons || "[]").map(String); } catch { continue; }
      if (!btPersons.includes(personId)) continue;
      const tripStart = parseDate(project.business_trip_start);
      const tripEnd = parseDate(project.business_trip_end, true);
      // 今天在出差区间内 → 出差中
      if (tripStart <= today && tripEnd >= today) {
        return { projectName: project.name, start: tripStart, end: tripEnd, status: "active" };
      }
      // 今天还没到出差开始日期 → 即将出差
      if (tripStart > today) {
        return { projectName: project.name, start: tripStart, end: tripEnd, status: "upcoming" };
      }
    }
    return null;
  }

  function renderPersonCard(person) {
    const today = startOfDay();
    const personId = String(person.id);

    // 判断今日起的请假状态
    const leaveStart = person.leave_start ? parseDate(person.leave_start) : null;
    const leaveEnd = person.leave_end ? parseDate(person.leave_end, true) : null;
    const hasActiveLeave = leaveStart && leaveEnd && leaveEnd >= today;

    // 判断出差状态
    const trip = getPersonTrip(person);

    // 判断今日起是否有项目分配
    const hasFutureAssignment = state.assignments.some((a) => {
      if (String(a.person_id) !== personId) return false;
      const aEnd = parseDate(a.end_date, true);
      return aEnd >= today;
    });

    // 状态标签优先级：出差中 > 即将出差 > 请假中 > 即将请假 > 在项 > 待定
    let statusTag;
    if (trip) {
      const isActive = trip.status === "active";
      const label = isActive ? "出差中" : "即将出差";
      const displayStart = trip.start < today ? today : trip.start;
      statusTag = `<span class="tag ${isActive ? "tag-trip" : "tag-trip-upcoming"}" title="${esc(trip.projectName)} ${label} ${dateStr(displayStart)} ~ ${dateStr(trip.end)}">${label}</span>`;
    } else if (hasActiveLeave) {
      // 进一步区分：请假中（今天在区间内）vs 即将请假（start > 今天）
      const isCurrentlyOnLeave = leaveStart && leaveStart <= today;
      const leaveType = person.leave_type || person.leave_status || "请假";
      const displayStart = leaveStart < today ? today : leaveStart;
      if (isCurrentlyOnLeave) {
        statusTag = `<span class="tag tag-leave-active" title="${esc(leaveType)} ${dateStr(displayStart)} ~ ${dateStr(leaveEnd)}">请假中</span>`;
      } else {
        statusTag = `<span class="tag tag-leave-upcoming" title="${esc(leaveType)} ${dateStr(leaveStart)} ~ ${dateStr(leaveEnd)}">即将请假</span>`;
      }
    } else if (hasFutureAssignment) {
      // 收集今日起的项目名
      const futureProjects = state.assignments
        .filter((a) => String(a.person_id) === personId && parseDate(a.end_date, true) >= today)
        .map((a) => {
          const project = state.projects.find((p) => String(p.id) === String(a.project_id));
          const aStart = parseDate(a.start_date);
          const displayStart = aStart < today ? today : aStart;
          return `${project?.name || "未知"} ${dateStr(displayStart)}~${dateStr(parseDate(a.end_date, true))}`;
        })
        .join("；");
      statusTag = `<span class="tag tag-primary" title="${esc(futureProjects || "在项")}">在项</span>`;
    } else {
      statusTag = `<span class="tag">待定</span>`;
    }

    const groupLabel = groupTypeLabel(person.group_type);
    return `<article class="admin-person-card">
      <span class="person-dot" style="background:${personColor(person)}">${esc(String(person.name || "?").slice(0, 1))}</span>
      <span class="person-main">
        <strong>${esc(person.name)}</strong>
        <small>${esc(groupLabel)}</small>
      </span>
      ${statusTag}
      <button class="btn btn-warning btn-sm" data-leave-person="${esc(person.id)}">请假</button>
      <button class="btn btn-danger btn-sm" data-delete-person="${esc(person.id)}">删除</button>
    </article>`;
  }

  function groupTypeLabel(type) {
    if (type === "pre") return "前期";
    if (type === "post") return "后期";
    return "其他";
  }

  function renderLeaves() {
    const leaves = state.persons.filter((p) => p.leave_start && p.leave_end);
    els.leaveRecordCount.textContent = `${leaves.length} 条`;
    if (!leaves.length) {
      els.leaveRecordList.innerHTML = empty("calendar", "暂无请假记录");
      return;
    }
    els.leaveRecordList.innerHTML = `<div class="table-wrap"><table><thead><tr><th>人员</th><th>类型</th><th>开始</th><th>结束</th><th class="actions">操作</th></tr></thead><tbody>
      ${leaves.map((p) => `<tr><td>${esc(p.name)}</td><td><span class="tag tag-danger">${esc(p.leave_type || p.leave_status || "请假")}</span></td><td>${esc(p.leave_start)}</td><td>${esc(p.leave_end)}</td><td class="actions"><button class="btn btn-sm" data-leave-person="${esc(p.id)}">编辑</button></td></tr>`).join("")}
    </tbody></table></div>`;
    els.leaveRecordList.querySelectorAll("[data-leave-person]").forEach((btn) => btn.addEventListener("click", () => openLeaveModal(btn.dataset.leavePerson)));
  }

  function openProjectModal(id) {
    state.editingProjectId = id || null;
    const project = id ? state.projects.find((p) => String(p.id) === String(id)) : null;
    els.projectModalTitle.textContent = project ? "编辑项目" : "添加项目";
    els.projectName.value = project?.name || "";
    els.projectStart.value = project?.start_date || todayStr();
    els.projectEnd.value = project?.end_date || todayStr(7);
    state.selectedColor = project?.color || CANDY_COLORS[0];
    renderColorPicker();
    openModal("projectModal");
  }

  function renderColorPicker() {
    const customActive = !CANDY_COLORS.includes(state.selectedColor);
    els.projectColorPicker.innerHTML = `
      <div class="color-presets">${CANDY_COLORS.map((color) => `<button type="button" class="color-choice ${state.selectedColor === color ? "active" : ""}" style="background:${color}" data-color="${color}" title="糖果色"></button>`).join("")}</div>
      <label class="custom-color color-choice ${customActive ? "active" : ""}" style="background:${esc(state.selectedColor)}" title="自定义颜色"><input type="color" id="projectCustomColor" value="${esc(state.selectedColor)}"></label>`;
    els.projectColorPicker.querySelectorAll("[data-color]").forEach((btn) => btn.addEventListener("click", () => {
      state.selectedColor = btn.dataset.color;
      renderColorPicker();
    }));
    byId("projectCustomColor").addEventListener("input", (event) => {
      state.selectedColor = event.target.value;
      const custom = event.target.closest(".custom-color");
      if (custom) {
        custom.style.background = state.selectedColor;
        custom.classList.add("active");
      }
      els.projectColorPicker.querySelectorAll("[data-color]").forEach((btn) => btn.classList.remove("active"));
    });
  }

  async function saveProject() {
    const name = els.projectName.value.trim();
    if (!name) return toast("请输入项目名称");
    const body = {
      name,
      startDate: els.projectStart.value,
      endDate: els.projectEnd.value,
      color: state.selectedColor
    };
    const url = state.editingProjectId ? `api/projects/${encodeURIComponent(state.editingProjectId)}` : "api/projects";
    await fetch(url, { method: state.editingProjectId ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    closeModal("projectModal");
    await loadAll();
    toast("项目已保存");
  }

  function openBusinessTripModal(id) {
    state.businessTripProjectId = id;
    const project = currentTripProject();
    if (!project) return;
    els.btProjectId.value = project.id;
    els.btProjectName.textContent = project.name;
    els.projectBusinessTrip.checked = project.business_trip == 1;
    els.projectBusinessTripStart.value = project.business_trip_start || project.start_date || "";
    els.projectBusinessTripEnd.value = project.business_trip_end || project.end_date || "";
    renderBusinessTripPersonPicker(project);
    openModal("businessTripModal");
  }

  function currentTripProject() {
    return state.projects.find((p) => String(p.id) === String(state.businessTripProjectId || els.btProjectId?.value));
  }

  function renderBusinessTripPersonPicker(project) {
    const enabled = els.projectBusinessTrip.checked;
    els.businessTripPersons.style.display = enabled ? "grid" : "none";
    if (!enabled) return;
    const selected = new Set(parseJsonArray(project?.business_trip_persons).map(String));
    els.businessTripPersons.innerHTML = state.persons.map((p) => `<label class="person-check"><input type="checkbox" value="${esc(p.id)}" ${selected.has(String(p.id)) ? "checked" : ""}><span class="person-dot" style="background:${personColor(p)}">${esc(String(p.name || "?").slice(0, 1))}</span><span>${esc(p.name)}</span></label>`).join("") || `<span class="tag">暂无人员</span>`;
  }

  async function saveBusinessTrip() {
    const project = currentTripProject();
    if (!project) return;
    const body = {
      businessTrip: els.projectBusinessTrip.checked ? 1 : 0,
      businessTripStart: els.projectBusinessTripStart.value,
      businessTripEnd: els.projectBusinessTripEnd.value,
      businessTripPersons: [...els.businessTripPersons.querySelectorAll("input:checked")].map((input) => input.value)
    };
    await fetch(`api/projects/${encodeURIComponent(project.id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    closeModal("businessTripModal");
    await loadAll();
    toast("出差信息已保存");
  }

  async function deleteProject(id) {
    if (!confirm("确定删除此项目及其全部分配吗？")) return;
    await fetch(`api/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadAll();
    toast("项目已删除");
  }

  async function deletePerson(id) {
    if (!confirm("确定删除此人员及其全部分配吗？")) return;
    await fetch(`api/persons/${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadAll();
    toast("人员已删除");
  }

  function openLeaveModal(id) {
    state.editingLeavePersonId = id;
    const person = state.persons.find((p) => String(p.id) === String(id));
    if (!person) return;
    els.leavePersonName.value = person.name;
    els.leaveType.value = person.leave_type || person.leave_status || "请假";
    els.leaveStart.value = person.leave_start || todayStr();
    els.leaveEnd.value = person.leave_end || todayStr();
    openModal("leaveModal");
  }

  async function saveLeave() {
    await fetch("api/leave/set", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ personId: state.editingLeavePersonId, leaveStatus: els.leaveType.value, leaveType: els.leaveType.value, leaveStart: els.leaveStart.value, leaveEnd: els.leaveEnd.value }) });
    closeModal("leaveModal");
    await loadAll();
    toast("请假记录已保存");
  }

  async function clearLeave() {
    await fetch("api/leave/set", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ personId: state.editingLeavePersonId, leaveStatus: "", leaveType: "", leaveStart: "", leaveEnd: "" }) });
    closeModal("leaveModal");
    await loadAll();
    toast("请假状态已清空");
  }

  function openConfigModal() {
    els.projectTitle.value = state.config.project_title || "Claw 项目排期看板";
    els.defaultAssignDays.value = state.config.default_assign_days || 1;
    els.themePrimary.value = state.config.theme_primary || "#3157d5";
    els.tripUpcomingColor.value = state.config.trip_upcoming_color || "#15803d";
    els.tripActiveColor.value = state.config.trip_active_color || "#c2410c";
    els.leaveActiveColor.value = state.config.leave_active_color || "#dc2626";
    els.leaveUpcomingColor.value = state.config.leave_upcoming_color || "#2563eb";
    els.conflictColor.value = state.config.conflict_color || "#dc2626";
    els.dingTestResult.style.display = "none";

    // 动态生成部门颜色选择器（只显示有人员的部门）
    renderDeptColorGrid();

    // 钉钉字段：已配置时只读，显示「已配置」标签
    const hasDing = !!(state.config.ding_appKey && state.config.ding_appSecret);
    els.dingAppKey.value = state.config.ding_appKey || "";
    els.dingAppKey.readOnly = hasDing;
    els.dingAppSecret.value = state.config.ding_appSecret || "";
    els.dingAppSecret.readOnly = hasDing;
    const editBtn = byId("editDingBtn");
    const saveRow = byId("dingSaveRow");
    const savedTag = byId("dingSavedTag");
    if (editBtn) editBtn.style.display = hasDing ? "" : "none";
    if (saveRow) saveRow.style.display = "none";
    if (savedTag) savedTag.style.display = hasDing ? "inline-flex" : "none";
    if (savedTag) savedTag.className = "tag tag-primary";

    openModal("configModal");
  }

  // 一套美观的部门默认配色（柔和专业色系）
  const DEPT_DEFAULT_COLORS = [
    "#6366f1", "#8b5cf6", "#a855f7", // 紫色系
    "#3b82f6", "#06b6d4", "#0ea5e9", // 蓝色系
    "#10b981", "#059669", "#14b8a6", // 绿色系
    "#f59e0b", "#d97706", "#ea580c", // 橙色系
    "#ec4899", "#f43f5e", "#dc2626", // 红色系
    "#64748b", "#475569", "#334155"  // 灰色系
  ];

  // 部门自定义排序：前期美术 → 后期制作 → VJ组 → 其他（拼音）→ "其他"放最后
  const DEPT_ORDER = ["前期美术", "后期制作", "VJ组"];
  function deptSortKey(name) {
    const idx = DEPT_ORDER.indexOf(name);
    if (idx >= 0) return idx;               // 0, 1, 2 按指定顺序
    if (name === "其他") return 9998;        // "其他" 倒数第二
    return 1000 + name.length;               // 其余按拼音排（由 localeCompare 处理）
  }

  function renderDeptColorGrid() {
    // 合并 DEPTS 硬编码部门和实际人员中的部门（都显示，去重）
    const deptSet = new Set();
    DEPTS.forEach(d => deptSet.add(d.name));
    state.persons.forEach(p => {
      const d = p.department || "";
      if (d) deptSet.add(d);
    });
    const depts = [...deptSet].sort((a, b) => {
      const ka = deptSortKey(a);
      const kb = deptSortKey(b);
      if (ka !== kb) return ka - kb;
      return a.localeCompare(b, "zh-CN");
    });
    if (!depts.length) {
      els.deptColorGrid.innerHTML = '<div class="field"><span class="tag">暂无部门</span></div>';
      return;
    }
    const configKey = (dept) => "dept_color_" + dept.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "_");
    els.deptColorGrid.innerHTML = depts.map((dept, i) => {
      const key = configKey(dept);
      const defaultColor = DEPT_DEFAULT_COLORS[i % DEPT_DEFAULT_COLORS.length];
      const currentColor = state.config[key] || defaultColor;
      const id = "deptColor_" + i;
      return `<div class="field"><label>${esc(dept)}</label><input class="input color-input dept-color-input" id="${id}" type="color" value="${esc(currentColor)}" data-dept="${esc(dept)}" data-key="${esc(key)}"></div>`;
    }).join("");
  }

  async function testDingTalk() {
    els.dingTestResult.style.display = "inline-flex";
    els.dingTestResult.textContent = "正在测试...";
    const appKey = els.dingAppKey.readOnly ? state.config.ding_appKey : els.dingAppKey.value.trim();
    const appSecret = els.dingAppKey.readOnly ? state.config.ding_appSecret : els.dingAppSecret.value.trim();
    const data = await fetchJson("api/dingtalk/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appKey, appSecret }) });
    els.dingTestResult.textContent = data.message || (data.success ? "连接成功" : "连接失败");
    els.dingTestResult.className = `tag ${data.success ? "tag-primary" : "tag-danger"}`;
  }

  function resetConfigDefaults() {
    els.themePrimary.value = "#3157d5";
    els.tripUpcomingColor.value = "#15803d";
    els.tripActiveColor.value = "#c2410c";
    els.leaveActiveColor.value = "#dc2626";
    els.leaveUpcomingColor.value = "#2563eb";
    els.conflictColor.value = "#dc2626";
    // 重置部门颜色
    els.deptColorGrid.querySelectorAll(".dept-color-input").forEach((input, i) => {
      input.value = DEPT_DEFAULT_COLORS[i % DEPT_DEFAULT_COLORS.length];
    });
    toast("颜色已恢复为默认值，请点击保存配置生效");
  }

  function enableDingEdit() {
    els.dingAppKey.readOnly = false;
    els.dingAppSecret.readOnly = false;
    els.dingAppKey.focus();
    byId("editDingBtn").style.display = "none";
    byId("dingSaveRow").style.display = "";
    byId("dingSavedTag").style.display = "none";
  }

  async function saveDingConfig() {
    const appKey = els.dingAppKey.value.trim();
    const appSecret = els.dingAppSecret.value.trim();
    if (!appKey || !appSecret) return toast("请填写完整的钉钉 AppKey 和 AppSecret");
    await fetch("api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ding_appKey: appKey, ding_appSecret: appSecret }) });
    // 更新本地 state
    state.config.ding_appKey = appKey;
    state.config.ding_appSecret = appSecret;
    // 恢复只读状态
    els.dingAppKey.readOnly = true;
    els.dingAppSecret.readOnly = true;
    byId("editDingBtn").style.display = "";
    byId("dingSaveRow").style.display = "none";
    byId("dingSavedTag").style.display = "inline-flex";
    toast("钉钉配置已保存");
  }

  async function saveConfig() {
    const body = {
      project_title: els.projectTitle.value.trim() || "Claw 项目排期看板",
      default_assign_days: els.defaultAssignDays.value || "1",
      ding_appKey: state.config.ding_appKey || "",
      ding_appSecret: state.config.ding_appSecret || "",
      theme_primary: els.themePrimary.value,
      trip_upcoming_color: els.tripUpcomingColor.value,
      trip_active_color: els.tripActiveColor.value,
      leave_active_color: els.leaveActiveColor.value,
      leave_upcoming_color: els.leaveUpcomingColor.value,
      conflict_color: els.conflictColor.value,
      conflict_opacity: state.config.conflict_opacity || "30"
    };
    // 收集动态部门颜色
    els.deptColorGrid.querySelectorAll(".dept-color-input").forEach(input => {
      body[input.dataset.key] = input.value;
    });
    await fetch("api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    window.ThemeStore?.save({ ...state.config, ...body });
    closeModal("configModal");
    await loadAll();
    toast("配置已保存");
  }

  async function syncLeaveNow() {
    toast("正在同步请假状态...");
    const appKey = state.config.ding_appKey || "";
    const appSecret = state.config.ding_appSecret || "";
    const data = await fetchJson("api/leave/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appKey, appSecret })
    }).catch((error) => ({ success: false, message: error.message }));
    await loadAll();
    toast(data.message || (data.success ? "同步完成" : "同步请求已发送"));
  }

  function openSyncPersonsModal() {
    // 从 sessionStorage 恢复之前获取的钉钉人员列表
    if (!state.syncUsers.length) {
      try {
        const cached = sessionStorage.getItem("dingtalk_sync_users");
        if (cached) {
          state.syncUsers = JSON.parse(cached);
          state.syncDeptFilter = sessionStorage.getItem("dingtalk_sync_dept_filter") || "";
        }
      } catch {}
    }
    if (!state.syncUsers.length) {
      els.syncPersonsStatus.textContent = "等待获取";
      els.syncPersonsStatus.className = "sync-status";
      els.syncPersonsList.innerHTML = empty("users", "点击获取钉钉人员后勾选需要同步的人");
    } else {
      els.syncPersonsStatus.textContent = `${state.syncUsers.length} 人可选`;
      els.syncPersonsStatus.className = "sync-status sync-status-ok";
      renderSyncUsers();
    }
    openModal("syncPersonsModal");
  }

  async function fetchDingUsers() {
    const appKey = state.config.ding_appKey || "";
    const appSecret = state.config.ding_appSecret || "";
    if (!appKey || !appSecret) return toast("请先在系统配置里填写钉钉 AppKey 和 AppSecret");
    els.syncPersonsStatus.textContent = "正在获取...";
    els.syncPersonsStatus.className = "sync-status";
    const data = await fetchJson("api/dingtalk/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appKey, appSecret })
    }).catch((error) => ({ success: false, message: error.message }));
    if (!data.success) {
      els.syncPersonsStatus.textContent = "获取失败";
      els.syncPersonsStatus.className = "sync-status sync-status-err";
      return toast(data.message || "获取钉钉人员失败");
    }
    state.syncUsers = Array.isArray(data.data) ? data.data : [];
    // 保存到 sessionStorage，刷新页面后可恢复
    try {
      sessionStorage.setItem("dingtalk_sync_users", JSON.stringify(state.syncUsers));
    } catch {}
    els.syncPersonsStatus.textContent = `${state.syncUsers.length} 人可选`;
    els.syncPersonsStatus.className = "sync-status sync-status-ok";
    renderSyncUsers();
  }

  function renderSyncUsers() {
    if (!state.syncUsers.length) {
      els.syncPersonsList.innerHTML = empty("users", "没有获取到可同步人员");
      return;
    }
    const depts = [...new Set(state.syncUsers.map(u => u.department || "未分组"))].sort((a, b) => a.localeCompare(b, "zh-CN"));
    state.syncDeptFilter = state.syncDeptFilter || "";
    const filtered = state.syncDeptFilter
      ? state.syncUsers.filter(u => (u.department || "未分组") === state.syncDeptFilter)
      : state.syncUsers;

    // 按部门分组展示，每个部门有独立的表头和全选
    const grouped = new Map();
    for (const user of filtered) {
      const dept = user.department || "未分组";
      if (!grouped.has(dept)) grouped.set(dept, []);
      grouped.get(dept).push(user);
    }
    const deptOrder = [...grouped.keys()].sort((a, b) => a.localeCompare(b, "zh-CN"));

    const renderUserCard = (user) => {
      const id = user.id || user.dingId;
      const existing = state.persons.some((p) => String(p.id) === String(id) || String(p.ding_id) === String(id));
      return `<label class="sync-user-card ${existing ? "existing" : ""}">
        <input type="checkbox" value="${esc(id)}" ${existing ? "disabled" : ""}>
        <span class="person-dot" style="background:${personColor({ department: user.department || "", group_type: inferGroupType(user.department || user.title || "") })}">${esc(String(user.name || "?").slice(0, 1))}</span>
        <span class="person-main"><strong>${esc(user.name || "未命名")}</strong><small>${esc(user.department || "未分组")}</small></span>
        ${existing ? '<span class="tag">已存在</span>' : '<span class="tag tag-primary">新人员</span>'}
      </label>`;
    };

    let html = `<div class="sync-control-bar">
      <select class="select sync-dept-filter">
        <option value="">全部部门（${state.syncUsers.length} 人）</option>
        ${depts.map(d => `<option value="${esc(d)}" ${state.syncDeptFilter === d ? "selected" : ""}>${esc(d)}（${state.syncUsers.filter(u => (u.department || "未分组") === d).length} 人）</option>`).join("")}
      </select>
      <button class="btn btn-sm" id="selectAllSyncUsersBtn" type="button">全选可见</button>
      <button class="btn btn-sm" id="clearSyncUsersBtn" type="button">清空可见</button>
    </div>`;

    html += `<div class="sync-dept-list">`;
    for (const dept of deptOrder) {
      const users = grouped.get(dept);
      const deptId = `dept-${dept.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "_")}`;
      html += `<div class="sync-dept-group">
        <div class="sync-dept-head">
          <span class="color-swatch" style="background:${personColor({ department: dept, group_type: inferGroupType(dept) })}"></span>
          <strong>${esc(dept)}</strong>
          <span class="tag">${users.length} 人</span>
          <button class="btn btn-sm sync-dept-select" data-dept="${deptId}" type="button">全选本组</button>
        </div>
        <div class="sync-dept-grid" id="${deptId}">${users.map(renderUserCard).join("")}</div>
      </div>`;
    }
    html += `</div>`;

    els.syncPersonsList.innerHTML = html;

    // 初始化选中计数
    updateSyncSelectedCount();

    // 绑定部门筛选
    els.syncPersonsList.querySelector(".sync-dept-filter")?.addEventListener("change", (e) => {
      state.syncDeptFilter = e.target.value;
      try { sessionStorage.setItem("dingtalk_sync_dept_filter", e.target.value); } catch {}
      renderSyncUsers();
    });

    // 绑定全选可见
    els.syncPersonsList.querySelector("#selectAllSyncUsersBtn")?.addEventListener("click", () => {
      els.syncPersonsList.querySelectorAll('.sync-user-card:not(.existing) input[type="checkbox"]').forEach((cb) => cb.checked = true);
      updateSyncSelectedCount();
    });

    // 绑定清空可见
    els.syncPersonsList.querySelector("#clearSyncUsersBtn")?.addEventListener("click", () => {
      els.syncPersonsList.querySelectorAll('.sync-user-card:not(.existing) input[type="checkbox"]').forEach((cb) => cb.checked = false);
      updateSyncSelectedCount();
    });

    // 绑定部门全选（切换模式：全选/取消）
    els.syncPersonsList.querySelectorAll(".sync-dept-select").forEach((btn) => {
      btn.addEventListener("click", () => {
        const grid = document.getElementById(btn.dataset.dept);
        if (!grid) return;
        const checkboxes = grid.querySelectorAll('.sync-user-card:not(.existing) input[type="checkbox"]');
        const allChecked = checkboxes.length > 0 && [...checkboxes].every((cb) => cb.checked);
        checkboxes.forEach((cb) => cb.checked = !allChecked);
        btn.textContent = allChecked ? "全选本组" : "取消本组";
        updateSyncSelectedCount();
      });
    });

    // 绑定卡片 checkbox 变化时更新计数
    els.syncPersonsList.querySelectorAll('.sync-user-card input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener("change", updateSyncSelectedCount);
    });
  }

  function updateSyncSelectedCount() {
    const count = els.syncPersonsList.querySelectorAll('input[type="checkbox"]:checked').length;
    const btn = document.getElementById("saveSelectedPersonsBtn");
    if (btn) btn.innerHTML = `<span data-icon="save"></span>同步选中人员${count > 0 ? `（${count}）` : ""}`;
  }

  async function saveSelectedPersons() {
    const ids = [...els.syncPersonsList.querySelectorAll('input[type="checkbox"]:checked')].map((input) => String(input.value));
    if (!ids.length) return toast("请先选择要同步的人员");
    const users = state.syncUsers.filter((user) => ids.includes(String(user.id || user.dingId)));
    toast(`正在同步 ${users.length} 人...`);
    let successCount = 0;
    let failCount = 0;
    // 逐个同步，避免 SQLite 并发锁问题
    for (const user of users) {
      try {
        const res = await fetchJson("api/persons", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: user.id || user.dingId,
            dingId: user.dingId || user.id,
            name: user.name,
            avatar: user.avatar || "",
            department: user.department || "",
            groupType: inferGroupType(user.department || user.title || ""),
            selected: true
          })
        });
        if (res.success) successCount++;
        else failCount++;
      } catch (e) {
        failCount++;
        console.error("同步人员失败:", user.name, e);
      }
    }
    // 保存后不清空 syncUsers，下次打开弹窗可以继续使用
    els.syncPersonsStatus.textContent = `${state.syncUsers.length} 人可选`;
    els.syncPersonsStatus.className = "sync-status sync-status-ok";
    renderSyncUsers();
    await loadAll();
    toast(`已同步 ${successCount} 人` + (failCount > 0 ? `，${failCount} 人失败` : ""));
  }

  function personColor(person) {
    const dept = person?.department || "";
    // 优先使用部门配置颜色
    if (dept) {
      const configKey = "dept_color_" + dept.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "_");
      if (state.config[configKey]) return state.config[configKey];
    }
    // 回退到旧的 pre/post 颜色逻辑
    const group = person?.group_type || "";
    if (group === "pre" || group.includes("前期") || group.includes("美术") || dept.includes("前期") || dept.includes("美术")) return state.config.pre_person_color || "#2563eb";
    if (group === "post" || group.includes("后期") || group.includes("制作") || group.includes("VJ") || dept.includes("后期") || dept.includes("制作") || dept.includes("VJ")) return state.config.post_person_color || "#16a34a";
    return state.config.theme_primary || "#64748b";
  }

  function inferGroupType(text) {
    if (text.includes("前期") || text.includes("美术")) return "pre";
    if (text.includes("后期") || text.includes("制作") || text.includes("VJ")) return "post";
    return "other";
  }

  function openModal(id) {
    byId(id).classList.add("open");
  }
  function closeModal(id) {
    byId(id).classList.remove("open");
  }
  function toast(message) {
    els.toast.textContent = message;
    els.toast.style.display = "block";
    clearTimeout(els.toast._timer);
    els.toast._timer = setTimeout(() => els.toast.style.display = "none", 2600);
  }
  function empty(icon, text) {
    return `<div class="empty-state"><div class="empty-box">${Icons.svg(icon)}<p>${esc(text)}</p></div></div>`;
  }
  function personName(id) {
    return state.persons.find((p) => String(p.id) === String(id))?.name || id;
  }
  function parseJsonArray(value) {
    try {
      const parsed = Array.isArray(value) ? value : JSON.parse(value || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  function groupBy(items, keyFn) {
    const map = new Map();
    for (const item of items) {
      const key = keyFn(item);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
    return map;
  }
  function fetchJson(url, options) {
    return fetch(url, options).then((response) => {
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return response.json();
    });
  }
  function todayStr(add = 0) {
    const d = new Date();
    d.setDate(d.getDate() + add);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function startOfDay(date) {
    const d = date ? new Date(date) : new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }
  function parseDate(value, endOfDay) {
    if (!value) return null;
    const d = new Date(value + (value.length <= 10 ? "T00:00:00" : ""));
    if (isNaN(d.getTime())) return null;
    if (endOfDay) d.setHours(23, 59, 59, 999);
    return d;
  }
  function dateStr(date) {
    if (!date) return "";
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function byId(id) {
    return document.getElementById(id);
  }
  function esc(value) {
    return Icons.escapeHtml(value);
  }
  function applyTheme(primary) {
    document.documentElement.style.setProperty("--primary", primary);
    document.documentElement.style.setProperty("--primary-2", shadeColor(primary, -18));
    document.documentElement.style.setProperty("--primary-soft", rgba(primary, 0.12));
  }
  function rgba(hex, alpha) {
    const clean = String(hex || "#3157d5").replace("#", "");
    const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
    const n = parseInt(full, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }
  function shadeColor(hex, percent) {
    const clean = String(hex || "#3157d5").replace("#", "");
    const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
    const n = parseInt(full, 16);
    const amount = Math.round(255 * (percent / 100));
    const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amount));
    const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amount));
    const b = Math.max(0, Math.min(255, (n & 255) + amount));
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  }
})();
