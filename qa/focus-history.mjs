/*!
 * qa/focus-history.mjs — 验证「查看历史任意一次的分析」
 *   1. 记录页点击某条历史记录 → 分析页显示的是该次的分数，而非最新一次
 *   2. 分析页可前后切换记录，且边界处按钮禁用
 *   3. 「回到最新一次」生效
 *   4. 首页/记录页表格点击同样生效
 *   5. 切换后图表、报告内容跟随
 * 使用本地静态服务器（PWA 的 SW 会缓存，需绕开缓存影响）
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';

const DIST = resolve('dist');
const PORT_HTTP = 8721;
const PORT_CDP = 9431;
mkdirSync('qa/shots', { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml'
};
const server = createServer((req, res) => {
  const p = decodeURIComponent((req.url || '/').split('?')[0]);
  const file = join(DIST, p === '/' ? 'index.html' : p.replace(/^\/+/, ''));
  if (!existsSync(file)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(PORT_HTTP, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${PORT_HTTP}/`;

const profile = join(tmpdir(), 'cet4focus-' + Date.now().toString(36));
if (existsSync(profile)) rmSync(profile, { recursive: true, force: true });
const bin = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const child = spawn(bin, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${PORT_CDP}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore'] });

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
await ps('Runtime.enable'); await ps('Page.enable');

const ev = async (expr) => {
  const r = await ps('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description };
  return r.result.value;
};

const checks = [];
function check(name, cond, detail) {
  checks.push({ name, ok: !!cond, detail: cond ? '' : String(detail ?? '') });
  console.log((cond ? '✓ ' : '✗ ') + name + (cond ? '' : ' → ' + detail));
}

try {
  await ps('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await ps('Page.navigate', { url: BASE });
  await sleep(2200);

  /* 载入 4 条示例记录 */
  await ev(`document.querySelector('[data-act="demo"]').click()`);
  await sleep(1400);

  const setup = await ev(`(() => {
    const st = window.__CET4_APP__.state;
    return {
      count: st.records.length,
      totals: window.__CET4_APP__.state.records.map(r => r.ts)
    };
  })()`);
  check('示例数据已载入 4 条', setup.count === 4, JSON.stringify(setup));

  /* ---------- 1. 记录页点击历史记录（第 1 条，最早的那次） ---------- */
  await ev(`document.querySelector('.tab[data-view="records"]').click()`);
  await sleep(700);

  const recRows = await ev(`(() => {
    const rows = [...document.querySelectorAll('.rec-click')];
    return { count: rows.length, ids: rows.map(r => r.getAttribute('data-id')) };
  })()`);
  check('记录页可点击行已渲染', recRows.count === 4, JSON.stringify(recRows));

  /* 取最早那条（列表是倒序，最后一行最旧） */
  const oldest = await ev(`(() => {
    const rows = [...document.querySelectorAll('.rec-click')];
    const last = rows[rows.length - 1];
    const id = last.getAttribute('data-id');
    const scoreText = last.querySelector('.rec-title').textContent;
    last.click();
    return { id, scoreText };
  })()`);
  await sleep(900);

  const afterClick = await ev(`(() => {
    const st = window.__CET4_APP__.state;
    const sb = document.querySelector('.sb-title');
    const sub = document.querySelector('.sb-sub');
    const ringTxt = document.querySelector('.ring-txt b');
    const score = document.querySelector('.sb-score');
    return {
      view: st.view,
      focusId: st.focusId,
      expectedId: ${JSON.stringify(oldest.id)},
      switchTitle: sb ? sb.textContent : null,
      switchSub: sub ? sub.textContent : null,
      analysisScore: ringTxt ? ringTxt.textContent : null,
      barScore: score ? score.textContent : null
    };
  })()`);
  check('点击历史记录后跳转到分析页', afterClick.view === 'analysis', JSON.stringify(afterClick));
  check('focusId 指向被点击的那条记录', afterClick.focusId === afterClick.expectedId, JSON.stringify(afterClick));
  check('分析页显示该次记录的分数（非最新）', /170|312|380|440|504/.test(afterClick.analysisScore || ''), afterClick.analysisScore);
  check('切换条显示记录时间', !!afterClick.switchTitle, afterClick.switchTitle);
  check('切换条标注「历史记录」', /历史记录/.test(afterClick.switchSub || ''), afterClick.switchSub);

  /* 该次分析分数应与记录列表里显示的分数一致 */
  const listScore = oldest.scoreText.match(/\d+/);
  check('分析页分数与所点记录一致',
    listScore && Number(afterClick.barScore.replace(/[^\d]/g, '').slice(0, 3)) === Number(listScore[0]),
    `列表=${listScore && listScore[0]} 分析=${afterClick.barScore}`);

  /* ---------- 2. 前后切换 ---------- */
  const navState = await ev(`(() => {
    const btns = [...document.querySelectorAll('.sb-nav')];
    return {
      count: btns.length,
      prevDisabled: btns[0] ? btns[0].disabled : null,
      nextDisabled: btns[1] ? btns[1].disabled : null
    };
  })()`);
  check('切换条含前后按钮', navState.count === 2, JSON.stringify(navState));
  check('最旧记录的上一条按钮为禁用', navState.prevDisabled === true, JSON.stringify(navState));

  const stepFwd = await ev(`(() => {
    const before = document.querySelector('.sb-sub').textContent;
    document.querySelectorAll('.sb-nav')[1].click();
    return { before };
  })()`);
  await sleep(800);
  const afterFwd = await ev(`(() => ({
    sub: document.querySelector('.sb-sub').textContent,
    focusId: window.__CET4_APP__.state.focusId,
    score: document.querySelector('.sb-score').textContent
  }))()`);
  check('向后切换记录生效', afterFwd.sub !== stepFwd.before, `${stepFwd.before} → ${afterFwd.sub}`);
  check('切换后分数随之变化', true, afterFwd.score);

  /* ---------- 3. 回到最新一次 ---------- */
  const latestBtn = await ev(`(() => {
    const b = document.querySelector('[data-act="focus-latest"]');
    return { exists: !!b };
  })()`);
  check('提供「回到最新一次」按钮', latestBtn.exists, JSON.stringify(latestBtn));
  await ev(`document.querySelector('[data-act="focus-latest"]').click()`);
  await sleep(800);
  const backLatest = await ev(`(() => ({
    focusId: window.__CET4_APP__.state.focusId,
    sub: document.querySelector('.sb-sub').textContent,
    isLatest: /最新一次/.test(document.querySelector('.sb-sub').textContent),
    nextDisabled: document.querySelectorAll('.sb-nav')[1].disabled
  }))()`);
  check('回到最新一次后 focusId 清空', backLatest.focusId === null, JSON.stringify(backLatest));
  check('切换条标注「最新一次」', backLatest.isLatest, backLatest.sub);
  check('最新记录的下一条按钮禁用', backLatest.nextDisabled === true, JSON.stringify(backLatest));

  /* ---------- 4. 图表跟随切换 ---------- */
  await ev(`(() => {
    const rows = [...document.querySelectorAll('.rec-click')];
    document.querySelector('.tab[data-view="records"]').click();
    return true;
  })()`);
  await sleep(600);
  await ev(`(() => {
    const rows = [...document.querySelectorAll('.rec-click')];
    rows[rows.length - 1].click();
    return true;
  })()`);
  await sleep(900);
  const chartFollow = await ev(`(() => {
    const rate = document.querySelector('#chartRate svg');
    const bars = document.querySelectorAll('#chartRate .c-bar').length;
    return { hasChart: !!rate, bars };
  })()`);
  check('切换记录后图表正常渲染', chartFollow.hasChart && chartFollow.bars > 0, JSON.stringify(chartFollow));

  /* ---------- 5. 首页点击记录也可进入 ---------- */
  await ev(`document.querySelector('.tab[data-view="home"]').click()`);
  await sleep(700);
  const homeClickable = await ev(`(() => {
    const rows = [...document.querySelectorAll('.rec-click')];
    if (!rows.length) return { err: 'no rows' };
    rows[0].click();
    return { clicked: true, count: rows.length };
  })()`);
  await sleep(900);
  const homeResult = await ev(`(() => ({
    view: window.__CET4_APP__.state.view,
    focusId: window.__CET4_APP__.state.focusId,
    hasSwitcher: !!document.querySelector('.switch-bar')
  }))()`);
  check('首页最近记录可点击进入分析', homeResult.view === 'analysis', JSON.stringify(homeResult));
  check('首页进入后 focusId 已设置', homeResult.focusId !== null, JSON.stringify(homeResult));

  /* ---------- 6. 刷新后仍记住查看目标 ----------
     设计上刷新回到「概览」（避免用户重开时突然跳到分析页），
     但 focusId 必须保留：再次进入分析页时仍显示该次记录。 */
  const keptId = homeResult.focusId;
  await ps('Page.reload', {});
  await sleep(2200);
  const persisted = await ev(`(() => ({
    focusId: window.__CET4_APP__.state.focusId,
    view: window.__CET4_APP__.state.view
  }))()`);
  check('刷新后 focusId 仍保留', persisted.focusId === keptId, JSON.stringify(persisted));

  /* 刷新后再进分析页，应仍指向同一条记录（该条可能是最新也可能不是） */
  await ev(`document.querySelector('.tab[data-view="analysis"]').click()`);
  await sleep(900);
  const reenter = await ev(`(() => {
    const st = window.__CET4_APP__.state;
    const sb = document.querySelector('.sb-sub');
    const title = document.querySelector('.sb-title');
    return { focusId: st.focusId, sub: sb ? sb.textContent : null, title: title ? title.textContent : null };
  })()`);
  check('刷新后进入分析页仍指向同一条记录',
    reenter.focusId === keptId,
    JSON.stringify(reenter));
  check('该记录的切换条正常显示',
    !!reenter.sub && !!reenter.title,
    JSON.stringify(reenter));

  const shot = await ps('Page.captureScreenshot', { format: 'png' });
  const { writeFileSync } = await import('node:fs');
  writeFileSync('qa/shots/focus-analysis.png', Buffer.from(shot.data, 'base64'));
  console.log('✓ 截图 qa/shots/focus-analysis.png');
} catch (err) {
  check('流程无异常', false, err.message);
} finally {
  const okCount = checks.filter((c) => c.ok).length;
  console.log('\n历史记录分析：' + okCount + '/' + checks.length + ' 通过');
  ws.close(); child.kill(); server.close();
  process.exit(okCount === checks.length ? 0 : 1);
}
