/* 渲染多个 SVG 图标到同一张对比图：含大图与 16/24/32px 小尺寸，检查缩小时的可辨识度 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { existsSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

const files = process.argv.slice(3);
const outName = process.argv[2];
const PORT = 9385;
mkdirSync('qa/shots', { recursive: true });
const profile = tmpdir() + '/icons-' + Date.now().toString(36);
if (existsSync(profile)) rmSync(profile, { recursive: true, force: true });
const bin = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const child = spawn(bin, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1200,1000', 'about:blank'],
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

const urls = files.map(f => 'file:///' + f.replace(/\\/g, '/'));
const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  body{margin:0;background:#f2f3f8;font-family:system-ui,'Segoe UI','PingFang SC',sans-serif}
  .wrap{display:flex;gap:40px;padding:36px;align-items:flex-start}
  .col{display:flex;flex-direction:column;gap:14px;align-items:center}
  .lab{font-size:13px;color:#555;font-weight:600}
  .big{width:300px;height:300px;border-radius:26%;overflow:hidden;box-shadow:0 10px 30px -12px rgba(40,30,120,.5)}
  .big img{width:100%;height:100%;display:block}
  .sizes{display:flex;gap:18px;align-items:flex-end}
  .sz{display:flex;flex-direction:column;align-items:center;gap:6px;font-size:11px;color:#777}
  .sz img{display:block;image-rendering:auto}
</style></head><body><div class="wrap">
${urls.map((u, i) => `
  <div class="col">
    <div class="lab">方案 ${i + 1}</div>
    <div class="big"><img src="${u}"></div>
    <div class="sizes">
      <div class="sz"><img src="${u}" width="64" height="64"><span>64</span></div>
      <div class="sz"><img src="${u}" width="32" height="32"><span>32</span></div>
      <div class="sz"><img src="${u}" width="24" height="24"><span>24</span></div>
      <div class="sz"><img src="${u}" width="16" height="16"><span>16</span></div>
    </div>
  </div>`).join('')}
</div></body></html>`;
writeFileSync('qa/shots/_icons.html', html, 'utf8');

await ps('Emulation.setDeviceMetricsOverride', { width: 1160, height: 560, deviceScaleFactor: 2, mobile: false });
await ps('Page.navigate', { url: 'file:///' + process.cwd().replace(/\\/g, '/') + '/qa/shots/_icons.html' });
await sleep(1600);
const r = await ps('Page.captureScreenshot', { format: 'png' });
writeFileSync('qa/shots/' + outName + '.png', Buffer.from(r.data, 'base64'));
console.log('✓ qa/shots/' + outName + '.png');
ws.close(); child.kill(); process.exit(0);
