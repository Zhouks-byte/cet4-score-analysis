/*!
 * qa/pwa-live.mjs — 真实浏览器验证 PWA 能力
 *   1. Service Worker 是否成功注册并激活
 *   2. 断开网络后能否从缓存打开（离线可用）
 *   3. 二次加载是否命中缓存（秒开）
 *   4. 安装 UI 是否渲染、manifest 是否可解析
 *   5. 独立模式（display-mode: standalone）下的样式
 * 需要 http(s) 环境（SW 不支持 file://），因此用本地静态服务器。
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, existsSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';

const DIST = resolve('dist');
const PORT_HTTP = 8712;
const PORT_CDP = 9421;
mkdirSync('qa/shots', { recursive: true });

/* ---------------- 静态服务器 ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};
const server = createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = join(DIST, urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, ''));
  if (!existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  const body = readFileSync(file);
  res.writeHead(200, {
    'Content-Type': MIME[extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
    'Service-Worker-Allowed': '/'
  });
  res.end(body);
});
await new Promise((r) => server.listen(PORT_HTTP, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${PORT_HTTP}/`;

/* ---------------- 浏览器 ---------------- */
const profile = join(tmpdir(), 'cet4pwa-' + Date.now().toString(36));
if (existsSync(profile)) rmSync(profile, { recursive: true, force: true });
const bin = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const child = spawn(bin, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${PORT_CDP}`, `--user-data-dir=${profile}`, 'about:blank'],
  { stdio: ['ignore', 'ignore', 'ignore'] });

let wsUrl = null;
for (let i = 0; i < 160 && !wsUrl; i++) {
  await sleep(250);
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${PORT_CDP}/json/version`)).json()).webSocketDebuggerUrl; } catch {}
}
const ws = new WebSocket(wsUrl);
await new Promise((r) => { ws.onopen = r; });
let id = 1; const pend = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
};
const send = (method, params = {}, sessionId) => {
  const i = id++;
  ws.send(JSON.stringify({ id: i, method, params, sessionId }));
  return new Promise((res, rej) => pend.set(i, { res, rej }));
};
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const ps = (m, p) => send(m, p, sessionId);
await ps('Runtime.enable'); await ps('Page.enable'); await ps('Network.enable');

