/*!
 * qa/cdp.mjs — 无依赖的 Edge/Chrome DevTools Protocol 驱动（扁平会话）
 * 用法：node qa/cdp.mjs <页面URL> <输出目录>
 * 功能：收集控制台错误 / 页面异常，按手机与平板尺寸截图，并执行交互脚本。
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';

const PAGE_URL = process.argv[2];
const OUT = resolve(process.argv[3] || 'qa/out');
const PORT = Number(process.env.QA_PORT || 9333);

mkdirSync(OUT, { recursive: true });
/* 浏览器 profile 放在系统临时目录：项目路径含中文时 Edge 启动不稳定 */
const profile = join(tmpdir(), 'cet4qa-profile-' + Date.now().toString(36));
if (existsSync(profile)) rmSync(profile, { recursive: true, force: true });

const candidates = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];
const bin = candidates.find(p => existsSync(p));
if (!bin) throw new Error('找不到浏览器可执行文件');

const browser = spawn(bin, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--allow-file-access-from-files',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1280,900', 'about:blank'
], { stdio: ['ignore', 'ignore', 'ignore'] });

/* ---------- 等待调试端口 ---------- */
let wsUrl = null;
for (let i = 0; i < 160 && !wsUrl; i++) {
  await sleep(250);
  try {
    const j = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
    wsUrl = j.webSocketDebuggerUrl;
  } catch { /* retry */ }
}
if (!wsUrl) { browser.kill(); throw new Error('浏览器调试端口未就绪'); }

/* ---------- 浏览器级连接 ---------- */
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let seq = 1;
const pending = new Map();
const problems = { console: [], exceptions: [], requests: [] };

function route(msg) {
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
    return;
  }
  if (msg.method === 'Runtime.consoleAPICalled') {
    const level = msg.params.type;
    if (level === 'error' || level === 'warning') {
      problems.console.push({
        level,
        text: msg.params.args.map(a => a.value ?? a.description ?? '').join(' ')
      });
    }
    return;
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    problems.exceptions.push({ text: d.exception?.description || d.text, line: d.lineNumber, url: d.url });
    return;
  }
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    problems.requests.push({ text: msg.params.entry.text, url: msg.params.entry.url });
  }
  if (msg.method === 'Page.loadEventFired' || msg.method === 'Page.frameNavigated') {
    loadWaiters.forEach(fn => fn(msg));
  }
}
ws.onmessage = (ev) => route(JSON.parse(ev.data));

function send(method, params = {}, sessionId) {
  const id = seq++;
  const payload = { id, method, params };
  if (sessionId) payload.sessionId = sessionId;
  ws.send(JSON.stringify(payload));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error('CDP 超时: ' + method)); }
    }, 25000);
  });
}

/* ---------- 页面会话（扁平模式） ---------- */
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const attach = await send('Target.attachToTarget', { targetId, flatten: true });
const SID = attach.sessionId;

const psend = (method, params = {}) => send(method, params, SID);
const loadWaiters = new Set();

await psend('Runtime.enable');
await psend('Log.enable');
await psend('Page.enable');
await psend('Network.enable');

async function goto(url) {
  let done = false;
  const loaded = new Promise((res) => {
    const fn = (msg) => {
      if (msg.method === 'Page.loadEventFired' && !done) { done = true; loadWaiters.delete(fn); res(); }
    };
    loadWaiters.add(fn);
    setTimeout(() => { if (!done) { done = true; loadWaiters.delete(fn); res(); } }, 9000);
  });
  await psend('Page.navigate', { url });
  await loaded;
  await sleep(350);
}

