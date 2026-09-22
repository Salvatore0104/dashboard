(function () {
  'use strict';
  const nativeFetch = window.fetch.bind(window);
  let active = false;
  let currentToken = null;
  let currentUser = null;
  let checking = null;
  let starting = true;
  const style = document.createElement('style');
  style.textContent = 'body { visibility: hidden !important; }';
  document.head.appendChild(style);

  function token() {
    try {
      const modern = localStorage.getItem('easyai.auth.tokens.v1');
      // A present modern store is authoritative, including an explicitly empty token.
      const value = modern !== null ? JSON.parse(modern)?.token
        : JSON.parse(localStorage.getItem('auth') || 'null')?.user?.token;
      return typeof value === 'string' ? value.replace(/^Bearer\s+/i, '').trim() : '';
    } catch { return ''; }
  }

  function deny(message = '无权限访问') {
    if (active) {
      active = false;
      document.body.replaceChildren();
      // Destroy timers, closures, cached data and pending UI callbacks together.
      location.reload();
      return;
    }
    document.body.replaceChildren();
    const box = document.createElement('main');
    box.style.cssText = 'padding:48px;text-align:center';
    const text = document.createElement('p');
    text.textContent = message;
    const link = document.createElement('a');
    link.href = 'tv.html';
    link.textContent = '返回 TV 看板';
    box.append(text, link);
    document.body.append(box);
    style.disabled = true;
  }

  async function validate() {
    const snapshot = token();
    if (!snapshot) throw new Error('identity_unavailable');
    const response = await nativeFetch('api/access', {
      headers: { Authorization: `Bearer ${snapshot}` }, cache: 'no-store', credentials: 'omit'
    });
    if (!response.ok) throw new Error(response.status === 403 ? 'access_denied' : 'identity_unavailable');
    const result = await response.json();
    if (snapshot !== token() || !result.canManage) throw new Error('identity_changed');
    return { token: snapshot, id: result.user.id };
  }

  async function start(init) {
    try {
      const identity = await validate();
      currentToken = identity.token;
      currentUser = identity.id;
      active = true;
      init();
      style.disabled = true;
    } catch (error) {
      deny(error.message === 'access_denied' ? '无权限访问' : '暂时无法确认访问权限');
    } finally {
      starting = false;
    }
  }

  async function check() {
    if (starting) return;
    if (checking) return checking;
    style.disabled = false;
    checking = (async () => {
      try {
        const identity = await validate();
        if (!active || identity.id !== currentUser) {
          active = false;
          document.body.replaceChildren();
          location.reload();
          return;
        }
        currentToken = identity.token;
        style.disabled = true;
      } catch { deny('暂时无法确认访问权限'); }
      finally { checking = null; }
    })();
    return checking;
  }

  async function authorizedFetch(url, options = {}) {
    if (!active) throw new Error('无权限访问');
    if (token() !== currentToken) await check();
    if (!active) throw new Error('无权限访问');
    const snapshot = token();
    const headers = new Headers(options.headers);
    headers.set('Authorization', `Bearer ${snapshot}`);
    let response;
    try {
      response = await nativeFetch(url, { ...options, headers, cache: 'no-store', credentials: 'omit' });
    } catch (error) { deny('暂时无法确认访问权限'); throw error; }
    if (snapshot !== token() || !active || [401, 403, 503].includes(response.status)) {
      deny(response.status === 403 ? '无权限访问' : '暂时无法确认访问权限');
      throw new Error('当前不可操作');
    }
    for (const method of ['json', 'text', 'blob']) {
      const read = response[method].bind(response);
      response[method] = async () => {
        const result = await read();
        if (!active || snapshot !== token()) throw new Error('当前不可操作');
        return result;
      };
    }
    return response;
  }

  async function download(url, filename) {
    const response = await authorizedFetch(url);
    if (!response.ok) throw new Error('导出失败');
    const blob = await response.blob();
    if (!active || token() !== currentToken) return;
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  window.addEventListener('storage', event => {
    if (event.key === null || ['easyai.auth.tokens.v1', 'auth'].includes(event.key)) check();
  });
  window.addEventListener('focus', check);
  window.addEventListener('pagehide', () => { style.disabled = false; });
  window.addEventListener('pageshow', event => { if (event.persisted) check(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  window.DashboardAccess = { start, fetch: authorizedFetch, download };
})();
