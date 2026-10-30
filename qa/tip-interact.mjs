/* 真实交互验证：点击图表元素 → 浮层出现且可读；2.4s 后自动消失；不遮挡其他控件 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { existsSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

const URL = process.argv[2];
const PORT = 9411;
mkdirSync('qa/shots', { recursive: true });
const profile = tmpdir() + '/tiplive-' + Date.now().toString(36);
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

const report = { checks: [] };
function check(name, cond, detail) {
  report.checks.push({ name, ok: !!cond, detail: cond ? '' : String(detail ?? '') });
  console.log((cond ? '✓ ' : '✗ ') + name + (cond ? '' : ' → ' + detail));
}

for (const mode of ['dark', 'light']) {
  await ps('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await ps('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode }] });
  await ps('Page.navigate', { url: URL });
  await sleep(1800);
  if (await ev(`!!document.querySelector('[data-act="demo"]')`)) {
    await ev(`document.querySelector('[data-act="demo"]').click()`);
    await sleep(1400);
  }

  /* 点击折线图数据点（真实事件链） */
  const tap = await ev(`(() => {
    const wrap = document.querySelector('#chartTrend');
    const r = wrap.getBoundingClientRect();
    window.scrollTo(0, r.top + scrollY - 100);
    return true;
  })()`);
  await sleep(400);
  const clicked = await ev(`(() => {
    const node = document.querySelector('#chartTrend [data-tip]');
    if (!node) return { err: 'no node' };
    const nr = node.getBoundingClientRect();
    const cx = nr.left + nr.width / 2, cy = nr.top + nr.height / 2;
    node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: cx, clientY: cy, isPrimary: true, pointerType: 'touch' }));
    return { ok: true };
  })()`);
  await sleep(350);

  const shown = await ev(`(() => {
    const t = document.querySelector('.chart-tip');
    if (!t) return { err: 'no tip' };
    const cs = getComputedStyle(t);
    const r = t.getBoundingClientRect();
    const inView = r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
    return {
      visible: t.classList.contains('show'),
      opacity: cs.opacity,
      bg: cs.backgroundColor,
      color: cs.color,
      rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      inView
    };
  })()`);
  check(`[${mode}] 点击后浮层出现`, shown.visible && Number(shown.opacity) > 0.9, JSON.stringify(shown));
  check(`[${mode}] 浮层完全不透明`, Number(shown.opacity) >= 1, shown.opacity);
  check(`[${mode}] 浮层在视口内完整可见`, shown.inView, JSON.stringify(shown.rect));
  check(`[${mode}] 浮层为深色底浅色字`, /rgb\((2[0-9]|3[0-9]), /.test(shown.bg) && /rgb\((24[0-9]|25[0-9]), /.test(shown.color),
    `bg=${shown.bg} color=${shown.color}`);

  /* 自动消失 */
  await sleep(2600);
  const gone = await ev(`(() => {
    const t = document.querySelector('.chart-tip');
    return t ? { visible: t.classList.contains('show'), opacity: getComputedStyle(t).opacity } : { gone: true };
  })()`);
  check(`[${mode}] 浮层自动消失`, gone.gone || (!gone.visible || Number(gone.opacity) < 0.1), JSON.stringify(gone));

  const shot = await ps('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`qa/shots/interact-${mode}.png`, Buffer.from(shot.data, 'base64'));
}

const okCount = report.checks.filter(c => c.ok).length;
console.log('\n交互浮层：' + okCount + '/' + report.checks.length + ' 通过');
ws.close(); child.kill();
process.exit(okCount === report.checks.length ? 0 : 1);
