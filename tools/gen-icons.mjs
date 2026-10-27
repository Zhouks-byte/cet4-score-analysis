/*!
 * tools/gen-icons.mjs — 由 assets/icon.svg 生成各尺寸 favicon / PWA 图标
 * 依赖：本机 Edge / Chrome（通过 CDP 截图渲染，无第三方图形库）
 * 输出：
 *   assets/favicon.svg        站点图标（SVG，主用）
 *   assets/icon-16.png  ...   16/32/48/64/180/192/512
 *   assets/apple-touch-icon.png (180)
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'assets', 'icon.svg');
const SIZES = [16, 32, 48, 64, 128, 180, 192, 512];
const PORT = 9395;

mkdirSync(join(root, 'assets'), { recursive: true });
copyFileSync(SRC, join(root, 'assets', 'favicon.svg'));

const svg = readFileSync(SRC, 'utf8');
const dataUri = 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64');

const profile = join(tmpdir(), 'cet4icon-' + Date.now().toString(36));
if (existsSync(profile)) rmSync(profile, { recursive: true, force: true });
const bin = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(p => existsSync(p));
const browser = spawn(bin, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
  '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'],
  { stdio: ['ignore', 'ignore', 'ignore'] });

let wsUrl = null;
for (let i = 0; i < 160 && !wsUrl; i++) {
  await sleep(250);
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl; } catch {}
}
if (!wsUrl) { browser.kill(); throw new Error('浏览器未就绪'); }

const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 1; const pend = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) {
    const p = pend.get(m.id); pend.delete(m.id);
    m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
  }
};
const send = (method, params = {}, sessionId) => {
  const id = seq++;
  const payload = { id, method, params };
  if (sessionId) payload.sessionId = sessionId;
  ws.send(JSON.stringify(payload));
  return new Promise((res, rej) => {
    pend.set(id, { res, rej });
    setTimeout(() => { if (pend.has(id)) { pend.delete(id); rej(new Error('CDP 超时 ' + method)); } }, 20000);
  });
};

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const ps = (m, p) => send(m, p, sessionId);
await ps('Page.enable');
await ps('Runtime.enable');

/* 构造一个只含图标的页面，尺寸精确控制 */
const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:transparent}
#c{display:block;width:100vw;height:100vh}
#c img{width:100%;height:100%;display:block}
</style></head><body><div id="c"><img id="i" src="${dataUri}"></div>
<script>
window.__ready = false;
document.getElementById('i').onload = () => { window.__ready = true; };
</script></body></html>`;

const pagePath = join(root, 'qa', 'shots', '_iconpage.html');
mkdirSync(dirname(pagePath), { recursive: true });
writeFileSync(pagePath, html, 'utf8');

for (const size of SIZES) {
  /* deviceScaleFactor=1 + 精确视口 = 精确像素尺寸 */
  await ps('Emulation.setDeviceMetricsOverride', {
    width: size, height: size, deviceScaleFactor: 1, mobile: false
  });
  await ps('Page.navigate', { url: 'file:///' + pagePath.replace(/\\/g, '/') });
  /* 等图片解码完成 */
  for (let t = 0; t < 30; t++) {
    const ok = await ps('Runtime.evaluate', { expression: 'window.__ready === true', returnByValue: true });
    if (ok.result && ok.result.value) break;
    await sleep(100);
  }
  await sleep(120);
  const shot = await ps('Page.captureScreenshot', {
    format: 'png',
    clip: { x: 0, y: 0, width: size, height: size, scale: 1 },
    captureBeyondViewport: false,
    omitBackground: true
  });
  const buf = Buffer.from(shot.data, 'base64');
  const out = join(root, 'assets', `icon-${size}.png`);
  writeFileSync(out, buf);
  console.log(`✓ icon-${size}.png  ${buf.length} B`);
}

/* apple-touch-icon 用 180 副本 */
copyFileSync(join(root, 'assets', 'icon-180.png'), join(root, 'assets', 'apple-touch-icon.png'));
console.log('✓ apple-touch-icon.png');

ws.close();
browser.kill();
console.log('完成');
process.exit(0);