async function evaluate(expr) {
  const r = await psend('Runtime.evaluate', {
    expression: expr, returnByValue: true, awaitPromise: true, userGesture: true
  });
  if (r.exceptionDetails) {
    throw new Error('页面执行异常: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  }
  return r.result.value;
}

async function viewport(width, height, dpr = 1) {
  await psend('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: width < 700 });
  await sleep(240);
}

async function shot(name, fullPage = true) {
  let params;
  if (fullPage) {
    const meta = await evaluate('({ h: Math.min(5200, Math.max(document.documentElement.scrollHeight, 900)), w: document.documentElement.clientWidth })');
    params = { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: meta.w, height: meta.h, scale: 1 } };
  } else {
    params = { format: 'png' };
  }
  const r = await psend('Page.captureScreenshot', params);
  writeFileSync(join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
  return name + '.png';
}

/* ---------- 断言 ---------- */
const report = { url: PAGE_URL, shots: [], checks: [], startedAt: new Date().toISOString() };
function check(name, cond, detail) {
  report.checks.push({ name, ok: !!cond, detail: cond ? '' : String(detail ?? '') });
  console.log((cond ? '✓ ' : '✗ ') + name + (cond ? '' : ' → ' + detail));
}

/* ---------- 测试流程 ---------- */
try {
  await viewport(390, 844, 2);
  await goto(PAGE_URL);

  const base = await evaluate(`(() => ({
    title: document.title,
    h1: document.querySelector('.brand-text h1')?.textContent,
    tabs: document.querySelectorAll('.tabbar .tab').length,
    viewCls: document.querySelector('#view')?.className,
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    libs: !!(window.CET4_MODEL && window.CET4_CONTENT && window.CET4_CHARTS && window.CET4_ANALYSIS),
    empties: document.querySelectorAll('.empty').length,
    themeColor: getComputedStyle(document.body).backgroundColor
  }))()`);
  check('页面标题包含站名', base.title.includes('四级成绩分析'), base.title);
  check('四个核心库均已加载', base.libs, JSON.stringify(base));
  check('底部导航 4 个标签', base.tabs === 4, base.tabs);
  check('首次进入显示空状态', base.empties >= 1, base.empties);
  check('手机端首屏无横向溢出', base.scrollW <= base.clientW + 1, `scrollW=${base.scrollW} clientW=${base.clientW}`);
  report.shots.push(await shot('01-mobile-empty'));

  /* 载入示例 */
  await evaluate(`document.querySelector('[data-act="demo"]').click()`);
  await sleep(700);
  const home = await evaluate(`(() => ({
    records: window.__CET4_APP__.state.records.length,
    charts: [...document.querySelectorAll('.chart-wrap')].map(e => ({ id: e.id || e.parentNode.querySelector('.card-title')?.textContent?.trim(), svg: !!e.querySelector('svg'), h: Math.round(e.querySelector('svg')?.getBoundingClientRect().height || 0) })),
    topbar: document.querySelector('#topbarMeta')?.textContent || '',
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    statCards: document.querySelectorAll('.stat').length,
    ringTxt: document.querySelector('.ring-txt b')?.textContent
  }))()`);
  check('示例数据载入 4 条', home.records === 4, home.records);
  check('首页 3 张图表全部渲染', home.charts.length >= 3 && home.charts.every(c => c.svg), JSON.stringify(home.charts));
  check('图表有实际高度', home.charts.every(c => c.h > 80), JSON.stringify(home.charts.map(c => c.h)));
  check('顶栏显示估分与目标', /\d+ 分/.test(home.topbar), home.topbar);
  check('首页统计卡 4 个', home.statCards === 4, home.statCards);
  check('环形图显示估分数字', /\d+/.test(home.ringTxt || ''), home.ringTxt);
  check('首页无横向溢出', home.scrollW <= home.clientW + 1, `scrollW=${home.scrollW}`);
  report.shots.push(await shot('02-mobile-home'));

  /* 趋势切换 */
  await evaluate(`document.querySelectorAll('[data-act="chart-mode"]')[1].click()`);
  await sleep(500);
  const trendParts = await evaluate(`(() => ({
    lines: document.querySelectorAll('#chartTrend path[stroke]').length,
    legend: document.querySelectorAll('.legend button').length,
    svg: !!document.querySelector('#chartTrend svg')
  }))()`);
  check('分项趋势切换后多线渲染', trendParts.svg && trendParts.lines >= 4, JSON.stringify(trendParts));
  check('分项图例 4 项', trendParts.legend === 4, trendParts.legend);
  report.shots.push(await shot('02b-mobile-trend-parts'));

  /* 录入页 */
  await evaluate(`document.querySelector('.tab[data-view="entry"]').click()`);
  await sleep(450);
  const entry = await evaluate(`(() => ({
    inputs: document.querySelectorAll('[data-num]').length,
    ranges: document.querySelectorAll('[data-range]').length,
    preview: !!document.querySelector('#preview'),
    previewScore: document.querySelector('#preview .pv-score b')?.textContent,
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth
  }))()`);
  check('录入页 6 个题数输入', entry.inputs === 6, entry.inputs);
  check('录入页 2 个自评滑杆', entry.ranges === 2, entry.ranges);
  check('实时预览条存在', entry.preview, entry.preview);
  check('录入页无横向溢出', entry.scrollW <= entry.clientW + 1, `scrollW=${entry.scrollW}`);
  report.shots.push(await shot('03-mobile-entry'));

  /* 步进器联动 */
  const stepRes = await evaluate(`(() => {
    const before = document.querySelector('#preview .pv-score b').textContent;
    const plus = document.querySelector('[data-act="step"][data-part="careful"][data-delta="1"]');
    for (let i = 0; i < 5; i++) plus.click();
    return {
      before, after: document.querySelector('#preview .pv-score b').textContent,
      partOut: document.querySelector('[data-out-part="careful"]').textContent,
      inputVal: document.querySelector('[data-num="careful"]').value
    };
  })()`);
  check('步进器（+5 题）实时估分上升', Number(stepRes.after) > Number(stepRes.before), JSON.stringify(stepRes));
  check('仔细阅读每题 14.2 分联动', Math.abs(Number(stepRes.partOut) - Number(stepRes.inputVal) * 14.2) < 0.6, JSON.stringify(stepRes));

  /* 越界与清空 */
  const bound = await evaluate(`(() => {
    const i = document.querySelector('[data-num="news"]');
    i.value = 99; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true }));
    const clamped = { input: document.querySelector('[data-num="news"]').value, state: window.__CET4_APP__.state.draft.parts.news };
    const j = document.querySelector('[data-num="news"]');
    j.value = ''; j.dispatchEvent(new Event('input', { bubbles: true })); j.dispatchEvent(new Event('change', { bubbles: true }));
    return { clamped, empty: window.__CET4_APP__.state.draft.parts.news };
  })()`);
  check('题数超过上限自动截断为 7', Number(bound.clamped.state) === 7, JSON.stringify(bound));
  check('清空输入按 0 处理', Number(bound.empty) === 0, JSON.stringify(bound));

  /* 主观题档位 */
  const tierRes = await evaluate(`(() => {
    [...document.querySelectorAll('.chip[data-act="sub-preset"][data-key="writing"]')].find(x => x.dataset.val === '14').click();
    return {
      badge: document.querySelector('[data-tier-out="writing"]').textContent,
      sub: document.querySelector('[data-sub-out="writing"]').textContent,
      desc: document.querySelector('[data-tier-desc="writing"]').textContent.slice(0, 14)
    };
  })()`);
  check('写作 14 分联动「14分档」', tierRes.badge === '14分档', JSON.stringify(tierRes));
  check('档位描述同步更新', tierRes.desc.length > 6, JSON.stringify(tierRes));

  /* 保存并进入分析 */
  await evaluate(`document.querySelector('[data-act="save"]').click()`);
  await sleep(800);
  const analysis = await evaluate(`(() => ({
    view: window.__CET4_APP__.state.view,
    records: window.__CET4_APP__.state.records.length,
    diag: document.querySelectorAll('.diag-item').length,
    plan: document.querySelectorAll('.plan-item').length,
    charts: [...document.querySelectorAll('.chart-wrap')].map(e => !!e.querySelector('svg')),
    advice: document.querySelectorAll('.advice li').length,
    stage: document.querySelectorAll('#stageBody .plan-item').length,
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    planText: document.querySelector('.plan-item .plan-title')?.textContent || ''
  }))()`);
  check('保存后自动跳转分析页', analysis.view === 'analysis', analysis.view);
  check('记录数增至 5', analysis.records === 5, analysis.records);
  check('关键发现 ≥ 3 条', analysis.diag >= 3, analysis.diag);
  check('提分路径有条目', analysis.plan >= 1, analysis.plan + ' ' + analysis.planText);
  check('分析页图表已渲染', analysis.charts.every(Boolean) && analysis.charts.length >= 1, JSON.stringify(analysis.charts));
  check('学习计划模板已渲染', analysis.stage >= 5, analysis.stage);
  check('建议动作已渲染', analysis.advice >= 4, analysis.advice);
  check('分析页无横向溢出', analysis.scrollW <= analysis.clientW + 1, `scrollW=${analysis.scrollW}`);
  report.shots.push(await shot('04-mobile-analysis'));

  /* 目标切换 */
  const targetRes = await evaluate(`(() => {
    document.querySelector('.chip[data-act="target"][data-target="500"]').click();
    return { target: window.__CET4_APP__.state.target, plans: document.querySelectorAll('.plan-item').length };
  })()`);
  check('目标切换为 500 生效', targetRes.target === 500, JSON.stringify(targetRes));

  /* 记录页 */
  await evaluate(`document.querySelector('.tab[data-view="records"]').click()`);
  await sleep(600);
  const records = await evaluate(`(() => ({
    rows: document.querySelectorAll('table.tbl tbody tr').length,
    recs: document.querySelectorAll('.rec').length,
    stack: !!document.querySelector('#chartStackAll svg'),
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth
  }))()`);
  check('记录表列出 5 条', records.rows === 5, records.rows);
  check('成绩构成对比图已渲染', records.stack, records.stack);
  check('记录页无横向溢出', records.scrollW <= records.clientW + 1, `scrollW=${records.scrollW}`);
  report.shots.push(await shot('05-mobile-records'));

  /* 持久化 */
  await goto(PAGE_URL);
  await sleep(700);
  const persisted = await evaluate(`(() => ({
    records: window.__CET4_APP__.state.records.length,
    target: window.__CET4_APP__.state.target,
    topbar: document.querySelector('#topbarMeta')?.textContent
  }))()`);
  check('刷新后 5 条记录仍在', persisted.records === 5, JSON.stringify(persisted));
  check('刷新后目标设置保留', persisted.target === 500, JSON.stringify(persisted));

  /* 平板 */
  await viewport(820, 1180, 2);
  await goto(PAGE_URL);
  await sleep(700);
  const tablet = await evaluate(`(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    svgs: document.querySelectorAll('.chart-wrap svg').length,
    statCols: getComputedStyle(document.querySelector('.stat-grid')).gridTemplateColumns.split(' ').length
  }))()`);
  check('平板端无横向溢出', tablet.scrollW <= tablet.clientW + 1, `scrollW=${tablet.scrollW} clientW=${tablet.clientW}`);
  check('平板端图表 ≥3 张', tablet.svgs >= 3, tablet.svgs);
  check('平板端统计卡改为 4 列', tablet.statCols === 4, tablet.statCols);
  report.shots.push(await shot('06-tablet-home'));

  /* 桌面 */
  await viewport(1180, 900, 1);
  await goto(PAGE_URL);
  await sleep(700);
  const desk = await evaluate(`(() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }))()`);
  check('桌面端无横向溢出', desk.scrollW <= desk.clientW + 1, `scrollW=${desk.scrollW}`);
  report.shots.push(await shot('07-desktop-home'));

  /* 深色 */
  await viewport(390, 844, 2);
  await psend('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await goto(PAGE_URL);
  await sleep(700);
  const dark = await evaluate(`(() => ({ bg: getComputedStyle(document.body).backgroundColor, scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }))()`);
  check('深色模式背景变暗', /rgb\((\d+), (\d+), (\d+)\)/.test(dark.bg) && Number(RegExp.$1) < 60, dark.bg);
  report.shots.push(await shot('08-mobile-dark'));

  /* 320 窄屏 */
  await psend('Emulation.setEmulatedMedia', { features: [] });
  await viewport(320, 640, 2);
  await goto(PAGE_URL);
  await sleep(700);
  const narrow = await evaluate(`(() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }))()`);
  check('320px 窄屏无横向溢出', narrow.scrollW <= narrow.clientW + 1, `scrollW=${narrow.scrollW}`);
  report.shots.push(await shot('09-mobile-320'));
} catch (err) {
  report.fatal = String(err && err.message || err);
  console.log('✗ 测试中断：' + report.fatal);
}

/* ---------- 汇总 ---------- */
report.console = problems.console;
report.exceptions = problems.exceptions;
report.networkErrors = problems.requests;
const okCount = report.checks.filter(c => c.ok).length;
report.summary = `${okCount}/${report.checks.length} 通过`;
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8');

if (problems.exceptions.length) {
  console.log('\n页面异常：');
  problems.exceptions.forEach(e => console.log('  ! ' + String(e.text).split('\n')[0]));
}
if (problems.console.length) {
  console.log('\n控制台错误/警告：');
  problems.console.forEach(e => console.log('  ! [' + e.level + '] ' + e.text.slice(0, 220)));
}
if (problems.requests.length) {
  console.log('\n资源错误：');
  problems.requests.forEach(e => console.log('  ! ' + e.text.slice(0, 180)));
}
console.log('\n' + report.summary + '，截图 ' + report.shots.length + ' 张 → ' + OUT);

ws.close();
browser.kill();
process.exit(okCount === report.checks.length && !report.fatal && !problems.exceptions.length ? 0 : 1);