const ev = async (expr) => {
  const r = await ps('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description };
  return r.result.value;
};

const report = { checks: [] };
function check(name, cond, detail) {
  report.checks.push({ name, ok: !!cond, detail: cond ? '' : String(detail ?? '') });
  console.log((cond ? '✓ ' : '✗ ') + name + (cond ? '' : ' → ' + detail));
}

try {
  /* -------- 1. 首次加载 + SW 注册 -------- */
  await ps('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await ps('Page.navigate', { url: BASE });
  await sleep(2500);

  const reg = await ev(`(async () => {
    if (!('serviceWorker' in navigator)) return { supported: false };
    const regs = await navigator.serviceWorker.getRegistrations();
    const active = regs.find(r => r.active) || regs[0];
    return {
      supported: true,
      count: regs.length,
      scope: active ? active.scope : null,
      state: active && active.active ? active.active.state : null,
      controller: !!navigator.serviceWorker.controller
    };
  })()`);
  check('浏览器支持 Service Worker', reg.supported, JSON.stringify(reg));
  check('SW 已注册', reg.count > 0, JSON.stringify(reg));
  check('SW 已激活', reg.state === 'activated', reg.state);

  /* 等 SW 接管（首次加载 controller 可能为 null，刷新后才有） */
  await ps('Page.navigate', { url: BASE });
  await sleep(2000);
  const reg2 = await ev(`(() => ({
    controller: !!navigator.serviceWorker.controller,
    scope: navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL : null
  }))()`);
  check('刷新后 SW 接管页面（controller 非空）', reg2.controller, JSON.stringify(reg2));

  /* -------- 2. 缓存内容 -------- */
  const cacheInfo = await ev(`(async () => {
    const keys = await caches.keys();
    const out = {};
    for (const k of keys) {
      const c = await caches.open(k);
      const reqs = await c.keys();
      out[k] = reqs.map(r => new URL(r.url).pathname);
    }
    return out;
  })()`);
  const cacheNames = Object.keys(cacheInfo || {});
  const allCached = cacheNames.reduce((a, k) => a.concat(cacheInfo[k]), []);
  check('已创建 Cache Storage', cacheNames.length > 0, JSON.stringify(cacheNames));
  check('缓存包含 index.html', allCached.some(p => /index\.html|\/$/.test(p)), JSON.stringify(allCached.slice(0, 4)));
  check('缓存包含图标', allCached.some(p => /icon-\d+\.png/.test(p)), JSON.stringify(allCached.slice(0, 6)));
  check('缓存条目 ≥ 5', allCached.length >= 5, allCached.length);

  /* -------- 3. 离线可用（关键能力） -------- */
  await ps('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await ps('Page.navigate', { url: BASE });
  await sleep(2200);
  const offline = await ev(`(() => ({
    title: document.title,
    tabs: document.querySelectorAll('.tabbar .tab').length,
    libs: typeof window.CET4_MODEL,
    bodyLen: document.body.innerText.length
  }))()`);
  check('断网后仍能打开页面（离线可用）', offline.tabs === 4 && offline.libs === 'object', JSON.stringify(offline));
  check('离线页面标题正确', /四级成绩分析/.test(offline.title || ''), offline.title);

  /* 离线时功能可用：载入示例并检查图表 */
  const offlineFn = await ev(`(() => {
    const btn = document.querySelector('[data-act="demo"]');
    if (!btn) return { err: 'no demo btn' };
    btn.click();
    return { clicked: true };
  })()`);
  await sleep(1200);
  const offlineCharts = await ev(`(() => ({
    records: window.__CET4_APP__ ? window.__CET4_APP__.state.records.length : -1,
    svgs: document.querySelectorAll('.chart-wrap svg').length
  }))()`);
  check('离线状态下功能正常（可载入示例并出图）',
    offlineCharts.records === 4 && offlineCharts.svgs > 0,
    JSON.stringify(offlineCharts));

  /* -------- 4. 恢复网络 -------- */
  await ps('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await sleep(300);

  /* -------- 5. 安装 UI -------- */
  const installUI = await ev(`(() => {
    const bar = document.querySelector('.install-bar');
    const guide = document.querySelector('.guide-mask');
    return {
      hasBar: !!bar,
      barVisible: bar ? bar.classList.contains('show') : false,
      hasGuide: !!guide,
      displayModeStandalone: window.matchMedia('(display-mode: standalone)').matches
    };
  })()`);
  check('安装提示条已渲染', installUI.hasBar, JSON.stringify(installUI));

  /* -------- 6. manifest 可被浏览器解析 -------- */
  const mf = await ev(`(async () => {
    const link = document.querySelector('link[rel="manifest"]');
    if (!link) return { err: 'no manifest link' };
    const res = await fetch(link.href);
    const json = await res.json();
    return { href: link.getAttribute('href'), name: json.name, display: json.display, icons: (json.icons || []).length };
  })()`);
  check('manifest 可被解析', mf && mf.name === '四级成绩分析', JSON.stringify(mf));
  check('manifest display=standalone', mf && mf.display === 'standalone', mf && mf.display);

  /* -------- 7. 独立模式适配 --------
     无头浏览器不支持模拟 display-mode，改为验证：
       a) CSS 中存在独立模式规则且隐藏安装条
       b) 页面暴露 standalone 判定 API 并可调用 */
  const cssCheck = await ev(
    '(() => {' +
    '  var styles = "";' +
    '  var nodes = document.querySelectorAll("style");' +
    '  for (var i = 0; i < nodes.length; i++) { styles += nodes[i].textContent || ""; }' +
    '  var idx = styles.indexOf("@media (display-mode: standalone)");' +
    '  var seg = idx >= 0 ? styles.slice(idx, idx + 600) : "";' +
    '  return {' +
    '    hasRule: idx >= 0,' +
    '    hidesBar: seg.indexOf("install-bar") >= 0 && seg.indexOf("display: none") >= 0,' +
    '    hasApi: typeof window.__CET4_PWA__ === "object",' +
    '    hasFn: !!(window.__CET4_PWA__ && typeof window.__CET4_PWA__.isStandalone === "function")' +
    '  };' +
    '})()'
  );
  check('CSS 含独立模式规则', cssCheck.hasRule, JSON.stringify(cssCheck));
  check('独立模式隐藏安装条', cssCheck.hidesBar, JSON.stringify(cssCheck));
  check('提供独立模式判定 API', cssCheck.hasApi && cssCheck.hasFn, JSON.stringify(cssCheck));

  const standaloneCall = await ev('(() => { try { return { ok: true, value: window.__CET4_PWA__.isStandalone() }; } catch (e) { return { ok: false, err: e.message }; } })()');
  check('isStandalone() 调用不抛错', standaloneCall.ok, JSON.stringify(standaloneCall));

  await ps('Emulation.setEmulatedMedia', { features: [] });

  /* -------- 8. 截图 -------- */
  const shot1 = await ps('Page.captureScreenshot', { format: 'png' });
  writeFileSync('qa/shots/pwa-normal.png', Buffer.from(shot1.data, 'base64'));

  const shot2 = await ps('Page.captureScreenshot', { format: 'png' });
  writeFileSync('qa/shots/pwa-install.png', Buffer.from(shot2.data, 'base64'));

  console.log('✓ 截图 qa/shots/pwa-*.png');
} catch (err) {
  check('测试流程无异常', false, err.message);
} finally {
  const okCount = report.checks.filter((c) => c.ok).length;
  console.log('\nPWA 浏览器验证：' + okCount + '/' + report.checks.length + ' 通过');
  ws.close();
  child.kill();
  server.close();
  process.exit(okCount === report.checks.length ? 0 : 1);
}
