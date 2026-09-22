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
    syncDeptFilter: "",
    globalSyncPreview: null,
    identityByDingId: new Map(),
    confirmAction: null
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
      "projectModal", "businessTripModal", "syncPersonsModal", "bindingModal", "leaveModal", "configModal", "toast",
      "globalSyncModal", "globalSyncSummary", "globalSyncBody", "globalSyncPreviewBtn", "globalSyncRunBtn",
      "globalSyncLogsModal", "globalSyncLogsBody",
      "actionConfirmModal", "actionConfirmTitle", "actionConfirmBody", "actionConfirmBtn",
      "projectModalTitle", "projectName", "projectStart", "projectEnd", "projectColorPicker",
      "btProjectId", "btProjectName", "projectBusinessTrip", "projectBusinessTripStart", "projectBusinessTripEnd", "businessTripPersons",
      "syncPersonsList", "syncPersonsStatus", "leavePersonName", "leaveType", "leaveStart", "leaveEnd",
      "projectTitle", "defaultAssignDays", "dingAppKey", "dingAppSecret", "dingTestResult",
      "identityBody", "refreshIdentityBtn", "bindAllIdentityBtn",
      "themePrimary", "deptColorGrid", "statusColorGrid", "tripUpcomingColor", "tripActiveColor", "leaveActiveColor", "leaveUpcomingColor", "conflictColor",
      "easyaiAdminUsername", "easyaiAdminPassword", "easyaiAdminCredentialsStatus", "easyaiTestResult"
    ].forEach((id) => els[id] = document.getElementById(id));
  }

  function installIcons() {
    document.querySelectorAll("[data-icon]").forEach((el) => el.innerHTML = Icons.svg(el.dataset.icon));
    document.querySelectorAll("[data-nav-icon]").forEach((el) => el.insertAdjacentHTML("afterbegin", Icons.svg(el.dataset.navIcon)));
  }

  function bind() {
    byId("addProjectBtn").addEventListener("click", () => openProjectModal());
    byId("globalSyncBtn").addEventListener("click", openGlobalSyncModal);
    byId("globalSyncLogsBtn").addEventListener("click", openGlobalSyncLogs);
    els.globalSyncPreviewBtn.addEventListener("click", previewGlobalSync);
    els.globalSyncRunBtn.addEventListener("click", runGlobalSync);
    els.actionConfirmBtn.addEventListener("click", async () => {
      const action = state.confirmAction;
      state.confirmAction = null;
      els.actionConfirmBtn.disabled = true;
      closeModal("actionConfirmModal");
      try { if (action) await action(); }
      finally { els.actionConfirmBtn.disabled = false; }
    });
    byId("syncPersonsBtn").addEventListener("click", openSyncPersonsModal);
    byId("bindPersonsBtn").addEventListener("click", openBindingModal);
    byId("configBtn").addEventListener("click", openConfigModal);
    byId("syncLeaveBtn").addEventListener("click", syncLeaveNow);
    byId("exportJsonBtn").addEventListener("click", downloadJsonExport);
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
    byId("testEasyAIKeyBtn").addEventListener("click", testEasyAIConnection);
    els.refreshIdentityBtn.addEventListener("click", refreshIdentities);
    els.bindAllIdentityBtn.addEventListener("click", bindAllIdentities);
    byId("saveEasyAICredentialsBtn").addEventListener("click", saveEasyAICredentials);
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

  function openBindingModal() {
    openModal("bindingModal");
    loadIdentities();
  }

  async function loadIdentities() {
    if (!els.identityBody) return;
    try {
      const rows = await fetchJson("api/project-sync/identities");
      state.identityByDingId = new Map(rows.filter((row) => row.dingtalk_user_id).map((row) => [String(row.dingtalk_user_id), row]));
      if (!rows.length) {
        els.identityBody.innerHTML = `<tr><td colspan="5" class="table-empty">暂无身份记录。先执行项目同步预览或同步钉钉人员。</td></tr>`;
        return;
      }
      els.identityBody.innerHTML = rows.map((row) => {
        const id = row.dingtalk_user_id || row.dingtalk_union_id || row.dingtalk_open_id || "缺失";
        const bound = row.easyai_user_id || "未绑定";
        const status = row.name_changed ? "已绑定 · 昵称已变化" : (row.match_status || "unmatched");
        const action = row.easyai_user_id ? `<button class="btn btn-sm" data-unbind-identity="${esc(row.dashboard_user_id)}">解除绑定</button>` : "待确认";
        return `<tr><td>${esc(row.display_name || row.dashboard_user_id)}</td><td>${esc(id)}</td><td>${esc(bound)}</td><td>${esc(status)}</td><td>${action}</td></tr>`;
      }).join("");
      els.identityBody.querySelectorAll("[data-unbind-identity]").forEach((button) => button.addEventListener("click", async () => {
        if (!confirm("解除该身份绑定？不会删除 wowidea 用户，也不会修改其组织。")) return;
        const result = await fetchJson(`api/project-sync/identities/${encodeURIComponent(button.dataset.unbindIdentity)}/unbind`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operatorId: "local-admin" }) });
        toast(result.success ? "身份绑定已解除" : (result.message || "解除失败"));
        await loadIdentities();
      }));
    } catch (error) {
      els.identityBody.innerHTML = `<tr><td colspan="5" class="table-empty">${esc(error.message || "读取失败")}</td></tr>`;
    }
  }

  async function refreshIdentities() {
    const result = await fetchJson("api/project-sync/identities/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operatorId: "local-admin" }) }).catch((error) => ({ success: false, message: error.message }));
    if (!result.success) return toast(result.message || "身份盘点失败");
    toast(`身份盘点完成：已绑定 ${result.matched}，候选 ${result.candidate}，未匹配 ${result.unmatched}，冲突 ${result.conflict}`);
    await loadIdentities();
    if (state.syncUsers.length) renderSyncUsers();
  }

  async function bindAllIdentities() {
    const preview = await fetchJson("api/project-sync/identities/preview", { method: "POST" }).catch((error) => ({ success: false, message: error.message }));
    if (!preview.success) return toast(preview.message || "无法生成身份绑定预览");
    openActionConfirm("确认批量身份绑定", `全量身份绑定预览\n\n共 ${preview.total} 人\n新增可绑定 ${preview.bindable} 人\n已有绑定 ${preview.existingBound ?? (preview.matched - preview.bindable)} 人\n昵称候选 ${preview.candidate} 人\n冲突 ${preview.conflict} 人\n未匹配 ${preview.unmatched} 人\n\n确认后只绑定唯一稳定 ID 匹配，不按昵称误绑，不修改 wowidea 原组织。`, async () => {
      const result = await fetchJson("api/project-sync/identities/bind-all", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operatorId: "local-admin" }) }).catch((error) => ({ success: false, message: error.message }));
      if (!result.success) return toast(result.message || "批量绑定失败");
      toast(`批量绑定完成：新增绑定 ${result.newBound ?? result.bound}，已有绑定 ${result.existingBound ?? 0}，冲突 ${result.conflict}，未匹配 ${result.unmatched}`);
      await loadIdentities();
    });
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
      els.projectBody.innerHTML = `<tr><td colspan="8" class="table-empty">暂无项目</td></tr>`;
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
        <td><span class="tag" data-sync-status="${esc(p.id)}">读取中</span></td>
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
    loadProjectSyncStatuses();
  }

  async function loadProjectSyncStatuses() {
    await Promise.all(state.projects.map(async (project) => {
      const tag = els.projectBody.querySelector(`[data-sync-status="${CSS.escape(String(project.id))}"]`);
      if (!tag) return;
      try {
        const data = await fetchJson(`api/project-sync/${encodeURIComponent(project.id)}/status`);
        const binding = data.binding;
        const simulated = data.simulated;
        tag.textContent = binding?.status === "active" ? (simulated ? `${binding.organization_name} · 模拟模式，未写入 wowidea.top` : `${binding.organization_name} · 已绑定`) : (binding?.status === "error" ? "同步错误" : "未绑定");
        tag.className = `tag ${binding?.status === "active" ? (simulated ? "tag-warning" : "tag-primary") : binding?.status === "error" ? "tag-danger" : ""}`;
        tag.title = simulated ? "当前为模拟模式，组织 ID 仅存在于本地，未写入 wowidea.top" : (binding?.last_error || binding?.easyai_org_id || "");
      } catch {
        tag.textContent = "不可用";
      }
    }));
  }

  async function syncProjectToEasyAI(projectId) {
    const project = state.projects.find((item) => String(item.id) === String(projectId));
    if (!project) return;
    try {
      const preview = await fetchJson(`api/project-sync/${encodeURIComponent(projectId)}/preview`, { method: "POST" });
      if (!preview.success) return toast(preview.message || "无法生成同步预览");
      const confirmed = confirm(`同步项目“${project.name}”？\n\n新增成员 ${preview.added || 0} 人，已在项目组织 ${preview.existing || 0} 人，未匹配 ${preview.unmatched || 0} 人，身份冲突 ${preview.conflict || 0} 人。\n\n只绑定已有平台账号并追加组织关系，不创建账号、不修改登录名、密码、历史数据或已有组织。\n\n本地默认使用 Mock 模式；真实 API 写入必须显式配置绑定接口。`);
      if (!confirmed) return;
      const result = await fetchJson(`api/project-sync/${encodeURIComponent(projectId)}/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trigger: "manual", operatorId: "local-admin" }) });
      toast(result.success ? (result.simulated ? `模拟同步完成：未写入 wowidea.top；新增 ${result.added || 0} 人，已存在 ${result.existing || 0} 人，未匹配 ${result.unmatched || 0} 人` : `同步完成：新增 ${result.added || 0} 人，已存在 ${result.existing || 0} 人，未匹配 ${result.unmatched || 0} 人`) : (result.message || "同步失败"));
      await loadProjectSyncStatuses();
    } catch (error) {
      toast(error.message || "同步失败");
    }
  }

  function openGlobalSyncModal() {
    els.globalSyncSummary.textContent = "点击“生成预览”读取当前项目组织和成员差异。离开成员将从对应组织移除；符合归属和安全条件的已删除项目组织将执行清理。";
    els.globalSyncBody.innerHTML = `<tr><td colspan="5" class="table-empty">尚未生成预览</td></tr>`;
    els.globalSyncRunBtn.disabled = true;
    openModal("globalSyncModal");
    previewGlobalSync();
  }

  function renderGlobalSyncPreview(data) {
    const totals = data.totals || {};
    els.globalSyncSummary.textContent = `当前项目 ${data.projects?.length || 0} 个：新增组织 ${totals.create_org || 0}，改名 ${totals.rename_org || 0}，新增成员 ${totals.added || 0}，已存在 ${totals.existing || 0}，待移除成员 ${totals.removed || 0}，未匹配 ${totals.unmatched || 0}，冲突 ${totals.conflict || 0}，待处理清理 ${totals.pending_delete || 0}。`;
    els.globalSyncBody.innerHTML = (data.projects || []).map((item) => {
      const p = item.project || { id: item.project_id, name: item.project_name };
      const orgName = item.binding?.organization_name || item.organization_name || item.org_name;
      const org = item.organization_action === "create" ? "待创建" : item.organization_action === "pending_delete" ? "项目已删除" : (orgName || "已绑定");
      const member = `新增 ${item.added || 0} / 已存在 ${item.existing || 0}`;
      const issues = `冲突 ${item.conflict || 0} / 未匹配 ${item.unmatched || 0}`;
      const removal = item.organization_action === "pending_delete" ? `项目已删除 · 待清理（成员 ${item.removed || 0}）` : `移除离开成员 ${item.removed || 0} 人`;
      return `<tr><td>${esc(p.name || p.id)}</td><td>${esc(org)}${item.name_action === "rename" ? " · 待改名" : ""}</td><td>${member}</td><td>${issues}</td><td>${removal}</td></tr>`;
    }).join("") || `<tr><td colspan="5" class="table-empty">暂无项目</td></tr>`;
    els.globalSyncRunBtn.disabled = !data.projects?.length;
  }

  async function previewGlobalSync() {
    els.globalSyncPreviewBtn.disabled = true;
    try {
      const data = await fetchJson("api/project-sync/global/preview", { method: "POST" });
      if (!data.success) throw new Error(data.message || "生成预览失败");
      state.globalSyncPreview = data;
      renderGlobalSyncPreview(data);
    } catch (error) {
      els.globalSyncSummary.textContent = error.message || "生成预览失败";
      els.globalSyncRunBtn.disabled = true;
    } finally {
      els.globalSyncPreviewBtn.disabled = false;
    }
  }

  async function runGlobalSync() {
    if (!state.globalSyncPreview) return previewGlobalSync();
    const totals = state.globalSyncPreview.totals || {};
    openActionConfirm("确认执行全局同步", `确认执行全局同步？\n\n新增组织 ${totals.create_org || 0}，新增成员 ${totals.added || 0}，将移除成员 ${totals.removed || 0}，待处理清理 ${totals.pending_delete || 0}。\n\n系统会按归属和安全校验执行成员移除及符合条件的组织清理。`, async () => {
      els.globalSyncRunBtn.disabled = true;
      try {
        const result = await fetchJson("api/project-sync/global/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operatorId: "local-admin" }) });
        if (!result.success) throw new Error(result.message || "全局同步失败");
        const t = result.totals || {};
        toast(`全局同步完成：新增成员 ${t.added || 0}，移除成员 ${t.removed || 0}，失败项目 ${t.failed || 0}，待处理清理 ${t.pending_delete || 0}`);
        renderGlobalSyncPreview({ projects: result.projects, totals: t });
        await loadAll();
      } catch (error) { toast(error.message || "全局同步失败"); }
      finally { els.globalSyncRunBtn.disabled = false; }
    });
  }

  function openActionConfirm(title, body, action) {
    state.confirmAction = action;
    els.actionConfirmTitle.textContent = title;
    els.actionConfirmBody.textContent = body;
    openModal("actionConfirmModal");
  }

  async function openGlobalSyncLogs() {
    els.globalSyncLogsBody.innerHTML = `<tr><td colspan="8" class="table-empty">读取中</td></tr>`;
    openModal("globalSyncLogsModal");
    try {
      const rows = await fetchJson("api/project-sync/global/logs");
      els.globalSyncLogsBody.innerHTML = rows.length ? rows.map((row) => {
        const t = row.totals || {};
        const time = row.started_at ? new Date(Number(row.started_at)).toLocaleString() : "-";
        return `<tr><td>${esc(time)}</td><td>${esc(row.status || "-")}</td><td>${t.added ?? row.added_count ?? 0}</td><td>${t.existing ?? row.existing_count ?? 0}</td><td>${t.removed ?? row.removed_count ?? 0}</td><td>${t.unmatched ?? row.unmatched_count ?? 0}</td><td>${t.conflict ?? row.conflict_count ?? 0}</td><td>${t.pending_delete ?? 0}</td></tr>`;
      }).join("") : `<tr><td colspan="8" class="table-empty">暂无全局同步日志</td></tr>`;
    } catch (error) {
      els.globalSyncLogsBody.innerHTML = `<tr><td colspan="7" class="table-empty">${esc(error.message || "读取失败")}</td></tr>`;
    }
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
    els.personList.querySelectorAll("[data-toggle-board]").forEach((input) => input.addEventListener("change", () => togglePersonOnBoard(input.dataset.toggleBoard, input.checked)));
  }

  async function togglePersonOnBoard(personId, visible) {
    const person = state.persons.find((item) => String(item.id) === String(personId));
    if (!person) return;
    try {
      const response = await fetch(`api/persons/${encodeURIComponent(personId)}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: person.name, groupType: person.group_type, avatar: person.avatar || "", dingId: person.ding_id || "", unionId: person.dingtalk_union_id || "", department: person.department || "", selected: visible, sortOrder: person.sort_order || 0, leaveStatus: person.leave_status || "", leaveStart: person.leave_start || "", leaveEnd: person.leave_end || "", leaveType: person.leave_type || "" })
      });
      if (!response.ok) throw new Error("保存失败");
      person.selected = visible ? 1 : 0;
      toast(visible ? "已显示在前台看板" : "已从前台看板隐藏");
    } catch (error) {
      toast(error.message || "显示设置保存失败");
      renderPersons();
    }
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
      <label class="board-visibility-toggle"><input type="checkbox" data-toggle-board="${esc(person.id)}" ${person.selected !== 0 && person.selected !== false ? "checked" : ""}>前台显示</label>
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
    try {
      const result = await fetchJson(url, { method: state.editingProjectId ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!result.success) throw new Error(result.message || result.syncError || "项目保存失败");
      if (result.syncError) toast(`项目已保存，但组织同步待重试：${result.syncError}`);
      else toast("项目已保存");
    } catch (error) { return toast(error.message || "项目保存失败"); }
    closeModal("projectModal");
    await loadAll();
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
    const selectedId = state.businessTripProjectId || els.btProjectId?.value;
    return state.projects.find((p) => String(p.id ?? p.project_id) === String(selectedId));
  }

  function renderBusinessTripPersonPicker(project) {
    const enabled = els.projectBusinessTrip.checked;
    els.businessTripPersons.style.display = enabled ? "grid" : "none";
    if (!enabled) return;
    const selected = new Set(parseJsonArray(project?.business_trip_persons ?? project?.businessTripPersons).map(String));
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
    try {
      const result = await fetchJson(`api/projects/${encodeURIComponent(project.id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!result.success) throw new Error(result.message || "出差信息保存失败");
    } catch (error) { return toast(error.message || "出差信息保存失败"); }
    closeModal("businessTripModal");
    await loadAll();
    toast("出差信息已保存");
  }

  async function deleteProject(id) {
    const project = state.projects.find((item) => String(item.id) === String(id));
    openActionConfirm("确认删除项目", `将删除项目“${project?.name || id}”及其本地分配。\n\n系统会尝试清理对应的 Dashboard 组织；若组织清理失败，本地删除仍会完成，但会明确标记待重试。`, async () => {
      try {
        const result = await fetchJson(`api/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
        if (!result.success) throw new Error(result.message || "项目删除失败");
        await loadAll();
        const sync = result.sync || {};
        if (sync.success === false || sync.retryable) return toast(`项目本地已删除，但组织清理失败或待重试：${sync.error || sync.cleanup?.error || "请执行全局同步重试"}`);
        toast("项目及对应组织清理已完成");
      } catch (error) { toast(error.message || "项目删除失败"); }
    });
  }

  async function deletePerson(id) {
    if (!confirm("确定删除此人员及其全部分配吗？")) return;
    try {
      const result = await fetchJson(`api/persons/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!result.success) throw new Error(result.message || "人员删除失败");
    } catch (error) { return toast(error.message || "人员删除失败"); }
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
    try {
      const result = await fetchJson("api/leave/set", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ personId: state.editingLeavePersonId, leaveStatus: els.leaveType.value, leaveType: els.leaveType.value, leaveStart: els.leaveStart.value, leaveEnd: els.leaveEnd.value }) });
      if (!result.success) throw new Error(result.message || "请假记录保存失败");
    } catch (error) { return toast(error.message || "请假记录保存失败"); }
    closeModal("leaveModal");
    await loadAll();
    toast("请假记录已保存");
  }

  async function clearLeave() {
    try {
      const result = await fetchJson("api/leave/set", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ personId: state.editingLeavePersonId, leaveStatus: "", leaveType: "", leaveStart: "", leaveEnd: "" }) });
      if (!result.success) throw new Error(result.message || "请假状态清空失败");
    } catch (error) { return toast(error.message || "请假状态清空失败"); }
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
    els.easyaiAdminUsername.value = state.config.easyai_admin_username || "";
    els.easyaiAdminPassword.value = "";
    const credentialsConfigured = !!state.config.easyai_admin_credentials_configured;
    els.easyaiAdminCredentialsStatus.textContent = credentialsConfigured ? "已配置" : "未配置";
    els.easyaiAdminCredentialsStatus.className = `tag ${credentialsConfigured ? "tag-primary" : ""}`;
    els.easyaiTestResult.style.display = "none";
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
    if (saveRow) saveRow.style.display = hasDing ? "none" : "flex";
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
    const response = await fetch("api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ding_appKey: appKey, ding_appSecret: appSecret }) });
    if (!response.ok) return toast("钉钉配置保存失败");
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
    const currentDingAppKey = els.dingAppKey.readOnly ? (state.config.ding_appKey || "") : els.dingAppKey.value.trim();
    const currentDingAppSecret = els.dingAppSecret.readOnly ? (state.config.ding_appSecret || "") : els.dingAppSecret.value.trim();
    const body = {
      project_title: els.projectTitle.value.trim() || "Claw 项目排期看板",
      default_assign_days: els.defaultAssignDays.value || "1",
      ding_appKey: currentDingAppKey,
      ding_appSecret: currentDingAppSecret,
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
    const response = await fetch("api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) return toast("配置保存失败");
    const safeBody = { ...body };
    window.ThemeStore?.save({ ...state.config, ...safeBody });
    closeModal("configModal");
    await loadAll();
    toast("配置已保存");
  }

  async function saveEasyAICredentials() {
    const username = els.easyaiAdminUsername.value.trim();
    const password = els.easyaiAdminPassword.value;
    if (!username || !password) return toast("请填写管理员账号和密码");
    const body = { easyai_admin_username: username, easyai_admin_password: password };
    try {
      const response = await fetch("api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!response.ok) throw new Error("保存失败");
      await loadAll();
      els.easyaiAdminPassword.value = "";
      toast("管理员账号已保存");
    } catch (error) {
      toast(error.message || "管理员账号保存失败");
    }
  }

  async function testEasyAIConnection() {
    els.easyaiTestResult.style.display = "inline-flex";
    els.easyaiTestResult.textContent = "正在测试...";
    try {
      const data = await fetchJson("api/easyai/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      els.easyaiTestResult.textContent = data.message || (data.success ? "连接成功" : "连接失败");
      els.easyaiTestResult.className = `tag ${data.success ? "tag-primary" : "tag-danger"}`;
    } catch (error) {
      els.easyaiTestResult.textContent = error.message || "连接失败";
      els.easyaiTestResult.className = "tag tag-danger";
    }
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
    await refreshIdentities();
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
    if (id === "actionConfirmModal") state.confirmAction = null;
  }

  async function downloadJsonExport() {
    try {
      const frame = document.createElement("iframe");
      frame.hidden = true;
      frame.src = "api/export";
      document.body.appendChild(frame);
      window.setTimeout(() => frame.remove(), 60000);
      toast("JSON 导出已开始下载");
    } catch (error) { toast(error.message || "JSON 导出失败"); }
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
      return response.text().then((text) => {
        let body = {};
        try { body = text ? JSON.parse(text) : {}; } catch (_) { body = {}; }
        if (!response.ok) throw new Error(body.message || `${response.status} ${response.statusText}`);
        return body;
      });
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
