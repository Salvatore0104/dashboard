(function () {
  const DAY_MS = 86400000;

  // 中国法定节假日（2025-2030）
  const HOLIDAYS = new Map();
  const addHolidays = (year, list, nameFn) => {
    list.split(",").forEach(d => {
      const m = d.slice(0,2), day = d.slice(2);
      HOLIDAYS.set(`${year}-${m}-${day}`, nameFn(m, parseInt(day)));
    });
  };
  // 节日名称判断
  const H = (m, d) => {
    if (m === "01") return "元旦";
    if (m === "02") return "春节";
    if (m === "04") return "清明";
    if (m === "05" && d <= 5) return "劳动节";
    if (m === "05" || m === "06") return "端午";
    if (m === "09") return "中秋";
    return "国庆";
  };
  // 2025: 元旦1.1, 春节1.28-2.4, 清明4.4-4.6, 劳动节5.1-5.5, 端午5.31-6.2, 国庆中秋10.1-10.8
  addHolidays(2025, "0101,0128,0129,0130,0131,0201,0202,0203,0204,0404,0405,0406,0501,0502,0503,0504,0505,0531,0601,0602,1001,1002,1003,1004,1005,1006,1007,1008", H);
  // 2026: 元旦1.1-1.3, 春节2.16-2.22, 清明4.5-4.6, 劳动节5.1-5.5, 端午6.19-6.21, 中秋9.25-9.26, 国庆10.1-10.7
  addHolidays(2026, "0101,0102,0103,0216,0217,0218,0219,0220,0221,0222,0405,0406,0501,0502,0503,0504,0505,0619,0620,0621,0925,0926,1001,1002,1003,1004,1005,1006,1007", H);
  // 2027: 元旦1.1-1.3, 春节2.5-2.11(除夕2.5), 清明4.5, 劳动节5.1-5.5, 端午6.7-6.9, 中秋9.15-9.17, 国庆10.1-10.7
  addHolidays(2027, "0101,0102,0103,0205,0206,0207,0208,0209,0210,0211,0405,0501,0502,0503,0504,0505,0607,0608,0609,0915,0916,0917,1001,1002,1003,1004,1005,1006,1007", H);
  // 2028: 元旦1.1-1.3, 春节1.25-1.31(除夕1.25), 清明4.4-4.5, 劳动节5.1-5.5, 端午5.27-5.29, 中秋+国庆9.30-10.7(中秋10.3)
  addHolidays(2028, "0101,0102,0103,0125,0126,0127,0128,0129,0130,0131,0404,0405,0501,0502,0503,0504,0505,0527,0528,0529,0930,1001,1002,1003,1004,1005,1006,1007", H);
  // 2029: 元旦1.1-1.3, 春节2.12-2.18(除夕2.12), 清明4.4-4.5, 劳动节5.1-5.5, 端午6.15-6.17, 中秋9.21-9.23, 国庆10.1-10.7
  addHolidays(2029, "0101,0102,0103,0212,0213,0214,0215,0216,0217,0218,0404,0405,0501,0502,0503,0504,0505,0615,0616,0617,0921,0922,0923,1001,1002,1003,1004,1005,1006,1007", H);
  // 2030: 元旦1.1-1.3, 春节2.2-2.8(除夕2.2), 清明4.4-4.5, 劳动节5.1-5.5, 端午6.4-6.6, 中秋9.11-9.13, 国庆10.1-10.7
  addHolidays(2030, "0101,0102,0103,0202,0203,0204,0205,0206,0207,0208,0404,0405,0501,0502,0503,0504,0505,0604,0605,0606,0911,0912,0913,1001,1002,1003,1004,1005,1006,1007", H);

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

  // 部门默认颜色池（与 admin.js 保持一致）
  const DEPT_DEFAULT_COLORS = [
    "#6366f1", "#8b5cf6", "#a855f7",
    "#3b82f6", "#06b6d4", "#0ea5e9",
    "#10b981", "#059669", "#14b8a6",
    "#f59e0b", "#d97706", "#ea580c",
    "#ec4899", "#f43f5e", "#dc2626",
    "#64748b", "#475569", "#334155"
  ];

  const defaultState = {
    projects: [],
    persons: [],
    assignments: [],
    config: {},
    displayDays: 30,
    viewOffset: 0,
    colWidth: 42,
    selectedPersons: new Set(),
    selectedBars: new Set(),
    collapsedDepts: new Set(),
    deleteMode: false,
    readonly: false,
    sse: null,
    sseTimer: null,
    sseDelay: 5000,
    renderQueued: false,
    resizeTimer: null,
    syncTimer: null,
    drop: { placeholder: null, row: null, active: false },
    dateDrag: { active: false, startX: 0, startOffset: 0, raf: 0 },
    barDrag: null,
    personDrag: null,
    hoverPersonId: null,
    mouseBound: false
  };

  class BoardApp {
    constructor(options) {
      this.options = options;
      this.state = { ...defaultState, readonly: !!options.readonly };
      this.root = document.getElementById(options.rootId || "boardRoot");
      this.today = startOfDay(new Date());
      this.els = {};
    }

    init() {
      this.cacheEls();
      this.installShell();
      this.bindStaticEvents();
      this.loadData();
      this.connectSSE();
      this.loadSyncStatus();
    }

    cacheEls() {
      this.els.title = document.getElementById("navTitle");
      this.els.todayTag = document.getElementById("todayTag");
      this.els.gantt = document.getElementById("gantt");
      this.els.wrapper = document.getElementById("ganttWrapper");
      this.els.personPool = document.getElementById("personPool");
      this.els.personChips = document.getElementById("personChips");
      this.els.deleteModeBtn = document.getElementById("deleteModeBtn");
      this.els.daySelect = document.getElementById("daySelect");
      this.els.updateTime = document.getElementById("updateTime");
      this.els.syncStatus = document.getElementById("syncStatusBar");
    }

    installShell() {
      document.body.classList.toggle("readonly", this.state.readonly);
      if (this.state.readonly) {
        this.els.personPool?.classList.add("hidden");
        this.els.deleteModeBtn?.remove();
      }
      if (this.els.daySelect) this.els.daySelect.value = String(this.state.displayDays);
    }

    bindStaticEvents() {
      document.getElementById("refreshBtn")?.addEventListener("click", () => this.loadData());
      document.getElementById("resetBtn")?.addEventListener("click", () => {
        this.state.viewOffset = 0;
        this.render();
      });
      this.els.daySelect?.addEventListener("change", () => {
        this.state.displayDays = parseInt(this.els.daySelect.value, 10) || 30;
        this.render();
      });
      this.els.deleteModeBtn?.addEventListener("click", () => {
        this.state.deleteMode = !this.state.deleteMode;
        this.els.deleteModeBtn.classList.toggle("active", this.state.deleteMode);
        this.render();
      });
      this.els.personChips?.addEventListener("mouseover", (event) => {
        const chip = event.target.closest(".person-chip");
        if (chip) this.setPersonHover(chip.dataset.personId);
      });
      this.els.personChips?.addEventListener("mouseout", (event) => {
        if (event.target.closest(".person-chip") && !this.els.personChips.contains(event.relatedTarget)) this.clearPersonHover();
      });
      window.addEventListener("resize", () => {
        clearTimeout(this.state.resizeTimer);
        this.state.resizeTimer = setTimeout(() => this.render(), 120);
      });
      window.addEventListener("beforeunload", () => this.destroy());
      document.addEventListener("click", (event) => {
        if (!event.target.closest(".person-chip") && !event.target.closest(".bar")) {
          this.clearBarSelection();
        }
      });
      this.bindDocumentMouse();
    }

    bindDocumentMouse() {
      if (this.state.mouseBound) return;
      this.state.mouseBound = true;
      document.addEventListener("mousemove", (event) => {
        if (this.state.barDrag?.source === "mouse") this.handleBarMouseMove(event);
        this.handleDateMouseMove(event);
        this.handlePersonHoverMove(event);
      });
      document.addEventListener("mouseup", (event) => {
        if (this.state.barDrag?.source === "mouse") this.handleBarMouseUp(event);
        this.handleDateMouseUp(event);
      });
      document.addEventListener("pointermove", (event) => this.handlePersonPointerMove(event), { passive: false });
      document.addEventListener("pointermove", (event) => {
        if (this.state.barDrag?.source !== "mouse") this.handleBarMouseMove(event);
      }, { passive: false });
      document.addEventListener("pointermove", (event) => this.handlePersonHoverMove(event), { passive: true });
      document.addEventListener("pointerup", (event) => this.handlePersonPointerUp(event));
      document.addEventListener("pointerup", (event) => {
        if (this.state.barDrag?.source !== "mouse") this.handleBarMouseUp(event);
      });
      document.addEventListener("pointercancel", (event) => this.handlePersonPointerUp(event));
      document.addEventListener("pointercancel", (event) => {
        if (this.state.barDrag?.source !== "mouse") this.handleBarMouseUp(event);
      });
    }

    async loadData() {
      try {
        const [projects, persons, assignments, config] = await Promise.all([
          fetchJson("api/projects"),
          fetchJson("api/persons"),
          fetchJson("api/assignments"),
          fetchJson("api/config").catch(() => ({}))
        ]);
        this.state.projects = projects;
        this.state.persons = persons;
        this.state.assignments = assignments;
        this.state.config = config || {};
        window.ThemeStore?.save(this.state.config);
        this.applyConfig();
        this.render();
        if (this.els.updateTime) {
          this.els.updateTime.textContent = this.state.readonly
            ? `只读看板 · 最后更新 ${new Date().toLocaleTimeString("zh-CN")}`
            : `最后更新 ${new Date().toLocaleTimeString("zh-CN")}`;
        }
      } catch (error) {
        this.showEmpty(`数据加载失败：${error.message}`);
      }
    }

    applyConfig() {
      const title = this.state.config.project_title || "Claw 项目排期看板";
      document.title = title;
      if (this.els.title) {
        this.els.title.textContent = title;
        this.els.title.classList.remove("loading");
      }
      this.defaultAssignDays = clamp(parseInt(this.state.config.default_assign_days, 10) || 1, 1, 30);
      // 收集所有 dept_color_ 开头的配置项
      const deptColors = {};
      for (const [key, value] of Object.entries(this.state.config)) {
        if (key.startsWith("dept_color_")) deptColors[key] = value;
      }
      this.colors = {
        pre: this.state.config.pre_person_color || "#2563eb",
        post: this.state.config.post_person_color || "#16a34a",
        tripUpcoming: this.state.config.trip_upcoming_color || "#15803d",
        tripActive: this.state.config.trip_active_color || "#c2410c",
        leaveActive: this.state.config.leave_active_color || "#dc2626",
        leaveUpcoming: this.state.config.leave_upcoming_color || "#2563eb",
        conflict: this.state.config.conflict_color || "#dc2626",
        conflictOpacity: (parseInt(this.state.config.conflict_opacity, 10) || 30) / 100,
        leave: this.state.config.leave_active_color || "#dc2626",
        trip: this.state.config.trip_active_color || "#c2410c",
        deptColors
      };
      // 把状态颜色写入 CSS 变量，供 styles.css 中的标签和 chip 使用
      document.documentElement.style.setProperty("--trip-upcoming", this.colors.tripUpcoming);
      document.documentElement.style.setProperty("--trip-active", this.colors.tripActive);
      document.documentElement.style.setProperty("--leave-active", this.colors.leaveActive);
      document.documentElement.style.setProperty("--leave-upcoming", this.colors.leaveUpcoming);
      // 同时也更新甘特条用到的颜色变量
      document.documentElement.style.setProperty("--trip", this.colors.tripActive);
      document.documentElement.style.setProperty("--leave", this.colors.leaveActive);
      this.applyTheme(this.state.config.theme_primary || this.state.config.primary_color || "#3157d5");
      // 显示 brand-mark（去掉 loading 类）
      document.querySelector(".brand-mark")?.classList.remove("loading");
    }

    applyTheme(primary) {
      document.documentElement.style.setProperty("--primary", primary);
      document.documentElement.style.setProperty("--primary-2", shadeColor(primary, -18));
      document.documentElement.style.setProperty("--primary-soft", rgba(primary, 0.12));
    }

    connectSSE() {
      this.disconnectSSE();
      const source = new EventSource("api/events");
      this.state.sse = source;
      const reload = () => this.queueLoad();
      source.addEventListener("projects_changed", reload);
      source.addEventListener("persons_changed", () => {
        this.queueLoad();
        this.loadSyncStatus();
      });
      source.addEventListener("assignments_changed", reload);
      source.addEventListener("config_changed", reload);
      source.onopen = () => {
        this.state.sseDelay = 5000;
      };
      source.onerror = () => {
        this.disconnectSSE();
        this.state.sseTimer = setTimeout(() => this.connectSSE(), this.state.sseDelay);
        this.state.sseDelay = Math.min(this.state.sseDelay * 2, 60000);
      };
    }

    disconnectSSE() {
      if (this.state.sseTimer) clearTimeout(this.state.sseTimer);
      this.state.sseTimer = null;
      if (this.state.sse) this.state.sse.close();
      this.state.sse = null;
    }

    queueLoad() {
      if (this.state.renderQueued) return;
      this.state.renderQueued = true;
      setTimeout(() => {
        this.state.renderQueued = false;
        this.loadData();
      }, 120);
    }

    async loadSyncStatus() {
      if (!this.els.syncStatus) return;
      try {
        const data = await fetchJson("api/leave/schedule");
        this.syncMeta = {
          enabled: data.enabled !== false,
          intervalHours: data.intervalHours || 4,
          lastSyncTime: data.lastSyncTime || 0
        };
        this.els.syncStatus.style.display = "inline-flex";
        this.updateSyncCountdown();
        if (this.state.syncTimer) clearInterval(this.state.syncTimer);
        this.state.syncTimer = setInterval(() => this.updateSyncCountdown(), 1000);
      } catch {
        this.els.syncStatus.style.display = "none";
      }
    }

    updateSyncCountdown() {
      const el = this.els.syncStatus;
      if (!el || !this.syncMeta) return;
      const textEl = el.querySelector("[data-sync-text]");
      const countEl = el.querySelector("[data-sync-countdown]");
      if (!this.syncMeta.enabled) {
        if (textEl) textEl.textContent = "请假同步已暂停";
        if (countEl) countEl.textContent = "";
        return;
      }
      if (!this.syncMeta.lastSyncTime) {
        if (textEl) textEl.textContent = `每 ${this.syncMeta.intervalHours} 小时同步`;
        if (countEl) countEl.textContent = "等待首次同步";
        return;
      }
      const elapsed = Date.now() - this.syncMeta.lastSyncTime;
      const total = this.syncMeta.intervalHours * 3600 * 1000;
      const remaining = Math.max(0, total - elapsed);
      if (textEl) textEl.textContent = `每 ${this.syncMeta.intervalHours} 小时同步`;
      if (countEl) countEl.textContent = formatDuration(remaining);
    }

    render() {
      if (!this.els.wrapper || !this.els.gantt) return;
      this.state.selectedBars.clear();
      const model = this.buildModel();
      this.renderPersonPool(model);
      this.renderGantt(model);
    }

    buildModel() {
      const baseDate = addDays(this.today, this.state.viewOffset);
      this.currentBaseDate = baseDate;
      const dates = Array.from({ length: this.state.displayDays }, (_, index) => {
        const date = addDays(baseDate, index);
        const day = date.getDay();
        const key = dateStr(date);
        const holiday = HOLIDAYS.get(key) || "";
        return {
          date,
          key,
          day: date.getDate(),
          week: "日一二三四五六"[day],
          weekend: day === 0 || day === 6,
          today: sameDate(date, this.today),
          month: date.getMonth() + 1,
          holiday
        };
      });

      const personById = new Map(this.state.persons.map((p) => [String(p.id), p]));
      const assignmentsByProject = groupBy(this.state.assignments, (a) => String(a.project_id));
      const assignmentsByPerson = groupBy(this.state.assignments, (a) => String(a.person_id));
      const sortedPersons = [...this.state.persons].sort((a, b) => {
        const ai = deptIndex(getPersonDept(a));
        const bi = deptIndex(getPersonDept(b));
        if (ai !== bi) return ai - bi;
        return String(a.name || "").localeCompare(String(b.name || ""), "zh-CN");
      });
      const personOrder = new Map(sortedPersons.map((p, index) => [String(p.id), index]));
      const visibleProjects = this.state.projects.filter((project) => {
        const start = parseDate(project.start_date);
        const end = parseDate(project.end_date, true);
        const startOff = dayDiff(baseDate, start);
        const endOff = dayDiff(baseDate, end);
        return !(endOff < 0 || startOff >= this.state.displayDays);
      });

      const availableWidth = Math.max(360, this.els.wrapper.clientWidth - getLeftWidth());
      this.state.colWidth = Math.max(36, Math.floor(availableWidth / this.state.displayDays));

      return { baseDate, dates, personById, assignmentsByProject, assignmentsByPerson, personOrder, visibleProjects };
    }

    renderPersonPool(model) {
      if (this.state.readonly || !this.els.personChips) return;
      const groups = new Map();
      this.state.persons.forEach((person) => {
        const dept = getPersonDept(person);
        if (!groups.has(dept)) groups.set(dept, []);
        groups.get(dept).push(person);
      });
      // 每个部门内排序：已分配人员在前，未分配人员在后
      for (const [dept, persons] of groups) {
        persons.sort((a, b) => {
          const aAssigned = this.isPersonAssigned(a.id, model) ? 0 : 1;
          const bAssigned = this.isPersonAssigned(b.id, model) ? 0 : 1;
          if (aAssigned !== bAssigned) return aAssigned - bAssigned;
          return String(a.name || "").localeCompare(String(b.name || ""), "zh-CN");
        });
      }
      // 按 DEPTS 顺序排列已存在的部门，再追加 DEPTS 中不存在的部门
      const deptOrder = [...new Set([
        ...DEPTS.map(d => d.name).filter(name => groups.has(name)),
        ...[...groups.keys()].filter(name => !DEPTS.some(d => d.name === name))
      ])];
      const html = deptOrder.map((deptName) => {
        const persons = groups.get(deptName) || [];
        if (!persons.length) return "";
        const collapsed = this.state.collapsedDepts.has(deptName);
        const chips = persons.map((person) => this.renderPersonChip(person, model)).join("");
        return `
          <section class="dept-group">
            <button class="dept-head" type="button" data-dept-toggle="${esc(deptName)}">
        <span class="dept-dot" style="background:${esc(getDeptColor(deptName, this.colors))}"></span>
              <span class="dept-name">${esc(deptName)}</span>
              <span class="tag dept-count">${persons.length}人</span>
              ${Icons.svg("chevronDown")}
            </button>
            <div class="dept-chips" ${collapsed ? 'style="display:none"' : ""}>${chips}</div>
          </section>`;
      }).join("");
      this.els.personChips.innerHTML = html || `<div class="empty-state"><div class="empty-box">${Icons.svg("users")}<p>暂无人员，请在后台同步或添加人员。</p></div></div>`;
      this.bindPoolEvents();
    }

    /**
     * 判断人员是否在甘特图当前可见时间范围内有分配
     * 与甘特图显示保持完全一致：baseDate + viewOffset ~ baseDate + viewOffset + displayDays
     */
    isPersonAssigned(personId, model) {
      if (!model) {
        // 降级：没有 model 时退化为简单判断
        return this.state.assignments.some((a) => String(a.person_id) === String(personId));
      }
      const viewStart = model.baseDate;
      const viewEnd = addDays(model.baseDate, this.state.displayDays);
      return this.state.assignments.some((a) => {
        if (String(a.person_id) !== String(personId)) return false;
        const aStart = parseDate(a.start_date);
        const aEnd = parseDate(a.end_date, true);
        // 判断 assignment 时间段是否与可见范围有交集
        return aStart < viewEnd && aEnd >= viewStart;
      });
    }

    /**
     * 构建人员悬浮提示：只显示今日起的信息
     * - 今日起在项目的情况（项目名 + 时间范围）
     * - 今日起的请假信息
     */
    buildPersonTooltip(person) {
      const today = startOfDay(new Date());
      const personId = String(person.id);
      const lines = [];

      // 今日起的项目分配
      const futureAssignments = this.state.assignments
        .filter((a) => String(a.person_id) === personId)
        .filter((a) => {
          const aEnd = parseDate(a.end_date, true);
          return aEnd >= today; // 结束日期在今天或之后
        })
        .sort((a, b) => {
          const aStart = parseDate(a.start_date);
          const bStart = parseDate(b.start_date);
          return aStart - bStart;
        });

      if (futureAssignments.length > 0) {
        lines.push("📋 项目安排：");
        futureAssignments.forEach((a) => {
          const project = this.state.projects.find((p) => String(p.id) === String(a.project_id));
          const pName = project?.name || "未知项目";
          const aStart = parseDate(a.start_date);
          // 显示时，如果 start 在今天之前，从今天开始显示
          const displayStart = aStart < today ? today : aStart;
          lines.push(`  ${pName}  ${dateStr(displayStart)} ~ ${dateStr(parseDate(a.end_date, true))}`);
        });
      } else {
        lines.push("📋 暂无后续项目安排");
      }

      // 今日起的出差信息
      const trip = getPersonTrip(person, this.state.projects);
      if (trip) {
        const isActive = trip.status === "active";
        const label = isActive ? "出差中" : "即将出差";
        const tripDisplayStart = trip.start < today ? today : trip.start;
        lines.push(`✈ ${label}（${trip.projectName}）  ${dateStr(tripDisplayStart)} ~ ${dateStr(trip.end)}`);
      }

      // 今日起的请假信息（只显示今天之后的，不显示历史）
      const leave = getLeaveRange(person);
      if (leave && leave.end >= today) {
        const isCurrentlyOnLeave = leave.start && leave.start <= today;
        const label = isCurrentlyOnLeave ? "请假中" : "即将请假";
        const displayStart = leave.start < today ? today : leave.start;
        lines.push(`🏖 ${label}（${leave.type}）  ${dateStr(displayStart)} ~ ${dateStr(leave.end)}`);
      }

      return lines.join("\n");
    }

    renderPersonChip(person, model) {
      const leave = getLeaveRange(person);
      const trip = getPersonTrip(person, this.state.projects);
      const dept = getPersonDept(person);
      const color = getPersonColor(person, this.colors);
      const selected = this.state.selectedPersons.has(String(person.id));
      const assigned = this.isPersonAssigned(person.id, model);
      // 未分配人员显示绿色标记，已分配人员不显示色块
      const tripCls = trip ? (trip.status === "active" ? "trip" : "trip-upcoming") : "";
      const leaveCls = leave ? (leave.isCurrentlyOnLeave ? "leave" : "leave-upcoming") : "";
      const cls = ["person-chip", selected ? "selected" : "", leaveCls, tripCls, assigned ? "" : "unassigned"].filter(Boolean).join(" ");
      const title = this.buildPersonTooltip(person);
      const dotHtml = assigned ? "" : '<span class="dept-dot dept-dot-unassigned"></span>';
      return `<button class="${cls}" type="button" data-person-id="${esc(person.id)}" title="${esc(title)}">
        ${dotHtml}${esc(person.name || "未命名")}
        ${trip ? `<span class="tag ${trip.status === "active" ? "tag-trip" : "tag-trip-upcoming"}">${trip.status === "active" ? "出差中" : "即将出差"}</span>` : ""}
        ${leave?.isCurrentlyOnLeave ? `<span class="tag tag-leave-active">请假中</span>` : ""}
        ${leave?.isFutureLeave ? '<span class="tag tag-leave-upcoming">即将请假</span>' : ""}
      </button>`;
    }

    bindPoolEvents() {
      this.els.personChips.querySelectorAll("[data-dept-toggle]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const dept = btn.dataset.deptToggle;
          if (this.state.collapsedDepts.has(dept)) this.state.collapsedDepts.delete(dept);
          else this.state.collapsedDepts.add(dept);
          this.render();
        });
      });
      this.els.personChips.querySelectorAll(".person-chip").forEach((chip) => {
        chip.addEventListener("click", (event) => {
          if (chip.dataset.suppressClick === "1") {
            delete chip.dataset.suppressClick;
            return;
          }
          event.stopPropagation();
          const id = String(chip.dataset.personId);
          if (event.ctrlKey || event.metaKey) {
            if (this.state.selectedPersons.has(id)) this.state.selectedPersons.delete(id);
            else this.state.selectedPersons.add(id);
          } else {
            this.state.selectedPersons.clear();
            this.state.selectedPersons.add(id);
          }
          this.renderPersonPool(this.buildModel());
        });
        chip.addEventListener("pointerdown", (event) => this.startPersonPointerDrag(event, chip));
        chip.addEventListener("mouseenter", () => this.setPersonHover(chip.dataset.personId));
        chip.addEventListener("mouseleave", () => this.clearPersonHover());
      });
    }

    renderGantt(model) {
      if (!this.state.projects.length) {
        this.showEmpty(`暂无项目，请先在 <a href="admin.html">后台管理</a> 中添加项目。`);
        return;
      }
      if (this.els.todayTag) this.els.todayTag.textContent = `今日：${dateStr(this.today)}`;
      const left = this.renderLeft(model);
      const right = this.renderRight(model);
      this.els.gantt.innerHTML = left + right;
      this.bindGanttEvents();
    }

    renderLeft(model) {
      let html = `<div class="gantt-left"><div class="gantt-left-head">${Icons.svg("board")}项目 / 人员</div>`;
      for (const project of model.visibleProjects) {
        const trip = getTrip(project);
        const tripTitle = trip ? `出差 ${dateStr(trip.start)} ~ ${dateStr(trip.end)}` : "";
        html += `<div class="gantt-row-label project"><span class="row-dot" style="background:${esc(project.color || "#2563eb")}"></span><span title="${esc(project.name)}">${esc(project.name)}</span>${trip ? `<span class="project-trip-icon" title="${esc(tripTitle)}">${Icons.svg("plane")}</span>` : ""}</div>`;
        const ids = this.getVisiblePersonIds(project, model);
        for (const personId of ids) {
          const person = model.personById.get(String(personId));
          if (!person) continue;
          const leave = getLeaveRange(person);
          const trip = getPersonTrip(person, this.state.projects);
          const color = getPersonColor(person, this.colors);
          html += `<div class="gantt-row-label person" data-person-row="${esc(personId)}" data-project-row="${esc(project.id)}">
            <span class="row-dot" style="background:${esc(color)}"></span><span title="${esc(person.name)}">${esc(person.name)}</span>
            ${trip ? `<span class="tag ${trip.status === "active" ? "tag-trip" : "tag-trip-upcoming"}">${trip.status === "active" ? "出差中" : "即将出差"}</span>` : ""}
            ${leave?.isCurrentlyOnLeave ? `<span class="tag tag-leave-active">请假中</span>` : ""}
            ${leave?.isFutureLeave ? '<span class="tag tag-leave-upcoming">即将请假</span>' : ""}
            ${!this.state.readonly && this.state.deleteMode ? `<button class="btn btn-danger btn-sm" type="button" data-delete-person-row="${esc(personId)}" data-project-id="${esc(project.id)}">${Icons.svg("trash")}</button>` : ""}
          </div>`;
        }
      }
      return html + "</div>";
    }

    renderRight(model) {
      let currentMonth = null;
      const dates = model.dates.map((d) => {
        const monthStart = currentMonth !== d.month;
        currentMonth = d.month;
        return `<div class="date-cell ${d.weekend ? "weekend" : ""} ${d.today ? "today" : ""} ${d.holiday ? "holiday" : ""} ${monthStart ? "month-start" : ""}" style="width:${this.state.colWidth}px">
          ${monthStart ? `<span class="month-label">${d.month}月</span>` : ""}
          <span class="date-num">${d.day}</span><span class="date-week">${d.holiday || d.week}</span>
        </div>`;
      }).join("");
      const bg = model.dates.map((d) => `<div class="bg-col ${d.weekend ? "weekend" : ""} ${d.today ? "today" : ""} ${d.holiday ? "holiday" : ""}" style="width:${this.state.colWidth}px"></div>`).join("");
      let html = `<div class="gantt-right"><div class="gantt-dates" id="dateHeader">${dates}</div><div class="gantt-body"><div class="gantt-bg">${bg}</div>`;
      for (const project of model.visibleProjects) {
        html += this.renderProjectRow(project, model);
        const ids = this.getVisiblePersonIds(project, model);
        for (const personId of ids) {
          html += this.renderPersonRow(project, String(personId), model);
        }
      }
      return html + '</div></div>';
    }

    getVisiblePersonIds(project, model) {
      const projectAssignments = model.assignmentsByProject.get(String(project.id)) || [];
      const groups = groupBy(projectAssignments, (a) => String(a.person_id));
      return [...groups.keys()].filter((personId) => {
        const list = groups.get(personId);
        return !list.every((a) => parseDate(a.end_date, true) < model.baseDate);
      }).sort((a, b) => (model.personOrder.get(String(a)) ?? 9999) - (model.personOrder.get(String(b)) ?? 9999));
    }

    renderProjectRow(project, model) {
      const start = parseDate(project.start_date);
      const end = parseDate(project.end_date, true);
      const startOff = dayDiff(model.baseDate, start);
      const endOff = dayDiff(model.baseDate, end);
      const rowStart = Math.max(0, startOff);
      const rowEnd = Math.min(this.state.displayDays - 1, endOff);
      let bar = "";
      if (rowEnd >= rowStart) {
        const left = rowStart * this.state.colWidth;
        const width = (rowEnd - rowStart + 1) * this.state.colWidth - 4;
        const style = this.buildBarStyle(project.color || "#2563eb", project, null, rowStart, rowEnd, model);
        bar = `<div class="bar project-bar" data-project="${esc(project.id)}" style="left:${left}px;width:${width}px;${style}">
          <span class="bar-label">${esc(project.name)}</span>
        </div>`;
      }
      return `<div class="gantt-row project-drop-row" data-project-id="${esc(project.id)}">${bar}</div>`;
    }

    renderPersonRow(project, personId, model) {
      const person = model.personById.get(String(personId));
      if (!person) return "";
      const list = (model.assignmentsByProject.get(String(project.id)) || [])
        .filter((a) => String(a.person_id) === String(personId))
        .sort((a, b) => parseDate(a.start_date) - parseDate(b.start_date));
      const bars = list.map((assignment) => this.renderAssignmentBar(project, person, assignment, model)).join("");
      return `<div class="gantt-row gantt-row-person" data-project-id="${esc(project.id)}" data-person-row="${esc(personId)}">${bars}</div>`;
    }

    renderAssignmentBar(project, person, assignment, model) {
      const aStart = parseDate(assignment.start_date);
      const aEnd = parseDate(assignment.end_date, true);
      const pStart = parseDate(project.start_date);
      const pEnd = parseDate(project.end_date, true);
      if (!(aStart <= pEnd && aEnd >= pStart)) return "";
      const startOff = dayDiff(model.baseDate, aStart);
      const endOff = dayDiff(model.baseDate, aEnd);
      const rowStart = Math.max(0, startOff);
      const rowEnd = Math.min(this.state.displayDays - 1, endOff);
      if (rowEnd < rowStart || rowStart >= this.state.displayDays || rowEnd < 0) return "";
      const left = rowStart * this.state.colWidth;
      const width = (rowEnd - rowStart + 1) * this.state.colWidth - 4;
      const color = getPersonColor(person, this.colors);
      const style = this.buildBarStyle(color, project, assignment, rowStart, rowEnd, model);
      const leave = getLeaveRange(person);
      const today = startOfDay(new Date());
      const leaveInfo = (leave && leave.end >= today)
        ? `；${leave.start <= today ? "请假中" : "即将请假"}（${leave.type}） ${dateStr(leave.start < today ? today : leave.start)} ~ ${dateStr(leave.end)}`
        : "";
      const title = `${person.name}：${dateStr(aStart)} ~ ${dateStr(aEnd)}${leaveInfo}`;
      return `<div class="bar person-bar" title="${esc(title)}" style="left:${left}px;width:${width}px;${style}" data-assignment="${esc(assignment.id)}" data-person="${esc(person.id)}" data-project="${esc(project.id)}">
        ${!this.state.readonly ? '<span class="bar-resize left" data-dir="left"></span><span class="bar-resize right" data-dir="right"></span>' : ""}
        <span class="bar-label">${esc(person.name)}</span>
      </div>`;
    }

    buildBarStyle(baseColor, project, assignment, rowStart, rowEnd, model) {
      const days = rowEnd - rowStart + 1;
      if (days <= 0) return `background:${baseColor};`;
      const overlays = [];
      const person = assignment ? model.personById.get(String(assignment.person_id)) : null;
      const leave = person ? getLeaveRange(person) : null;
      const bt = getTrip(project, assignment?.person_id);
      const conflicts = assignment ? this.getConflictKeys(assignment) : new Set();
      for (let i = 0; i < days; i++) {
        const date = addDays(model.baseDate, rowStart + i);
        let color = "transparent";
        if (leave && date >= leave.start && date <= leave.end) color = rgba(this.colors.leave, 0.88);
        else if (conflicts.has(dateStr(date))) color = rgba(this.colors.conflict, this.colors.conflictOpacity);
        else if (bt && date >= bt.start && date <= bt.end) color = rgba(this.colors.trip, 0.58);
        overlays.push(`${color} ${(i / days) * 100}% ${((i + 1) / days) * 100}%`);
      }
      return `background:linear-gradient(to right, ${overlays.join(",")}), ${baseColor};`;
    }

    renderTripMarkers(project, rowStart, rowEnd, model, personId) {
      const trip = getTrip(project, personId);
      if (!trip) return "";
      const markers = [];
      const width = (rowEnd - rowStart + 1) * this.state.colWidth - 4;
      // 如果项目条太短（小于 50px），隐藏小飞机以免挡住项目名
      if (width < 50) return "";
      for (const date of [trip.start, trip.end]) {
        const off = dayDiff(model.baseDate, date);
        if (off < rowStart || off > rowEnd) continue;
        const left = Math.max(0, Math.min(width - 14, (off - rowStart) * this.state.colWidth + this.state.colWidth / 2 - 7));
        markers.push(`<span class="trip-marker" data-trip-date="${dateStr(date)}" style="position:absolute;left:${left}px;top:50%;transform:translateY(-50%);width:14px;height:14px">${Icons.svg("plane")}</span>`);
      }
      return markers.join("");
    }

    getConflictKeys(assignment, excludeIds = new Set()) {
      const keys = new Set();
      const start = parseDate(assignment.start_date);
      const end = parseDate(assignment.end_date, true);
      for (const other of this.state.assignments) {
        if (String(other.id) === String(assignment.id) || String(other.person_id) !== String(assignment.person_id)) continue;
        if (excludeIds.has(String(other.id))) continue;
        const otherStart = parseDate(other.start_date);
        const otherEnd = parseDate(other.end_date, true);
        if (start <= otherEnd && end >= otherStart) {
          const overlapStart = start > otherStart ? start : otherStart;
          const overlapEnd = end < otherEnd ? end : otherEnd;
          for (let d = startOfDay(overlapStart); d <= overlapEnd; d = addDays(d, 1)) keys.add(dateStr(d));
        }
      }
      return keys;
    }

    bindGanttEvents() {
      const header = document.getElementById("dateHeader");
      header?.addEventListener("mousedown", (event) => {
        this.state.dateDrag.active = true;
        this.state.dateDrag.startX = event.clientX;
        this.state.dateDrag.startOffset = this.state.viewOffset;
        header.classList.add("dragging");
        event.preventDefault();
      });
      // 甘特图日期悬浮红线（仅鼠标在日期头部时显示）
      const ganttRight = this.els.gantt.querySelector(".gantt-right");
      if (!header || !ganttRight) return;
      // 在日期头内创建红线元素，这样它的 top 基准就是 sticky 的日期头
      const hoverLine = document.createElement("div");
      hoverLine.className = "gantt-hover-line";
      header.appendChild(hoverLine);
      header.addEventListener("mouseenter", () => {
        hoverLine.style.height = (ganttRight.getBoundingClientRect().height - header.offsetHeight) + "px";
        hoverLine.style.display = "block";
      });
      header.addEventListener("mouseleave", () => { hoverLine.style.display = "none"; });
      header.addEventListener("mousemove", (event) => {
        const col = Math.floor((event.clientX - ganttRight.getBoundingClientRect().left) / this.state.colWidth);
        hoverLine.style.left = (col * this.state.colWidth) + "px";
      });
      if (this.state.readonly) return;
      this.els.gantt.querySelectorAll("[data-delete-person-row]").forEach((btn) => {
        btn.addEventListener("click", async (event) => {
          event.stopPropagation();
          const assignments = this.state.assignments.filter((a) => String(a.person_id) === String(btn.dataset.deletePersonRow) && String(a.project_id) === String(btn.dataset.projectId));
          if (assignments.length && confirm(`确定删除此人员在该项目中的全部 ${assignments.length} 条分配吗？`)) {
            await Promise.all(assignments.map((a) => fetch(`api/assignments/${encodeURIComponent(a.id)}`, { method: "DELETE" })));
            await this.loadData();
          }
        });
      });
      this.els.gantt.querySelectorAll(".person-bar").forEach((bar) => {
        bar.addEventListener("click", (event) => {
          if (event.ctrlKey || event.metaKey) {
            const id = bar.dataset.assignment;
            if (this.state.selectedBars.has(id)) this.state.selectedBars.delete(id);
            else this.state.selectedBars.add(id);
            bar.classList.toggle("selected", this.state.selectedBars.has(id));
            event.stopPropagation();
          }
        });
        bar.addEventListener("dblclick", async () => {
          if (confirm("确定删除这条分配吗？")) {
            await fetch(`api/assignments/${encodeURIComponent(bar.dataset.assignment)}`, { method: "DELETE" });
            await this.loadData();
          }
        });
        bar.addEventListener("pointerdown", (event) => this.startBarDrag(event, bar));
        bar.addEventListener("mousedown", (event) => {
          if (!this.state.barDrag) this.startBarDrag(event, bar);
        });
      });
      this.els.gantt.querySelectorAll(".gantt-row[data-project-id]").forEach((row) => {
        row.addEventListener("pointerenter", () => {});
      });
    }

    startPersonPointerDrag(event, chip) {
      if (event.button !== 0 || this.state.readonly) return;
      const id = String(chip.dataset.personId);
      const ids = this.state.selectedPersons.size ? [...this.state.selectedPersons] : [id];
      const person = this.state.persons.find((p) => String(p.id) === id);
      const color = getPersonColor(person, this.colors);
      this.state.personDrag = {
        chip,
        ids,
        startX: event.clientX,
        startY: event.clientY,
        x: event.clientX,
        y: event.clientY,
        active: false,
        raf: 0,
        color
      };
      chip.setPointerCapture?.(event.pointerId);
      this.setPersonHover(id);
      event.preventDefault();
    }

    handlePersonPointerMove(event) {
      const drag = this.state.personDrag;
      if (!drag) return;
      drag.x = event.clientX;
      drag.y = event.clientY;
      const dist = Math.hypot(drag.x - drag.startX, drag.y - drag.startY);
      if (!drag.active && dist > 5) {
        drag.active = true;
        drag.chip.classList.add("dragging");
        drag.chip.dataset.suppressClick = "1";
        drag.ghost = this.createPersonGhost(drag);
        this.state.drop.active = true;
      }
      if (drag.active) {
        event.preventDefault();
        if (!drag.raf) drag.raf = requestAnimationFrame(() => this.paintPersonDrag());
      }
    }

    createPersonGhost(drag) {
      const ghost = document.createElement("div");
      ghost.className = "drag-ghost";
      const names = drag.ids.map((id) => this.state.persons.find((p) => String(p.id) === String(id))?.name || id);
      ghost.innerHTML = `<span class="dept-dot" style="background:${esc(drag.color)}"></span>${esc(names.length > 1 ? `${names.length} 人` : names[0])}`;
      document.body.appendChild(ghost);
      return ghost;
    }

    paintPersonDrag() {
      const drag = this.state.personDrag;
      if (!drag?.active) return;
      drag.raf = 0;
      drag.ghost.style.transform = `translate3d(${drag.x + 12}px, ${drag.y + 12}px, 0)`;
      const row = this.getDropRowAt(drag.x, drag.y);
      if (!row) {
        this.clearDrop();
        return;
      }
      this.previewDropOnRow(row, drag.x, drag.ids);
    }

    async handlePersonPointerUp(event) {
      const drag = this.state.personDrag;
      if (!drag) return;
      this.state.personDrag = null;
      if (drag.raf) cancelAnimationFrame(drag.raf);
      drag.chip.classList.remove("dragging");
      drag.ghost?.remove();
      this.clearPersonHover();
      if (!drag.active) return;
      const row = this.getDropRowAt(event.clientX, event.clientY);
      const drop = row ? this.getDropInfo(row, event.clientX, drag.ids) : null;
      this.clearDrop();
      this.state.drop.active = false;
      this.state.selectedPersons.clear();
      drag.chip.dataset.suppressClick = "1";
      if (!drop) {
        this.renderPersonPool(this.buildModel());
        return;
      }
      await Promise.all(drag.ids.map((id) => this.createAssignmentWithMerge(drop.project.id, id, drop.start, drop.end)));
      this.render();
    }

    getDropRowAt(x, y) {
      const ghost = this.state.personDrag?.ghost;
      const oldDisplay = ghost?.style.display;
      if (ghost) ghost.style.display = "none";
      const el = document.elementFromPoint(x, y);
      if (ghost) ghost.style.display = oldDisplay || "";
      return el?.closest?.(".gantt-row[data-project-id]");
    }

    previewDropOnRow(row, clientX, personIds) {
      const info = this.getDropInfo(row, clientX, personIds);
      if (!info) {
        this.clearDrop();
        return;
      }
      if (this.state.drop.row !== row) this.clearDrop();
      row.classList.add("drop-ok");
      this.state.drop.row = row;
      if (!this.state.drop.placeholder) {
        this.state.drop.placeholder = document.createElement("div");
        this.state.drop.placeholder.className = "drop-placeholder";
        row.appendChild(this.state.drop.placeholder);
      }
      this.state.drop.placeholder.style.width = `${info.width}px`;
      this.state.drop.placeholder.style.transform = `translate3d(${info.left}px, 0, 0)`;
    }

    getDropInfo(row, clientX, personIds = []) {
      const project = this.state.projects.find((p) => String(p.id) === String(row.dataset.projectId));
      if (!project) return null;
      const rect = row.getBoundingClientRect();
      const col = Math.floor((clientX - rect.left) / this.state.colWidth);
      const pStart = dayDiff(this.currentBaseDate, parseDate(project.start_date));
      const pEnd = dayDiff(this.currentBaseDate, parseDate(project.end_date, true));
      if (col < pStart || col > pEnd) return null;
      const startCol = Math.max(pStart, Math.min(col, pEnd - this.defaultAssignDays + 1));
      const endCol = Math.min(pEnd, startCol + this.defaultAssignDays - 1);
      const start = new Date(Math.max(addDays(this.currentBaseDate, startCol).getTime(), parseDate(project.start_date).getTime()));
      const end = new Date(Math.min(endOfDay(addDays(this.currentBaseDate, endCol)).getTime(), parseDate(project.end_date, true).getTime()));
      const preview = this.getMergedPreview(project.id, personIds[0], start, end);
      return {
        project,
        start: preview.start,
        end: preview.end,
        left: Math.max(0, dayDiff(this.currentBaseDate, preview.start)) * this.state.colWidth,
        width: (Math.min(this.state.displayDays - 1, dayDiff(this.currentBaseDate, preview.end)) - Math.max(0, dayDiff(this.currentBaseDate, preview.start)) + 1) * this.state.colWidth - 4
      };
    }

    getMergedPreview(projectId, personId, start, end, editingId) {
      if (!personId) return { start, end };
      let mergedStart = startOfDay(start);
      let mergedEnd = endOfDay(end);
      const deletedIds = [];
      for (const item of this.state.assignments) {
        if (String(item.project_id) !== String(projectId) || String(item.person_id) !== String(personId) || String(item.id) === String(editingId || "")) continue;
        const s = parseDate(item.start_date);
        const e = parseDate(item.end_date, true);
        if (mergedStart <= addDays(e, 1) && mergedEnd >= addDays(s, -1)) {
          mergedStart = new Date(Math.min(mergedStart.getTime(), s.getTime()));
          mergedEnd = new Date(Math.max(mergedEnd.getTime(), e.getTime()));
          deletedIds.push(item.id);
        }
      }
      return { start: mergedStart, end: mergedEnd, deletedIds };
    }

    rangeToPixels(start, end) {
      const rowStart = Math.max(0, dayDiff(this.currentBaseDate, start));
      const rowEnd = Math.min(this.state.displayDays - 1, dayDiff(this.currentBaseDate, end));
      return {
        left: rowStart * this.state.colWidth,
        width: Math.max(this.state.colWidth - 4, (rowEnd - rowStart + 1) * this.state.colWidth - 4)
      };
    }

    pixelsToRange(left, width) {
      const startCol = Math.max(0, Math.round(left / this.state.colWidth));
      const days = Math.max(1, Math.round((width + 4) / this.state.colWidth));
      const start = addDays(this.currentBaseDate, startCol);
      return { start, end: endOfDay(addDays(start, days - 1)) };
    }

    setPersonHover(personId) {
      if (this.state.hoverPersonId === String(personId)) return;
      this.clearPersonHover();
      this.state.hoverPersonId = String(personId);
      this.els.gantt?.querySelectorAll(`.person-bar[data-person="${cssEscape(personId)}"]`).forEach((bar) => {
        bar.classList.add("person-match");
        bar.closest(".gantt-row")?.classList.add("person-hover");
      });
      this.els.gantt?.querySelectorAll(`.gantt-row-label.person[data-person-row="${cssEscape(personId)}"]`).forEach((label) => label.classList.add("person-hover"));
      this.state.projects.forEach((project) => {
        const hasPerson = this.state.assignments.some((a) => String(a.project_id) === String(project.id) && String(a.person_id) === String(personId));
        if (!hasPerson) {
          this.els.gantt?.querySelector(`.project-bar[data-project="${cssEscape(project.id)}"]`)?.classList.add("project-suggest");
        }
      });
    }

    clearPersonHover() {
      this.state.hoverPersonId = null;
      this.els.gantt?.querySelectorAll(".person-match,.project-suggest").forEach((el) => el.classList.remove("person-match", "project-suggest"));
      this.els.gantt?.querySelectorAll(".person-hover").forEach((el) => el.classList.remove("person-hover"));
    }

    handlePersonHoverMove(event) {
      if (this.state.personDrag?.active || this.state.readonly) return;
      const chip = event.target?.closest?.(".person-chip");
      if (chip) {
        this.setPersonHover(chip.dataset.personId);
      } else if (!event.target?.closest?.("#personChips")) {
        this.clearPersonHover();
      }
    }

    startBarDrag(event, bar) {
      if (this.state.barDrag?.active) return;
      if (event.button !== 0) return;
      const isResize = event.target.classList.contains("bar-resize");
      const selectedIds = this.state.selectedBars.has(bar.dataset.assignment) ? [...this.state.selectedBars] : [bar.dataset.assignment];
      const bars = selectedIds.map((id) => this.els.gantt.querySelector(`.person-bar[data-assignment="${cssEscape(id)}"]`)).filter(Boolean);
      this.state.barDrag = {
        active: true,
        bar,
        bars,
        resizeDir: isResize ? event.target.dataset.dir : null,
        startX: event.clientX,
        startLeft: parsePx(bar.style.left),
        startWidth: parsePx(bar.style.width),
        currentLeft: parsePx(bar.style.left),
        currentWidth: parsePx(bar.style.width),
        source: event.pointerId == null ? "mouse" : "pointer",
        raf: 0,
        snapshots: new Map(bars.map((b) => [b.dataset.assignment, { left: parsePx(b.style.left), width: parsePx(b.style.width), projectId: b.dataset.project, personId: b.dataset.person }]))
      };
      bar.setPointerCapture?.(event.pointerId);
      bars.forEach((b) => b.classList.add("dragging"));
      document.body.style.userSelect = "none";
      event.preventDefault();
      event.stopPropagation();
    }

    handleBarMouseMove(event) {
      const drag = this.state.barDrag;
      if (!drag?.active) return;
      const dx = event.clientX - drag.startX;
      if (drag.resizeDir === "left") {
        drag.currentLeft = drag.startLeft + dx;
        drag.currentWidth = drag.startWidth - dx;
      } else if (drag.resizeDir === "right") {
        drag.currentWidth = drag.startWidth + dx;
      } else {
        drag.currentLeft = drag.startLeft + dx;
      }
      if (!drag.raf) drag.raf = requestAnimationFrame(() => this.paintBarDrag());
    }

    paintBarDrag() {
      const drag = this.state.barDrag;
      if (!drag?.active) return;
      drag.raf = 0;
      const primary = this.clampToProject(drag.currentLeft, drag.currentWidth, drag.bar.dataset.project, drag.resizeDir);
      const dx = primary.left - drag.startLeft;
      const dw = primary.width - drag.startWidth;
      this.els.gantt?.querySelectorAll(".merge-target").forEach((el) => el.classList.remove("merge-target"));

      // 收集所有被拖拽的人员ID，用于同步更新其他项目中的同名人员 bar 背景色
      const draggedPersonIds = new Set();
      for (const bar of drag.bars) {
        const snap = drag.snapshots.get(bar.dataset.assignment);
        if (snap) draggedPersonIds.add(String(snap.personId));
      }

      // 先为所有被拖拽 bar 计算新位置（preview），供冲突计算使用
      const previewMap = new Map();
      for (const bar of drag.bars) {
        const snap = drag.snapshots.get(bar.dataset.assignment);
        if (!snap) continue;
        let nextLeft = bar === drag.bar ? primary.left : snap.left + dx;
        let nextWidth = snap.width;
        if (drag.resizeDir === "left") nextWidth = snap.width - dx;
        if (drag.resizeDir === "right") nextWidth = snap.width + dw;
        const clamped = this.clampToProject(nextLeft, nextWidth, snap.projectId, drag.resizeDir);
        const range = this.pixelsToRange(clamped.left, clamped.width);
        const merged = this.getMergedPreview(snap.projectId, snap.personId, range.start, range.end, bar.dataset.assignment);
        previewMap.set(bar.dataset.assignment, { merged, clamped, snap });
      }

      // 所有被拖拽 bar 的 ID 集合，用于排除原始位置冲突
      const draggedIds = new Set([...previewMap.keys()].map(String));

      for (const bar of drag.bars) {
        const info = previewMap.get(bar.dataset.assignment);
        if (!info) continue;
        const { merged, snap } = info;
        const finalPixels = this.rangeToPixels(merged.start, merged.end);
        bar.style.transform = `translateX(${finalPixels.left - snap.left}px)`;
        bar.style.width = `${finalPixels.width}px`;
        bar.dataset.previewLeft = String(finalPixels.left);
        bar.dataset.previewWidth = String(finalPixels.width);
        bar.dataset.previewStart = dateStr(merged.start);
        bar.dataset.previewEnd = dateStr(merged.end);

        const person = this.state.persons.find((p) => String(p.id) === String(snap.personId));
        if (person) {
          const baseColor = getPersonColor(person, this.colors);
          const leave = getLeaveRange(person);
          const project = this.state.projects.find((p) => String(p.id) === String(snap.projectId));
          const bt = getTrip(project, snap.personId);
          // 关键修复：使用拖拽后的新位置（merged.start/end）计算冲突，而非原始位置
          // 构造虚拟 assignment，用新位置计算与非拖拽 bar 的冲突
          const virtualAssignment = { id: bar.dataset.assignment, person_id: snap.personId, start_date: dateStr(merged.start), end_date: dateStr(merged.end) };
          let conflicts = this.getConflictKeys(virtualAssignment, draggedIds);
          // 补充其他被拖拽 bar（同人）的新位置冲突
          for (const [otherId, otherInfo] of previewMap) {
            if (otherId === bar.dataset.assignment) continue;
            const osnap = otherInfo.snap;
            if (String(osnap.personId) !== String(snap.personId)) continue;
            const om = otherInfo.merged;
            for (let d = new Date(om.start); d <= om.end; d = addDays(d, 1)) {
              conflicts.add(dateStr(d));
            }
          }
          const rowStart = Math.max(0, dayDiff(this.currentBaseDate, merged.start));
          const rowEnd = Math.min(this.state.displayDays - 1, dayDiff(this.currentBaseDate, merged.end));
          const days = rowEnd - rowStart + 1;
          if (days > 0) {
            const overlays = [];
            for (let i = 0; i < days; i++) {
              const date = addDays(this.currentBaseDate, rowStart + i);
              let color = "transparent";
              if (leave && date >= leave.start && date <= leave.end) color = rgba(this.colors.leave, 0.88);
              else if (conflicts.has(dateStr(date))) color = rgba(this.colors.conflict, this.colors.conflictOpacity);
              else if (bt && date >= bt.start && date <= bt.end) color = rgba(this.colors.trip, 0.58);
              overlays.push(`${color} ${(i / days) * 100}% ${((i + 1) / days) * 100}%`);
            }
            bar.style.background = `linear-gradient(to right, ${overlays.join(",")}), ${baseColor}`;
          }
        }

        // 动态更新飞机图标位置（出差标记跟随 bar 移动）
        const project = this.state.projects.find((p) => String(p.id) === String(snap.projectId));
        const bt = getTrip(project, snap.personId);
        if (bt) {
          const tripMarkers = bar.querySelectorAll(".trip-marker");
          const barWidth = finalPixels.width;
          for (const marker of tripMarkers) {
            const markerDate = marker.dataset.tripDate;
            if (markerDate) {
              const off = dayDiff(this.currentBaseDate, parseDate(markerDate));
              const rowStartPx = Math.max(0, dayDiff(this.currentBaseDate, merged.start));
              const rowEndPx = Math.min(this.state.displayDays - 1, dayDiff(this.currentBaseDate, merged.end));
              if (off >= rowStartPx && off <= rowEndPx) {
                const left = Math.max(0, Math.min(barWidth - 14, (off - rowStartPx) * this.state.colWidth + this.state.colWidth / 2 - 7));
                marker.style.left = `${left}px`;
                marker.style.display = "";
              } else {
                marker.style.display = "none";
              }
            }
          }
        }

        (merged.deletedIds || []).forEach((id) => {
          this.els.gantt.querySelector(`.person-bar[data-assignment="${cssEscape(id)}"]`)?.classList.add("merge-target");
        });
      }

      // 同步更新同一人在其他项目中的 bar 的背景色（位置不变，仅刷新背景渐变以反映冲突/请假变化）
      if (draggedPersonIds.size > 0) {
        for (const personId of draggedPersonIds) {
          const person = this.state.persons.find((p) => String(p.id) === personId);
          if (!person) continue;
          const leave = getLeaveRange(person);
          const baseColor = getPersonColor(person, this.colors);
          const allBars = this.els.gantt.querySelectorAll(`.person-bar[data-person="${cssEscape(personId)}"]`);
          for (const otherBar of allBars) {
            if (drag.bars.includes(otherBar)) continue;
            const project = this.state.projects.find((p) => String(p.id) === String(otherBar.dataset.project));
            const bt = getTrip(project, personId);
            const assignment = this.state.assignments.find((a) => String(a.id) === String(otherBar.dataset.assignment));
            // 排除所有被拖拽 bar 原始位置 + 加入被拖拽 bar 的新位置（所有项目，包括同项目和跨项目）
            let conflicts = assignment ? this.getConflictKeys(assignment, draggedIds) : new Set();
            for (const [otherId, otherInfo] of previewMap) {
              const osnap = otherInfo.snap;
              if (String(osnap.personId) !== personId) continue;
              conflicts = new Set(conflicts);
              const om = otherInfo.merged;
              for (let d = new Date(om.start); d <= om.end; d = addDays(d, 1)) {
                conflicts.add(dateStr(d));
              }
            }
            const left = parsePx(otherBar.style.left);
            const width = parsePx(otherBar.style.width);
            if (!left && !width) continue;
            const range = this.pixelsToRange(left, width);
            const rowStart = Math.max(0, dayDiff(this.currentBaseDate, range.start));
            const rowEnd = Math.min(this.state.displayDays - 1, dayDiff(this.currentBaseDate, range.end));
            const days = rowEnd - rowStart + 1;
            if (days > 0) {
              const overlays = [];
              for (let i = 0; i < days; i++) {
                const date = addDays(this.currentBaseDate, rowStart + i);
                let color = "transparent";
                if (leave && date >= leave.start && date <= leave.end) color = rgba(this.colors.leave, 0.88);
                else if (conflicts.has(dateStr(date))) color = rgba(this.colors.conflict, this.colors.conflictOpacity);
                else if (bt && date >= bt.start && date <= bt.end) color = rgba(this.colors.trip, 0.58);
                overlays.push(`${color} ${(i / days) * 100}% ${((i + 1) / days) * 100}%`);
              }
              otherBar.style.background = `linear-gradient(to right, ${overlays.join(",")}), ${baseColor}`;
            }
          }
        }
      }
    }

    async handleBarMouseUp(event) {
      const drag = this.state.barDrag;
      if (!drag?.active) return;
      if (drag.raf) {
        cancelAnimationFrame(drag.raf);
        drag.raf = 0;
        this.paintBarDrag();
      }
      const wrapperRect = this.els.wrapper.getBoundingClientRect();
      const outside = event.clientX < wrapperRect.left || event.clientX > wrapperRect.right || event.clientY < wrapperRect.top || event.clientY > wrapperRect.bottom;
      const bars = drag.bars;
      this.state.barDrag = null;
      document.body.style.userSelect = "";
      if (outside && confirm("确定删除拖出的分配吗？")) {
        await Promise.all(bars.map((b) => fetch(`api/assignments/${encodeURIComponent(b.dataset.assignment)}`, { method: "DELETE" })));
        await this.loadData();
        return;
      }
      const updates = bars.map((bar) => {
        const snap = drag.snapshots.get(bar.dataset.assignment);
        const left = snapToGrid(parseFloat(bar.dataset.previewLeft || snap.left), this.state.colWidth);
        const width = Math.max(this.state.colWidth - 4, snapToGrid(parseFloat(bar.dataset.previewWidth || snap.width), this.state.colWidth));
        const start = bar.dataset.previewStart ? parseDate(bar.dataset.previewStart) : this.pixelsToRange(left, width).start;
        const end = bar.dataset.previewEnd ? parseDate(bar.dataset.previewEnd, true) : this.pixelsToRange(left, width).end;
        const finalPixels = this.rangeToPixels(start, end);
        bar.classList.add("settling");
        bar.style.left = `${finalPixels.left}px`;
        bar.style.width = `${finalPixels.width}px`;
        bar.style.transform = "";
        return this.createAssignmentWithMerge(bar.dataset.project, bar.dataset.person, start, end, bar.dataset.assignment);
      });
      bars.forEach((bar) => {
        bar.classList.remove("dragging");
        delete bar.dataset.previewLeft;
        delete bar.dataset.previewWidth;
        delete bar.dataset.previewStart;
        delete bar.dataset.previewEnd;
        setTimeout(() => bar.classList.remove("settling"), 220);
      });
      const results = await Promise.all(updates);
      this.els.gantt?.querySelectorAll(".merge-target").forEach((el) => el.classList.remove("merge-target"));
      results.flatMap((result) => result?.deletedIds || []).forEach((id) => {
        this.els.gantt.querySelector(`.person-bar[data-assignment="${cssEscape(id)}"]`)?.remove();
      });
    }

    clampToProject(left, width, projectId, mode) {
      const project = this.state.projects.find((p) => String(p.id) === String(projectId));
      if (!project) return { left: Math.max(0, left), width: Math.max(this.state.colWidth, width) };
      const pStart = parseDate(project.start_date);
      const pEnd = parseDate(project.end_date, true);
      const minLeft = Math.max(0, dayDiff(this.currentBaseDate, pStart) * this.state.colWidth);
      const maxRight = (dayDiff(this.currentBaseDate, pEnd) + 1) * this.state.colWidth;
      let finalLeft = left;
      let finalWidth = Math.max(this.state.colWidth - 4, width);
      if (mode === "left") {
        const right = Math.min(maxRight, left + finalWidth);
        finalLeft = Math.max(minLeft, Math.min(left, right - (this.state.colWidth - 4)));
        finalWidth = Math.max(this.state.colWidth - 4, right - finalLeft);
      } else if (mode === "right") {
        finalLeft = Math.max(minLeft, Math.min(left, maxRight - (this.state.colWidth - 4)));
        finalWidth = Math.max(this.state.colWidth - 4, Math.min(finalWidth, maxRight - finalLeft));
      } else {
        finalWidth = Math.min(finalWidth, Math.max(this.state.colWidth - 4, maxRight - minLeft));
        finalLeft = Math.max(minLeft, Math.min(left, maxRight - finalWidth));
      }
      return { left: finalLeft, width: finalWidth };
    }

    handleDateMouseMove(event) {
      const drag = this.state.dateDrag;
      if (!drag.active) return;
      const delta = Math.round(-(event.clientX - drag.startX) / this.state.colWidth);
      const next = drag.startOffset + delta;
      if (next !== this.state.viewOffset) {
        this.state.viewOffset = next;
        if (!drag.raf) drag.raf = requestAnimationFrame(() => {
          drag.raf = 0;
          this.render();
        });
      }
    }

    handleDateMouseUp() {
      if (!this.state.dateDrag.active) return;
      this.state.dateDrag.active = false;
      document.getElementById("dateHeader")?.classList.remove("dragging");
    }

    handleDropOver(event, row) {
      if (!this.state.drop.active) return;
      const project = this.state.projects.find((p) => String(p.id) === String(row.dataset.projectId));
      if (!project) return;
      const rect = row.getBoundingClientRect();
      const col = Math.floor((event.clientX - rect.left) / this.state.colWidth);
      const pStart = dayDiff(this.currentBaseDate, parseDate(project.start_date));
      const pEnd = dayDiff(this.currentBaseDate, parseDate(project.end_date, true));
      if (col < pStart || col > pEnd) return;
      event.preventDefault();
      row.classList.add("drop-ok");
      if (this.state.drop.row !== row) this.clearDrop();
      this.state.drop.row = row;
      if (!this.state.drop.placeholder) {
        this.state.drop.placeholder = document.createElement("div");
        this.state.drop.placeholder.className = "drop-placeholder";
        row.appendChild(this.state.drop.placeholder);
      }
      const startCol = Math.max(pStart, Math.min(col, pEnd - this.defaultAssignDays + 1));
      const endCol = Math.min(pEnd, startCol + this.defaultAssignDays - 1);
      this.state.drop.placeholder.style.left = `${startCol * this.state.colWidth}px`;
      this.state.drop.placeholder.style.width = `${(endCol - startCol + 1) * this.state.colWidth - 4}px`;
    }

    handleDropLeave(event, row) {
      const rect = row.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) this.clearDrop();
    }

    async handleDrop(event, row) {
      event.preventDefault();
      const ids = parsePersonIds(event.dataTransfer);
      this.clearDrop();
      if (!ids.length) return;
      const project = this.state.projects.find((p) => String(p.id) === String(row.dataset.projectId));
      if (!project) return;
      const rect = row.getBoundingClientRect();
      const col = Math.floor((event.clientX - rect.left) / this.state.colWidth);
      const pStart = parseDate(project.start_date);
      const pEnd = parseDate(project.end_date, true);
      let start = addDays(this.currentBaseDate, col);
      start = new Date(Math.max(start.getTime(), pStart.getTime()));
      let end = endOfDay(addDays(start, this.defaultAssignDays - 1));
      end = new Date(Math.min(end.getTime(), pEnd.getTime()));
      if (start > pEnd) return;
      await Promise.all(ids.map((id) => this.createAssignmentWithMerge(project.id, id, start, end)));
      this.render();
    }

    clearDrop() {
      this.els.gantt?.querySelectorAll(".drop-ok").forEach((row) => row.classList.remove("drop-ok"));
      if (this.state.drop.placeholder) this.state.drop.placeholder.remove();
      this.state.drop.placeholder = null;
      this.state.drop.row = null;
    }

    async createAssignmentWithMerge(projectId, personId, start, end, editingId) {
      const same = this.state.assignments.filter((a) => String(a.project_id) === String(projectId) && String(a.person_id) === String(personId) && String(a.id) !== String(editingId || ""));
      let mergedStart = startOfDay(start);
      let mergedEnd = endOfDay(end);
      const toDelete = [];
      for (const item of same) {
        const s = parseDate(item.start_date);
        const e = parseDate(item.end_date, true);
        if (mergedStart <= addDays(e, 1) && mergedEnd >= addDays(s, -1)) {
          mergedStart = new Date(Math.min(mergedStart.getTime(), s.getTime()));
          mergedEnd = new Date(Math.max(mergedEnd.getTime(), e.getTime()));
          toDelete.push(item.id);
        }
      }
      await Promise.all(toDelete.map((id) => fetch(`api/assignments/${encodeURIComponent(id)}`, { method: "DELETE" })));
      this.state.assignments = this.state.assignments.filter((a) => !toDelete.some((id) => String(id) === String(a.id)));
      if (editingId) {
        await fetch(`api/assignments/${encodeURIComponent(editingId)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ startDate: dateStr(mergedStart), endDate: dateStr(mergedEnd) })
        });
        const existing = this.state.assignments.find((a) => String(a.id) === String(editingId));
        if (existing) {
          existing.start_date = dateStr(mergedStart);
          existing.end_date = dateStr(mergedEnd);
        }
        return { id: editingId, startDate: dateStr(mergedStart), endDate: dateStr(mergedEnd), merged: toDelete.length > 0, deletedIds: toDelete };
      }
      const response = await fetch("api/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, personId, startDate: dateStr(mergedStart), endDate: dateStr(mergedEnd) })
      });
      const result = await response.json().catch(() => ({}));
      this.state.assignments.push({
        id: result.id || `local-${Date.now()}`,
        project_id: projectId,
        person_id: personId,
        start_date: dateStr(mergedStart),
        end_date: dateStr(mergedEnd)
      });
      return { ...result, merged: toDelete.length > 0, deletedIds: toDelete, created: true };
    }

    updateAssignmentWithMerge(projectId, personId, start, end, editingId) {
      return this.createAssignmentWithMerge(projectId, personId, start, end, editingId);
    }

    clearBarSelection() {
      this.state.selectedBars.clear();
      this.els.gantt?.querySelectorAll(".bar.selected").forEach((bar) => bar.classList.remove("selected"));
    }

    showEmpty(message) {
      this.els.gantt.innerHTML = `<div class="empty-state" style="width:100%"><div class="empty-box">${Icons.svg("board")}<p>${message}</p></div></div>`;
    }

    destroy() {
      this.disconnectSSE();
      if (this.state.syncTimer) clearInterval(this.state.syncTimer);
      if (this.state.resizeTimer) clearTimeout(this.state.resizeTimer);
    }
  }

  function fetchJson(url) {
    return fetch(url).then((response) => {
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return response.json();
    });
  }

  function parsePersonIds(dataTransfer) {
    try {
      return JSON.parse(dataTransfer.getData("personIds") || "[]").map(String);
    } catch {
      const id = dataTransfer.getData("personId");
      return id ? [String(id)] : [];
    }
  }

  function parseDate(value, endOf = false) {
    if (!value) return endOf ? endOfDay(new Date()) : startOfDay(new Date());
    const text = String(value).slice(0, 10);
    const [y, m, d] = text.split("-").map(Number);
    const date = new Date(y, (m || 1) - 1, d || 1);
    return endOf ? endOfDay(date) : startOfDay(date);
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function endOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  }

  function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  function dayDiff(base, date) {
    return Math.floor((startOfDay(date) - startOfDay(base)) / DAY_MS);
  }

  function dateStr(date) {
    const d = startOfDay(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function sameDate(a, b) {
    return dateStr(a) === dateStr(b);
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

  function deptIndex(name) {
    // 排序规则：其他部门在上，倒数第二位 = 前期美术，倒数第一位 = 后期制作
    // 「其他」仍然兜底排最后
    if (name === "前期美术") return 9997;
    if (name === "后期制作") return 9998;
    if (name === "其他") return 9999;
    const idx = DEPTS.findIndex((d) => d.name === name);
    if (idx >= 0) return idx;
    return 5000;
  }

  function getPersonDept(person) {
    const dept = person?.department || "";
    // 精确匹配优先
    if (DEPTS.some((d) => d.name === dept)) return dept;
    // 模糊匹配
    const match = DEPTS.find((d) => dept.includes(d.name) || d.name.includes(dept));
    if (match) return match.name;
    return dept || "其他";
  }

  function getPersonColor(person, colors) {
    const dept = person?.department || "";
    // 优先使用配置中该部门的颜色
    if (dept && colors.deptColors) {
      const configKey = "dept_color_" + dept.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "_");
      if (colors.deptColors[configKey]) return colors.deptColors[configKey];
    }
    // 回退到旧的 pre/post 颜色逻辑
    const group = person?.group_type || "";
    if (group === "pre" || group.includes("前期") || group.includes("美术") || dept.includes("前期") || dept.includes("美术")) return colors.pre;
    if (group === "post" || group.includes("后期") || group.includes("制作") || group.includes("VJ") || dept.includes("后期") || dept.includes("制作") || dept.includes("VJ")) return colors.post;
    const deptName = getPersonDept(person);
    return getDeptColor(deptName, colors);
  }

  function getDeptColor(name, colors) {
    if (name && colors.deptColors) {
      const configKey = "dept_color_" + name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "_");
      if (colors.deptColors[configKey]) return colors.deptColors[configKey];
    }
    if (name.includes("前期") || name.includes("美术")) return colors.pre;
    if (name.includes("后期") || name.includes("制作") || name.includes("VJ")) return colors.post;
    const dept = DEPTS.find((d) => d.name === name);
    if (dept) return dept.color;
    // 对于不在 DEPTS 中的部门，用名称哈希从默认颜色池取一个稳定颜色
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash) + name.charCodeAt(i);
    return DEPT_DEFAULT_COLORS[Math.abs(hash) % DEPT_DEFAULT_COLORS.length];
  }

  function getLeaveRange(person) {
    if (!person?.leave_start || !person?.leave_end) return null;
    const start = parseDate(person.leave_start);
    const end = parseDate(person.leave_end, true);
    const today = startOfDay(new Date());
    return {
      start,
      end,
      type: person.leave_type || person.leave_status || "请假",
      isCurrentlyOnLeave: start <= today && end >= today,
      isFutureLeave: start > today
    };
  }

  function getTrip(project, personId) {
    if (!(project?.business_trip == 1) || !project.business_trip_start || !project.business_trip_end) return null;
    if (personId) {
      try {
        const persons = JSON.parse(project.business_trip_persons || "[]").map(String);
        if (!persons.includes(String(personId))) return null;
      } catch {
        return null;
      }
    }
    return { start: parseDate(project.business_trip_start), end: parseDate(project.business_trip_end, true) };
  }

  // 获取人员出差状态：出差中（今天在区间内）> 即将出差（今天还没到开始日期）
  function getPersonTrip(person, projects) {
    if (!person || !projects) return null;
    const today = startOfDay(new Date());
    const personId = String(person.id);
    for (const project of projects) {
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

  function rgba(hex, alpha) {
    const clean = String(hex || "#000000").replace("#", "");
    const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
    const n = parseInt(full, 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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

  function snapToGrid(value, colWidth) {
    return Math.round(value / colWidth) * colWidth;
  }

  function parsePx(value) {
    return parseFloat(String(value || "0").replace("px", "")) || 0;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function getLeftWidth() {
    return parseInt(getComputedStyle(document.documentElement).getPropertyValue("--left-w"), 10) || 232;
  }

  function esc(value) {
    return Icons.escapeHtml(value);
  }

  function cssEscape(value) {
    if (window.CSS?.escape) return window.CSS.escape(String(value));
    return String(value).replace(/["\\]/g, "\\$&");
  }

  function formatDuration(ms) {
    const totalSeconds = Math.ceil(ms / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    if (h > 0) return `${h}小时${m}分`;
    if (m > 0) return `${m}分${s}秒`;
    return `${s}秒`;
  }

  window.BoardApp = BoardApp;
})();
