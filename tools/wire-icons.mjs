/*!
 * tools/wire-icons.mjs — 把生成的图标接入页面模板：
 *   favicon(SVG + PNG 多尺寸) / apple-touch-icon / manifest / theme-color
 * 同时把顶栏 .brand-mark 由纯文字「4」换成内联 SVG 图标（保证与 favicon 一致）。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const TPL = 'tools/index.template.html';
let t = readFileSync(TPL, 'utf8');

/* ---------- 1. 替换 favicon 区块 ---------- */
const oldFaviconStart = t.indexOf('<link rel="icon"');
if (oldFaviconStart < 0) throw new Error('未找到 favicon 链接');
const oldFaviconEnd = t.indexOf('<style>', oldFaviconStart);
const iconBlock = `<link rel="icon" type="image/svg+xml" href="assets/favicon.svg">
<link rel="icon" type="image/png" sizes="16x16" href="assets/icon-16.png">
<link rel="icon" type="image/png" sizes="32x32" href="assets/icon-32.png">
<link rel="icon" type="image/png" sizes="48x48" href="assets/icon-48.png">
<link rel="icon" type="image/png" sizes="192x192" href="assets/icon-192.png">
<link rel="apple-touch-icon" sizes="180x180" href="assets/apple-touch-icon.png">
<link rel="manifest" href="manifest.webmanifest">
`;
t = t.slice(0, oldFaviconStart) + iconBlock + t.slice(oldFaviconEnd);

/* ---------- 2. 顶栏品牌标识换成内联图标 ---------- */
const inlineIcon = `<svg viewBox="0 0 512 512" width="100%" height="100%" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient id="bm-bg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#7b78ff"/><stop offset="52%" stop-color="#5b5bf5"/><stop offset="100%" stop-color="#8b5cf6"/>
            </linearGradient>
            <linearGradient id="bm-ring" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0%" stop-color="#ffffff"/><stop offset="100%" stop-color="#dcd7ff"/>
            </linearGradient>
          </defs>
          <rect x="36" y="36" width="440" height="440" rx="112" fill="url(#bm-bg)"/>
          <g transform="rotate(135 256 256)">
            <circle cx="256" cy="256" r="158" fill="none" stroke="#fff" stroke-opacity="0.22" stroke-width="42" stroke-linecap="round" stroke-dasharray="744.6 248.2"/>
            <circle cx="256" cy="256" r="158" fill="none" stroke="url(#bm-ring)" stroke-width="42" stroke-linecap="round" stroke-dasharray="528 466"/>
          </g>
          <text x="252.6" y="339" text-anchor="middle" fill="#fff" font-size="200" font-weight="800" letter-spacing="-10" font-family="'Segoe UI','PingFang SC','Microsoft YaHei',Arial,sans-serif">4</text>
        </svg>`;

const brandRe = /<div class="brand-mark" aria-hidden="true">4<\/div>/;
if (brandRe.test(t)) {
  t = t.replace(brandRe, `<div class="brand-mark" aria-hidden="true">${inlineIcon}</div>`);
} else if (!t.includes('bm-bg')) {
  throw new Error('未找到 brand-mark 占位');
}

writeFileSync(TPL, t, 'utf8');
console.log('✓ 模板已接入图标');

/* ---------- 3. 生成 manifest ---------- */
const manifest = {
  name: '四级成绩分析',
  short_name: '四级成绩分析',
  description: '录入四级各部分答对题数，按官方分值结构折算 710 分制报道分，查看趋势图表并获得针对性提分建议。',
  lang: 'zh-CN',
  dir: 'ltr',
  start_url: './',
  scope: './',
  display: 'standalone',
  orientation: 'portrait',
  background_color: '#f6f7fb',
  theme_color: '#5b5bf5',
  categories: ['education', 'productivity'],
  icons: [
    { src: 'assets/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'assets/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'assets/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    { src: 'assets/favicon.svg', sizes: 'any', type: 'image/svg+xml' }
  ]
};
writeFileSync('manifest.webmanifest', JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log('✓ manifest.webmanifest');
