/* 把浮层固定到视口已知位置后截图：用于验证配色与文字渲染（不依赖事件时序） */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { existsSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

const URL = process.argv[2];
const PORT = 9407;
mkdirSync('qa/shots', { recursive: true });
const profile = tmpdir() + '/tipfix-' + Date.now().toString(36);
if (existsSync(profile)) rmSync(profile, { recursive: true, force: true });
const bin = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const child = spawn(bin, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--no-default-browser-check', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'],
  { stdio: ['ignore', 'ignore', 'ignore'] });

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
  if (r.exceptionDetails) return { err: r.exceptionDetails.exception?.description };
  return r.result.value;
};

async function run(mode, tag, variant) {
  await ps('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await ps('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode }] });
  await ps('Page.navigate', { url: URL });
  await sleep(1700);
  if (await ev(`!!document.querySelector('[data-act="demo"]')`)) {
    await ev(`document.querySelector('[data-act="demo"]').click()`);
    await sleep(1300);
  }

  /* 取真实 data-tip 内容，克隆成固定定位的浮层，放到视口左上角，确保可见 */
  const info = await ev(`(() => {
    const src = document.querySelector(${JSON.stringify(variant.selector)} + ' [data-tip]');
    if (!src) return { err: 'no source node' };
    const html = src.getAttribute('data-tip');
    const old = document.querySelector('.chart-tip');
    if (old) old.remove();
    const t = document.createElement('div');
    t.className = 'chart-tip show';
    t.innerHTML = html;
    t.style.position = 'fixed';
    t.style.left = '16px';
    t.style.top = '16px';
    t.style.transform = 'none';
    t.style.opacity = '1';
    t.style.zIndex = '999';
    document.body.appendChild(t);
    const cs = getComputedStyle(t);
    const r = t.getBoundingClientRect();
    return { bg: cs.backgroundColor, color: cs.color, border: cs.borderColor,
             w: Math.round(r.width), h: Math.round(r.height), html };
  })()`);
  console.log('[' + tag + ']', JSON.stringify(info));
  await sleep(250);

  const shot = await ps('Page.captureScreenshot', {
    format: 'png',
    clip: { x: 0, y: 0, width: 390, height: Math.max(140, (info.h || 90) + 40), scale: 3 }
  });
  writeFileSync(`qa/shots/tipfix-${tag}.png`, Buffer.from(shot.data, 'base64'));
  console.log('✓ qa/shots/tipfix-' + tag + '.png');
}

for (const mode of ['dark', 'light']) {
  await run(mode, mode + '-stack', { selector: '#chartStack' });
  await run(mode, mode + '-trend', { selector: '#chartTrend' });
  await run(mode, mode + '-donut', { selector: '#chartDonut' });
}

ws.close(); child.kill(); process.exit(0);
