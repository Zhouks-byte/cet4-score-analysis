/* 测量 SVG 内各元素的真实包围盒，检查「4」是否水平居中 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const PORT = 9391;
const profile = tmpdir() + '/bbox-' + Date.now().toString(36);
if (existsSync(profile)) rmSync(profile, { recursive: true, force: true });
const bin = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const child = spawn(bin, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=600,600', 'about:blank'],
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

const url = 'file:///D:/%E5%BA%94%E7%94%A8%E5%BC%80%E5%8F%91/cet4-score-analysis/assets/icon.svg';
await ps('Page.navigate', { url });
await sleep(1200);

const ev = async (expr) => {
  const r = await ps('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { err: r.exceptionDetails.exception?.description };
  return r.result.value;
};

const res = await ev(`(() => {
  const svg = document.querySelector('svg');
  const text = svg.querySelector('text');
  const tb = text.getBBox();
  const circles = [...svg.querySelectorAll('circle')].map(c => {
    const b = c.getBBox();
    return { cx: +b.x.toFixed(1), cy: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) };
  });
  return {
    textBox: { x: +tb.x.toFixed(1), y: +tb.y.toFixed(1), w: +tb.width.toFixed(1), h: +tb.height.toFixed(1) },
    textCenterX: +(tb.x + tb.width / 2).toFixed(1),
    textCenterY: +(tb.y + tb.height / 2).toFixed(1),
    canvasCenter: 256,
    circles
  };
})()`);
console.log(JSON.stringify(res, null, 1));

ws.close(); child.kill(); process.exit(0);
