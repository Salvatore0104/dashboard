(function () {
  const KEY = "dashboard_theme_config";

  function shadeColor(hex, percent) {
    const clean = String(hex || "#3157d5").replace("#", "");
    const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
    const n = parseInt(full, 16);
    if (Number.isNaN(n)) return percent < 0 ? "#2344b5" : "#3157d5";
    const amount = Math.round(255 * (percent / 100));
    const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amount));
    const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amount));
    const b = Math.max(0, Math.min(255, (n & 255) + amount));
    return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
  }

  function rgba(hex, alpha) {
    const clean = String(hex || "#3157d5").replace("#", "");
    const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
    const n = parseInt(full, 16);
    if (Number.isNaN(n)) return `rgba(49, 87, 213, ${alpha})`;
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  function apply(config) {
    if (!config || typeof config !== "object") return;
    const root = document.documentElement;
    const primary = config.theme_primary || config.primary_color;
    if (primary) {
      root.style.setProperty("--primary", primary);
      root.style.setProperty("--primary-2", shadeColor(primary, -18));
      root.style.setProperty("--primary-soft", rgba(primary, 0.12));
    }
    if (config.trip_upcoming_color) root.style.setProperty("--trip-upcoming", config.trip_upcoming_color);
    if (config.trip_active_color) {
      root.style.setProperty("--trip-active", config.trip_active_color);
      root.style.setProperty("--trip", config.trip_active_color);
    }
    if (config.leave_active_color) {
      root.style.setProperty("--leave-active", config.leave_active_color);
      root.style.setProperty("--leave", config.leave_active_color);
    }
    if (config.leave_upcoming_color) root.style.setProperty("--leave-upcoming", config.leave_upcoming_color);
    if (config.conflict_color) root.style.setProperty("--conflict", config.conflict_color);
  }

  function load() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || "null");
    } catch {
      return null;
    }
  }

  function save(config) {
    if (!config || typeof config !== "object") return;
    try {
      localStorage.setItem(KEY, JSON.stringify(config));
    } catch {}
    apply(config);
  }

  window.ThemeStore = { apply, save, load };
  apply(load());
})();
