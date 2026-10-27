/*!
 * tests/tooltip.test.js — 浮层配色对比度与可读性测试（WCAG 2.1）
 * 运行：node tests/tooltip.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, name, extra) {
  if (cond) pass++; else { fail++; fails.push(name + (extra ? ' → ' + extra : '')); }
}

/* ---------------- 解析令牌 ---------------- */
function tokensIn(block) {
  const out = {};
  const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let m;
  while ((m = re.exec(block)) !== null) out[m[1]] = m[2].trim();
  return out;
}

const lightRoot = css.slice(0, css.indexOf('@media (prefers-color-scheme: dark)'));
const darkStart = css.indexOf('@media (prefers-color-scheme: dark)');
const darkBlock = css.slice(darkStart, css.indexOf('\n}', css.indexOf('--sh-pop', darkStart)));

const LIGHT = tokensIn(lightRoot);
const DARK = tokensIn(darkBlock);

/* ---------------- 颜色工具 ---------------- */
function hexToRgb(h) {
  h = h.trim();
  let m = h.match(/^#([0-9a-f]{3})$/i);
  if (m) { const s = m[1]; return [parseInt(s[0] + s[0], 16), parseInt(s[1] + s[1], 16), parseInt(s[2] + s[2], 16)]; }
  m = h.match(/^#([0-9a-f]{6})$/i);
  if (m) { const s = m[1]; return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]; }
  return null;
}

function relLum(rgb) {
  const [r, g, b] = rgb.map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const la = relLum(a), lb = relLum(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/* ---------------- 1. 令牌存在 ---------------- */
['--tip-bg', '--tip-ink', '--tip-ink-2', '--tip-line'].forEach(k => {
  ok(!!LIGHT[k], '浅色主题定义 ' + k, JSON.stringify(LIGHT[k]));
  ok(!!DARK[k], '深色主题定义 ' + k, JSON.stringify(DARK[k]));
});

/* ---------------- 2. 根因回归：不能用 --ink 作为浮层背景 ---------------- */
const tipRule = (css.match(/\.chart-tip\s*\{[^}]*\}/) || [''])[0];
ok(tipRule.length > 0, '存在 .chart-tip 规则');
ok(!/background:\s*color-mix\([^)]*--ink/.test(tipRule), '浮层背景不再使用正文色 --ink（原白底白字根因）', tipRule.slice(0, 120));
ok(/background:\s*var\(--tip-bg\)/.test(tipRule), '浮层背景使用 --tip-bg');
ok(/color:\s*var\(--tip-ink\)/.test(tipRule), '浮层文字使用 --tip-ink');

/* ---------------- 3. 对比度 ---------------- */
function checkContrast(themeName, tokens) {
  const bg = hexToRgb(tokens['--tip-bg']);
  const ink = hexToRgb(tokens['--tip-ink']);
  const ink2 = hexToRgb(tokens['--tip-ink-2']);
  ok(!!bg && !!ink && !!ink2, themeName + ' 令牌可解析为颜色', JSON.stringify({ bg: tokens['--tip-bg'], ink: tokens['--tip-ink'] }));
  if (!bg || !ink || !ink2) return;

  const cMain = contrast(bg, ink);
  const cSub = contrast(bg, ink2);
  ok(cMain >= 7, themeName + ' 主文字对比度 ≥ 7:1（AAA）', cMain.toFixed(2) + ':1');
  ok(cSub >= 4.5, themeName + ' 次级文字对比度 ≥ 4.5:1（AA）', cSub.toFixed(2) + ':1');

  /* 浮层与页面背景必须有可见差异，否则浮层会"融进"背景 */
  const pageBg = hexToRgb(tokens['--bg']);
  if (pageBg) {
    const cAgainstPage = contrast(bg, pageBg);
    ok(cAgainstPage >= 1.12, themeName + ' 浮层底色与页面背景有可见区分', cAgainstPage.toFixed(2) + ':1');
  }
  return { cMain, cSub };
}

const lc = checkContrast('浅色主题', LIGHT);
const dc = checkContrast('深色主题', DARK);

/* ---------------- 4. 排版可读性 ---------------- */
ok(/\.chart-tip b\s*\{[^}]*display:\s*block/.test(css), '浮层标题独立成行');
ok(/\.tip-sub\s*\{[^}]*color:\s*var\(--tip-ink-2\)/.test(css), '副标题使用次级色');
ok(/\.tip-row\s*\{[^}]*border-top:/.test(css), '明细行有分隔线');
ok(/\.chart-tip[^}]*white-space:\s*normal/.test(tipRule), '浮层允许换行（长文案不被截断）');
ok(/\.chart-tip[^}]*max-width:\s*min\(/.test(tipRule), '浮层限制最大宽度（避免超出屏幕）');
ok(/\.chart-tip[^}]*word-break:\s*break-word/.test(tipRule), '浮层长文本自动折行');
ok(!/\.chart-tip[^}]*color:\s*#fff;\s*\n/.test(tipRule), '浮层文字不再硬编码 #fff');

/* ---------------- 5. 内容构造器 ---------------- */
const charts = fs.readFileSync(path.join(__dirname, '..', 'src', 'charts.js'), 'utf8');
ok(charts.includes('function tip('), 'charts.js 提供统一 tip() 构造器');
ok(/class=\\"tip-sub\\"/.test(charts) || charts.includes("class=\\\"tip-sub\\\"") || charts.includes("'<span class=\"tip-sub\">'"), 'tip() 输出 tip-sub 结构');
ok(/tip-row/.test(charts), 'tip() 输出 tip-row 结构');
ok(!/data-tip="' *\+\s*[^;]*'<b>'/.test(charts.replace(/\s+/g, ' ')), '旧的内联 <b>…<br> 拼接已替换为 tip()');

/* ---------------- 输出 ---------------- */
console.log(`\n浮层可读性测试：${pass} 通过 / ${fail} 失败`);
if (lc) console.log(`  浅色：主文字 ${lc.cMain.toFixed(2)}:1，次级 ${lc.cSub.toFixed(2)}:1`);
if (dc) console.log(`  深色：主文字 ${dc.cMain.toFixed(2)}:1，次级 ${dc.cSub.toFixed(2)}:1`);
if (fail) { console.log('\n失败项：'); fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log('全部通过 ✓');
