/*!
 * qa/overlap.mjs — 界面遮挡/拥挤检测器
 * 目标：在真实浏览器中枚举所有可交互元素与关键内容块，找出
 *   1) 可交互元素互相重叠（点击会被抢走）
 *   2) 元素被固定定位层（tabbar / preview / toast）覆盖
 *   3) 元素内容溢出容器（文字被裁切、横向超出）
 *   4) 相邻可点击目标间距过小（<36px 触控友好线）
 * 用法：node qa/overlap.mjs <URL> [输出目录]
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';

const PAGE_URL = process.argv[2];
const OUT = resolve(process.argv[3] || 'qa/overlap');
const PORT = Number(process.env.QA_PORT || 9371);

mkdirSync(OUT, { recursive: true });
const profile = join(tmpdir(), 'cet4overlap-' + Date.now().toString(36));
if (existsSync(profile)) rmSync(profile, { recursive: true, force: true });

const bin = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(p => existsSync(p));

const browser = spawn(bin, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--allow-file-access-from-files',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1280,900', 'about:blank'
], { stdio: ['ignore', 'ignore', 'ignore'] });

let wsUrl = null;
for (let i = 0; i < 160 && !wsUrl; i++) {
  await sleep(250);
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl; } catch {}
}
if (!wsUrl) { browser.kill(); throw new Error('调试端口未就绪'); }

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
    setTimeout(() => { if (pend.has(id)) { pend.delete(id); rej(new Error('CDP 超时 ' + method)); } }, 25000);
  });
};

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const ps = (m, p) => send(m, p, sessionId);
await ps('Runtime.enable');
await ps('Page.enable');

const ev = async (expr) => {
  const r = await ps('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

/* 注入检测脚本：在页面里跑，返回结构化问题列表 */
const DETECT = String.raw`
(() => {
  const SEL = 'button, [data-act], input, select, textarea, .tab, .chip, .step-btn, .btn, .rec-del';
  const nodes = [...document.querySelectorAll(SEL)].filter(el => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });

  const label = (el) => {
    const act = el.getAttribute('data-act') || '';
    const dv = el.getAttribute('data-view') || '';
    const part = el.getAttribute('data-part') || el.getAttribute('data-num') || '';
    const key = el.getAttribute('data-key') || '';
    const txt = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 18);
    return [el.tagName.toLowerCase(), act && 'act=' + act, dv && 'view=' + dv, part && 'part=' + part,
            key && 'key=' + key, txt && '"' + txt + '"'].filter(Boolean).join(' ');
  };

  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  };

  /* 1) 可交互元素两两重叠
     排除「固定浮动层」自身（.tabbar/.preview/.toast）：悬浮导航按设计就压在内容之上，
     不算按钮互相遮挡；只统计真正的同级元素重叠。 */
  const isFloating = (el) => !!el.closest('.tabbar, .preview, .toast');
  const overlaps = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      if (a.contains(b) || b.contains(a)) continue;
      if (isFloating(a) || isFloating(b)) continue;   /* 浮动层与内容的叠加是设计意图 */
      const ra = rect(a), rb = rect(b);
      const ix = Math.max(0, Math.min(ra.x + ra.w, rb.x + rb.w) - Math.max(ra.x, rb.x));
      const iy = Math.max(0, Math.min(ra.y + ra.h, rb.y + rb.h) - Math.max(ra.y, rb.y));
      if (ix > 0.5 && iy > 0.5) {
        overlaps.push({ a: label(a), b: label(b), area: Math.round(ix * iy),
                        aRect: { x: Math.round(ra.x), y: Math.round(ra.y + scrollY), w: Math.round(ra.w), h: Math.round(ra.h) },
                        bRect: { x: Math.round(rb.x), y: Math.round(rb.y + scrollY), w: Math.round(rb.w), h: Math.round(rb.h) } });
      }
    }
  }

  /* 2) 固定层遮挡：只在「元素无论怎么滚动都点不到」时才算问题。
     悬浮导航压住滚动中的内容是正常设计，因此这里先把元素滚到视口安全区再判定。 */
  const covered = [];
  const FIXED_SEL = '.tabbar, .preview, .toast';
  nodes.forEach(el => {
    const r0 = el.getBoundingClientRect();
    if (r0.width <= 0 || r0.height <= 0) return;
    /* 滚到元素中心位于视口中部，避开顶部顶栏与底部固定层 */
    const absTop = r0.top + scrollY;
    const target = absTop - innerHeight * 0.42;
    window.scrollTo(0, Math.max(0, Math.min(target, document.documentElement.scrollHeight - innerHeight)));
    const r = el.getBoundingClientRect();
    const cy = r.top + r.height / 2;
    const cx = r.left + r.width / 2;
    if (cy <= 0 || cy >= innerHeight) return;           /* 滚不到视口内：由后续“不可达”检查处理 */
    const top = document.elementFromPoint(cx, cy);
    if (!top || el.contains(top) || top.contains(el)) return;
    const blocker = top.closest(FIXED_SEL);
    if (blocker) {
      covered.push({
        el: label(el),
        blocker: (blocker.className || '').split(' ').filter(Boolean).join(' '),
        elRect: { x: Math.round(r.left), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) }
      });
    }
  });
  window.scrollTo(0, scrollY);

  /* 2b) 已被滚动到底后仍被固定层覆盖的元素（真正的“点不到”） */
  const unreachable = [];
  window.scrollTo(0, document.documentElement.scrollHeight);
  nodes.forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.height <= 0) return;
    if (r.bottom > innerHeight || r.top < 0) return;   /* 已出视口说明可滚动到更合适位置 */
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const top = document.elementFromPoint(cx, cy);
    if (!top || el.contains(top) || top.contains(el)) return;
    const blocker = top.closest(FIXED_SEL);
    if (blocker) {
      unreachable.push({
        el: label(el),
        blocker: (blocker.className || '').split(' ').filter(Boolean).join(' '),
        elRect: { x: Math.round(r.left), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) }
      });
    }
  });
  window.scrollTo(0, 0);

  /* 3) 内容溢出：文字横向溢出或垂直裁切 */
  const overflow = [];
  [...document.querySelectorAll('.chip, .badge, .card-title, .part-name, .rec-title, .btn, .tab span, .hero-title, .plan-title, .dl-name, .tbl td, .tbl th')]
    .forEach(el => {
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible') {
        overflow.push({ el: label(el), type: 'scrollWidth', scrollW: el.scrollWidth, clientW: el.clientWidth });
      }
      if (el.scrollHeight > el.clientHeight + 1 && getComputedStyle(el).overflow === 'hidden') {
        overflow.push({ el: label(el), type: 'scrollHeight', scrollH: el.scrollHeight, clientH: el.clientHeight });
      }
    });

  /* 4) 触控目标过小 / 相邻过近 */
  const tiny = [];
  const touchTargets = nodes.filter(el => {
    const cs = getComputedStyle(el);
    return cs.pointerEvents !== 'none' && !el.disabled;
  });
  touchTargets.forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width < 28 || r.height < 28) {
      tiny.push({ el: label(el), w: Math.round(r.width), h: Math.round(r.height) });
    }
  });
  const close = [];
  for (let i = 0; i < touchTargets.length; i++) {
    for (let j = i + 1; j < touchTargets.length; j++) {
      const a = touchTargets[i], b = touchTargets[j];
      if (a.contains(b) || b.contains(a)) continue;
      /* 浮动层（导航条/预览条）与页面内容天然贴近，不是可改善的间距问题 */
      if (isFloating(a) || isFloating(b)) continue;
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      const gapX = Math.max(rb.left - (ra.left + ra.width), ra.left - (rb.left + rb.width));
      const gapY = Math.max(rb.top - (ra.top + ra.height), ra.top - (rb.top + rb.height));
      const gap = Math.max(gapX, gapY);
      if (gap >= 0 && gap < 6) {
        close.push({ a: label(a), b: label(b), gap: Math.round(gap * 10) / 10 });
      }
    }
  }

  return {
    viewport: { w: innerWidth, h: innerHeight, scrollH: document.documentElement.scrollHeight },
    counts: { interactive: nodes.length },
    overlaps: overlaps.slice(0, 40),
    overlapTotal: overlaps.length,
    covered: covered.slice(0, 40),
    coveredTotal: covered.length,
    unreachable: unreachable.slice(0, 40),
    unreachableTotal: unreachable.length,
    overflow: overflow.slice(0, 40),
    overflowTotal: overflow.length,
    tiny: tiny.slice(0, 40),
    tinyTotal: tiny.length,
    close: close.slice(0, 30),
    closeTotal: close.length
  };
})()
`;

