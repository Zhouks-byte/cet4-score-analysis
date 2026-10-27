/* 宽屏录入页检查：侧栏是否吸顶、预览是否在右栏、即时提示是否显示 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { existsSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

const URL = process.argv[2];
const PORT = 9367;
mkdirSync('qa/shots', { recursive: true });
const profile = tmpdir() + '/cet4entry-' + Date.now().toString(36);
if (existsSync(profile)) rmSync(profile, { recursive: true, force: true });
const bin = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const child = spawn(bin, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore'] });

let wsUrl = null;
for (let i = 0; i < 160 && !wsUrl; i++) {
  await sleep(250);
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl; } catch {}
}
const ws = new WebSocket(wsUrl);
await new Promise(r => { ws.onopen = r; });
let id = 1; const pend = new Map();
ws.onmessage = e => {
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
await ps('Runtime.enable'); await ps('Page.enable');
await ps('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });

const ev = async (expr) => {
  const r = await ps('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description };
  return r.result.value;
};

/* 桌面宽度 */
await ps('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
await ps('Page.navigate', { url: URL });
await sleep(1900);
await ev(`document.querySelector('[data-act="demo"]').click()`);
await sleep(1200);
await ev(`document.querySelector('.tab[data-view="entry"]').click()`);
await sleep(900);

const layout = await ev(`(() => {
  const main = document.querySelector('.entry-main');
  const side = document.querySelector('.entry-side');
  const prev = document.querySelector('#preview');
  const tip = document.querySelector('#sideTip');
  const r1 = main ? main.getBoundingClientRect() : null;
  const r2 = side ? side.getBoundingClientRect() : null;
  return {
    hasMain: !!main, hasSide: !!side,
    mainLeft: r1 ? Math.round(r1.left) : -1,
    sideLeft: r2 ? Math.round(r2.left) : -1,
    sideTop: r2 ? Math.round(r2.top) : -1,
    sideW: r2 ? Math.round(r2.width) : -1,
    sidePosition: side ? getComputedStyle(side).position : '',
    previewInSide: !!(side && side.contains(prev)),
    tipVisible: tip ? getComputedStyle(tip).display : 'none',
    tipItems: tip ? tip.querySelectorAll('li').length : 0,
    prevSticky: prev ? getComputedStyle(prev).position : '',
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth
  };
})()`);
console.log(JSON.stringify(layout, null, 1));

const shot = await ps('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: 1200, height: 1300, scale: 1 } });
writeFileSync('qa/shots/light-entry-desktop.png', Buffer.from(shot.data, 'base64'));
console.log('✓ qa/shots/light-entry-desktop.png');

ws.close(); child.kill(); process.exit(0);
