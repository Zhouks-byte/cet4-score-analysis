/* 浅色模式 + 录入页专项截图 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { existsSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

const URL = process.argv[2];
const PORT = 9365;
mkdirSync('qa/shots', { recursive: true });
const profile = tmpdir() + '/cet4light-' + Date.now().toString(36);
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

const ev = async (expr) => {
  const r = await ps('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description };
  return r.result.value;
};

async function shot(name, sel) {
  let clip = null;
  if (sel) {
    clip = await ev(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.max(0, r.left + scrollX), y: Math.max(0, r.top + scrollY), width: Math.max(40, r.width), height: Math.max(40, r.height) };
    })()`);
    if (!clip || clip.__err) { console.log('✗ 找不到 ' + sel); return; }
  }
  const params = { format: 'png' };
  if (clip) { params.captureBeyondViewport = true; params.clip = { ...clip, scale: 2 }; }
  else {
    const h = await ev('Math.min(5200, Math.max(document.documentElement.scrollHeight, 900))');
    const w = await ev('document.documentElement.clientWidth');
    params.captureBeyondViewport = true;
    params.clip = { x: 0, y: 0, width: w, height: h, scale: 1 };
  }
  const r = await ps('Page.captureScreenshot', params);
  writeFileSync('qa/shots/' + name + '.png', Buffer.from(r.data, 'base64'));
  console.log('✓ ' + name + '.png');
}

/* ---------- 浅色模式 390 ---------- */
await ps('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 2, mobile: true });
await ps('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
await ps('Page.navigate', { url: URL });
await sleep(2000);
await ev(`document.querySelector('[data-act="demo"]').click()`);
await sleep(1500);
console.log('浅色背景:', await ev('getComputedStyle(document.body).backgroundColor'));
await shot('light-home-full');
await shot('light-hero', '.hero-card');
await shot('light-donut', '#chartDonut');
await shot('light-trend', '#chartTrend');

/* ---------- 录入页（浅色 + 深色） ---------- */
await ev(`document.querySelector('.tab[data-view="entry"]').click()`);
await sleep(800);
await shot('light-entry-top');
await shot('light-preview', '#preview');

await ps('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
await ps('Page.navigate', { url: URL });
await sleep(1800);
await ev(`document.querySelector('[data-act="demo"]').click()`);
await sleep(1200);
await ev(`document.querySelector('.tab[data-view="entry"]').click()`);
await sleep(900);
await shot('dark-entry-full');

/* ---------- 平板浅色 ---------- */
await ps('Emulation.setDeviceMetricsOverride', { width: 820, height: 1180, deviceScaleFactor: 2, mobile: true });
await ps('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
await ps('Page.navigate', { url: URL });
await sleep(1900);
await ev(`document.querySelector('[data-act="demo"]').click()`);
await sleep(1400);
await shot('light-tablet-full');

ws.close(); child.kill(); process.exit(0);
