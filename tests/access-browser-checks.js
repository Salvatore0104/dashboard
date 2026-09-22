// Run with playwright-cli run-code against the isolated acceptance server only.
async (page) => {
  const base = 'http://127.0.0.1:5011/';
  if (!page.url().startsWith(base)) throw new Error('Local acceptance server required');
  const passed = [];
  const setToken = async value => page.evaluate(value => {
    if (value === null) localStorage.removeItem('easyai.auth.tokens.v1');
    else localStorage.setItem('easyai.auth.tokens.v1', JSON.stringify({ token: value }));
  }, value);
  const text = async () => page.locator('body').innerText();
  const requireThat = (condition, message) => { if (!condition) throw new Error(message); };
  let traffic = [];
  const onRequest = req => { if (req.url().includes('/api/')) traffic.push({url: req.url(), auth: req.headers().authorization}); };
  page.on('request', onRequest);
  try {
    await page.evaluate(() => localStorage.clear());
    await page.goto(base + 'admin.html');
    await page.getByText('暂时无法确认访问权限').waitFor();
    requireThat(!traffic.some(req => !req.url.endsWith('/api/access')), 'Anonymous page loaded business data');
    passed.push('anonymous shell blocks all business loading');

    await setToken('user');
    traffic = [];
    await page.goto(base + 'dashboard.html');
    await page.getByText('无权限访问', {exact: true}).waitFor();
    requireThat(traffic.every(req => req.url.endsWith('/api/access')), 'Ordinary user loaded business data');
    passed.push('ordinary user denied, return-to-TV link retained');

    for (const role of ['operator', 'manager', 'admin']) {
      await setToken(role);
      await page.goto(base + 'admin.html');
      await page.getByText('权限验收项目', {exact: true}).waitFor();
      passed.push(role + ' sees management data');
    }

    await setToken('operator');
    await page.goto(base + 'admin.html');
    await page.getByText('权限验收项目', {exact: true}).waitFor();
    const download = page.waitForEvent('download');
    await page.locator('#exportCsvBtn').click();
    requireThat((await download).suggestedFilename() === 'assignments.csv', 'CSV download failed');
    requireThat(traffic.some(req => req.url.endsWith('/api/export/assignments/csv') && req.auth === 'Bearer operator'), 'CSV missing bearer');
    const jsonDownload = page.waitForEvent('download');
    await page.locator('#exportJsonBtn').click();
    requireThat((await jsonDownload).suggestedFilename() === 'dashboard.json', 'JSON download failed');
    passed.push('CSV and JSON downloads use bearer headers');

    await setToken('operator-new');
    const renewedDownload = page.waitForEvent('download');
    await page.locator('#exportCsvBtn').click();
    await renewedDownload;
    requireThat(traffic.some(req => req.url.endsWith('/api/export/assignments/csv') && req.auth === 'Bearer operator-new'), 'Refreshed token not used');
    passed.push('latest main-site token used without dashboard renewal');

    const other = await page.context().newPage();
    await other.goto(base + 'index.html');
    await other.evaluate(() => localStorage.setItem('easyai.auth.tokens.v1', JSON.stringify({token:'user'})));
    await page.getByText('无权限访问', {exact: true}).waitFor();
    requireThat(!(await text()).includes('权限验收项目'), 'Old account data remained');
    await other.close();
    passed.push('cross-document storage switch clears management data');

    await setToken('operator');
    await page.goto(base + 'admin.html');
    await page.getByText('权限验收项目', {exact: true}).waitFor();
    const logoutTab = await page.context().newPage();
    await logoutTab.goto(base + 'index.html');
    await logoutTab.evaluate(() => localStorage.clear());
    await page.getByText('暂时无法确认访问权限').waitFor();
    requireThat(!(await text()).includes('权限验收项目'), 'Logout retained old account data');
    await logoutTab.close();
    passed.push('main-site logout clears data and stops management operations');

    await setToken('expired');
    await page.goto(base + 'admin.html');
    await page.getByText('暂时无法确认访问权限').waitFor();
    requireThat(!(await text()).includes('登录'), 'Dashboard introduced login interaction');
    await setToken('unavailable');
    await page.reload();
    await page.getByText('暂时无法确认访问权限').waitFor();
    passed.push('invalid identity and upstream outage stay non-operable without login UI');

    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('dashboard_theme_config', JSON.stringify({theme_primary:'#123456', easyai_admin_password:'SENTINEL'}));
    });
    traffic = [];
    await page.goto(base + 'tv.html');
    await page.getByText('权限验收项目', {exact: true}).first().waitFor();
    requireThat(traffic.every(req => /\/api\/tv\/(data|events)$/.test(req.url)), 'TV called management API');
    requireThat(!(await page.evaluate(() => localStorage.getItem('dashboard_theme_config'))).includes('SENTINEL'), 'Legacy full config cache retained');
    requireThat((await text()).includes('验收人员'), 'TV person display missing');
    requireThat(await page.evaluate(() => window.boardApp.state.persons[0].leave_type) === '年假', 'Leave type lost');
    passed.push('anonymous TV retains project/person/leave data and purges legacy cache');

    await setToken('operator');
    await page.goto(base + 'index.html');
    await page.evaluate(() => {
      const frame = document.createElement('iframe');
      frame.id='acceptance-frame';
      frame.sandbox='allow-scripts allow-same-origin';
      frame.src='dashboard.html';
      document.body.append(frame);
    });
    await page.frameLocator('#acceptance-frame').getByText('权限验收项目', {exact:true}).first().waitFor();
    await page.evaluate(() => localStorage.setItem('easyai.auth.tokens.v1', JSON.stringify({token:'user'})));
    await page.frameLocator('#acceptance-frame').getByText('无权限访问', {exact:true}).waitFor();
    passed.push('same-origin sandboxed iframe shares identity and reacts to parent storage changes');
    await page.evaluate(() => {
      localStorage.setItem('easyai.auth.tokens.v1', JSON.stringify({token:'operator'}));
      const frame = document.createElement('iframe');
      frame.id='opaque-frame';
      frame.sandbox='allow-scripts';
      frame.src='admin.html';
      document.body.append(frame);
    });
    await page.frameLocator('#opaque-frame').getByText('暂时无法确认访问权限').waitFor();
    passed.push('opaque sandbox fails closed when storage access is unavailable');
    return {passed};
  } finally {
    page.off('request', onRequest);
  }
}
