(function () {
  const base = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round"
  };

  const paths = {
    board: '<rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M8 4v16"></path><path d="M3 9h18"></path>',
    admin: '<path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z"></path><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.05.05a2 2 0 1 1-2.83 2.83l-.05-.05a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.56V21a2 2 0 1 1-4 0v-.08a1.7 1.7 0 0 0-1-1.56 1.7 1.7 0 0 0-1.87.34l-.05.05a2 2 0 1 1-2.83-2.83l.05-.05A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1H3a2 2 0 1 1 0-4h.08a1.7 1.7 0 0 0 1.56-1 1.7 1.7 0 0 0-.34-1.87l-.05-.05a2 2 0 1 1 2.83-2.83l.05.05A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.08a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.87-.34l.05-.05a2 2 0 1 1 2.83 2.83l-.05.05A1.7 1.7 0 0 0 19.4 9c.18.6.74 1 1.56 1H21a2 2 0 1 1 0 4h-.08c-.82 0-1.38.4-1.56 1Z"></path>',
    tv: '<rect x="3" y="5" width="18" height="13" rx="2"></rect><path d="M8 21h8"></path><path d="M12 18v3"></path>',
    calendar: '<path d="M8 2v4"></path><path d="M16 2v4"></path><rect x="3" y="4" width="18" height="18" rx="2"></rect><path d="M3 10h18"></path>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>',
    refresh: '<path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path><path d="M3 16h6"></path><path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path><path d="M15 8h6"></path>',
    trash: '<path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 16H6L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path>',
    plus: '<path d="M12 5v14"></path><path d="M5 12h14"></path>',
    arrowLeft: '<path d="M19 12H5"></path><path d="M12 19l-7-7 7-7"></path>',
    plane: '<path d="M17.8 19.2 16 11l6-6-2-2-6 6-8.2-1.8-1.4 1.4 6.6 3.4-3.3 3.3-2.7-.5-1 1 3.7 1.7 1.7 3.7 1-1-.5-2.7 3.3-3.3 3.4 6.6Z"></path>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path>',
    close: '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>',
    save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"></path><path d="M17 21v-8H7v8"></path><path d="M7 3v5h8"></path>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><path d="M7 10l5 5 5-5"></path><path d="M12 15V3"></path>',
    chevronDown: '<path d="m6 9 6 6 6-6"></path>',
    check: '<path d="m20 6-11 11-5-5"></path>',
    clock: '<circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path>'
  };

  function svg(name, title) {
    const attrs = Object.entries(base).map(([k, v]) => `${k}="${v}"`).join(" ");
    const label = title ? `<title>${escapeHtml(title)}</title>` : "";
    return `<span class="icon" aria-hidden="${title ? "false" : "true"}"><svg ${attrs}>${label}${paths[name] || paths.board}</svg></span>`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }

  window.Icons = { svg, escapeHtml };
})();