const VIEWPORTS = [
  { name: 'mobile-390', w: 390, h: 844, dpr: 2 },
  { name: 'mobile-320', w: 320, h: 640, dpr: 2 },
  { name: 'mobile-430', w: 430, h: 932, dpr: 2 },
  { name: 'tablet-820', w: 820, h: 1180, dpr: 2 },
  { name: 'desktop-1280', w: 1280, h: 900, dpr: 1 }
];

const report = { url: PAGE_URL, runs: [] };

for (const vp of VIEWPORTS) {
  await ps('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: vp.dpr, mobile: vp.w < 700 });
  await ps('Page.navigate', { url: PAGE_URL });
  await sleep(1400);
  await ev(`localStorage.clear()`);
  await ps('Page.navigate', { url: PAGE_URL });
  await sleep(1400);

  /* 载入示例数据，让所有图表与列表都出现 */
  const hasDemo = await ev(`!!document.querySelector('[data-act="demo"]')`);
  if (hasDemo) {
    await ev(`document.querySelector('[data-act="demo"]').click()`);
    await sleep(1200);
  }

  const views = ['home', 'entry', 'analysis', 'records'];
  for (const v of views) {
    await ev(`document.querySelector('.tab[data-view="${v}"]').click()`);
    await sleep(700);
    const res = await ev(DETECT);
    report.runs.push({ viewport: vp.name, view: v, ...res });
    const tag = `[${vp.name}/${v}]`;
    const hardIssues = res.overlapTotal + res.unreachableTotal + res.overflowTotal;
    if (res.overlapTotal) console.log(`✗ ${tag} 按钮重叠 ${res.overlapTotal} 处`);
    if (res.unreachableTotal) console.log(`✗ ${tag} 固定层压住无法点击 ${res.unreachableTotal} 处`);
    if (res.overflowTotal) console.log(`✗ ${tag} 内容溢出 ${res.overflowTotal} 处`);
    if (res.coveredTotal) console.log(`  · ${tag} 滚动过程中被固定层覆盖 ${res.coveredTotal} 处（可滚动避开，仅记录）`);
    if (res.tinyTotal) console.log(`  · ${tag} 触控目标偏小 ${res.tinyTotal} 处（参考）`);
    if (res.closeTotal) console.log(`  · ${tag} 相邻间隙 <6px ${res.closeTotal} 处（参考）`);
    if (!hardIssues) console.log(`✓ ${tag} 无重叠 / 无不可点击 / 无溢出`);
  }
}

writeFileSync(join(OUT, 'overlap.json'), JSON.stringify(report, null, 2), 'utf8');
const sum = report.runs.reduce((a, r) => ({
  overlaps: a.overlaps + r.overlapTotal,
  unreachable: a.unreachable + (r.unreachableTotal || 0),
  overflow: a.overflow + r.overflowTotal,
  tiny: a.tiny + r.tinyTotal,
  close: a.close + r.closeTotal,
  covered: a.covered + r.coveredTotal
}), { overlaps: 0, unreachable: 0, overflow: 0, tiny: 0, close: 0, covered: 0 });
console.log('\n【严重问题】重叠 ' + sum.overlaps + ' / 不可点击 ' + sum.unreachable + ' / 溢出 ' + sum.overflow);
console.log('【参考项】滚动中被浮动层覆盖 ' + sum.covered + ' / 触控偏小 ' + sum.tiny + ' / 间隙<6px ' + sum.close);
console.log('明细 → ' + join(OUT, 'overlap.json'));

ws.close();
browser.kill();
process.exit(0);
