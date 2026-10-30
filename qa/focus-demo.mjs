/* 演示：在 4 条记录之间逐条切换，验证每次显示的确是该条数据 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, existsSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';

const DIST = resolve('dist');
const PH = 8741, PC = 9451;
mkdirSync('qa/shots', { recursive: true });
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  const p = decodeURIComponent((req.url || '/').split('?')[0]);
  const f = join(DIST, p === '/' ? 'index.html' : p.replace(/^\/+/, ''));
  if (!existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(readFileSync(f));
});
await new Promise(r => server.listen(PH, '127.0.0.1', r));

const profile = join(tmpdir(), 'cet4demo-' + Date.now().toString(36));
if (existsSync(profile)) rmSync(profile, { recursive: true, force: true });
const bin = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const child = spawn(bin, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${PC}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore'] });
let wsUrl = null;
for (let i = 0; i < 160 && !wsUrl; i++) { await sleep(250); try { wsUrl = (await (await fetch(`http://127.0.0.1:${PC}/json/version`)).json()).webSocketDebuggerUrl; } catch {} }
const ws = new WebSocket(wsUrl);
await new Promise(r => { ws.onopen = r; });
let id = 1; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
const send = (m, p, s) => { const i = id++; ws.send(JSON.stringify({ id: i, method: m, params: p, sessionId: s })); return new Promise((res, rej) => pend.set(i, { res, rej })); };
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const ps = (m, p) => send(m, p, sessionId);
await ps('Runtime.enable'); await ps('Page.enable');
const ev = async (expr) => { const r = await ps('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return { err: r.exceptionDetails.exception?.description }; return r.result.value; };

await ps('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await ps('Page.navigate', { url: `http://127.0.0.1:${PH}/` });
await sleep(2000);
await ev(`document.querySelector('[data-act="demo"]').click()`);
await sleep(1300);

/* 列出 4 条记录的真实分数，作为期望值 */
const expected = await ev(`(() => {
  const st = window.__CET4_APP__.state;
  return st.records.map(r => ({ id: r.id, note: r.note }));
})()`);

/* 进入记录页，逐条点击并记录分析页显示内容 */
const results = [];
for (let i = 0; i < 4; i++) {
  await ev(`document.querySelector('.tab[data-view="records"]').click()`);
  await sleep(500);
  const clicked = await ev(`(() => {
    const rows = [...document.querySelectorAll('.rec-click')];
    /* 倒序列表：i=0 是最新，i=3 是最旧 */
    const row = rows[${i}];
    const score = row.querySelector('.rec-title').textContent.match(/\\d+/)[0];
    row.click();
    return { score };
  })()`);
  await sleep(800);
  const shown = await ev(`(() => ({
    score: document.querySelector('.sb-score').textContent.replace(/[^\\d]/g, '').slice(0, 3),
    ring: document.querySelector('.ring-txt b').textContent,
    sub: document.querySelector('.sb-sub').textContent,
    focusId: window.__CET4_APP__.state.focusId
  }))()`);
  results.push({ i, listScore: clicked.score, shownScore: shown.score, ring: shown.ring, sub: shown.sub, focusId: shown.focusId });
  console.log(`  记录 #${i}: 列表=${clicked.score} → 分析页显示=${shown.ring} (${shown.sub.slice(0, 22)})`);
  await sleep(300);
}

console.log('\n校验：');
let allOk = true;
for (const r of results) {
  const ok = r.listScore === r.ring;
  if (!ok) allOk = false;
  console.log(`  ${ok ? '✓' : '✗'} 第 ${r.i} 条：列表 ${r.listScore} vs 分析 ${r.ring}`);
}

/* 截图最旧那条的分析页 */
await ev(`document.querySelector('.tab[data-view="records"]').click()`);
await sleep(500);
await ev(`(() => { const rows = [...document.querySelectorAll('.rec-click')]; rows[rows.length-1].click(); })()`);
await sleep(900);
const shot = await ps('Page.captureScreenshot', { format: 'png' });
writeFileSync('qa/shots/focus-oldest.png', Buffer.from(shot.data, 'base64'));
console.log('✓ qa/shots/focus-oldest.png');

ws.close(); child.kill(); server.close();
console.log(allOk ? '\n全部一致 ✓' : '\n存在不一致 ✗');
process.exit(allOk ? 0 : 1);
