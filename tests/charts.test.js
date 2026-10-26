/*!
 * tests/charts.test.js — 图表库 v2 单元测试
 * 运行：node tests/charts.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'charts.js'), 'utf8'), ctx);
const C = ctx.window.CET4_CHARTS;

let pass = 0, fail = 0;
const fails = [];
function ok(cond, name, extra) {
  if (cond) pass++; else { fail++; fails.push(name + (extra ? ' → ' + extra : '')); }
}
function goodSvg(s, name) {
  ok(typeof s === 'string' && s.indexOf('<svg') === 0, name + '：返回 SVG', typeof s === 'string' ? s.slice(0, 40) : typeof s);
  if (typeof s !== 'string') return;
  ok(s.indexOf('viewBox') > 0, name + '：含 viewBox');
  ok(!/NaN|undefined|\[object Object\]|null/.test(s.replace(/data-tip="[^"]*"/g, '')), name + '：无非法输出', (s.match(/NaN|undefined|\[object Object\]/g) || []).slice(0, 3).join(','));
  ok(!/data-tip="[^"]*"[^>]*data-tip="/.test(s), name + '：data-tip 唯一');
}

/* ---------- 1. 折线图 ---------- */
const lineBase = {
  width: 340, height: 200,
  labels: ['9-30', '10-08', '10-16', '10-23'],
  series: [{ key: 'total', name: '总分', color: '#5b5bf5', values: [312, 380, 440, 504] }],
  ticks: [0, 200, 400, 600, 710], yMin: 0, yMax: 710,
  marks: [{ value: 425, label: '425 基本目标', color: '#f59e0b' }],
  unit: ' 分', aria: '总分趋势'
};
goodSvg(C.line(lineBase), 'line 基础');

const lineSvg = C.line(lineBase);
ok(lineSvg.indexOf('>200<') > 0, 'line：整数刻度 200', '未找到 200');
ok(lineSvg.indexOf('>710<') > 0, 'line：整数刻度 710');
ok((lineSvg.match(/stroke-dasharray="5 4"/g) || []).length >= 1, 'line：参考线已绘制');
ok(lineSvg.indexOf('pathLength="1"') > 0, 'line：路径带 pathLength 供动画');
ok(lineSvg.indexOf('425 基本目标') > 0, 'line：参考线标签');
ok(lineSvg.indexOf('data-tip') > 0, 'line：数据点带 tooltip');

/* 刻度上界必须覆盖数据 */
const lineOver = C.line({
  width: 300, height: 180, labels: ['a', 'b'],
  series: [{ color: '#000', values: [700, 710] }],
  ticks: [0, 200, 400, 600], yMin: 0, yMax: 710
});
goodSvg(lineOver, 'line 数据超刻度');

/* 单点 */
goodSvg(C.line({ width: 200, height: 120, labels: ['a'], series: [{ color: '#000', values: [500] }] }), 'line 单点');
/* 空 */
ok(C.line({ width: 300, labels: [], series: [] }).indexOf('chart-empty') > 0, 'line 空数据返回占位');
/* 多系列 */
goodSvg(C.line({
  width: 340, height: 220, labels: ['a', 'b', 'c'],
  series: [
    { color: '#f00', values: [1, 2, 3] },
    { color: '#0f0', values: [3, 2, 1] },
    { color: '#00f', values: [2, 3, 1] },
    { color: '#ff0', values: [1, 1, 1], visible: false }
  ],
  ticks: [0, 100, 200, 250], yMin: 0, yMax: 250, area: false
}), 'line 多系列');

/* 参考线重叠错位 */
const lineMarks = C.line({
  width: 320, height: 200, labels: ['a', 'b'], series: [{ color: '#000', values: [400, 500] }],
  ticks: [0, 200, 400, 600, 710], yMin: 0, yMax: 710,
  marks: [{ value: 425, label: '425 目标', color: '#f59e0b' }, { value: 430, label: '430 目标', color: '#ef4444' }]
});
goodSvg(lineMarks, 'line 重叠参考线');
const markRects = lineMarks.match(/<rect x="42" y="([\d.]+)"/g) || [];
const ys = markRects.map(r => Number(r.match(/y="([\d.]+)"/)[1]));
ok(ys.length >= 2 && Math.abs(ys[0] - ys[1]) >= 10, 'line：重叠参考线标签已错位', JSON.stringify(ys));

/* X 轴抽稀：40 个点不能全部显示 */
const manyLabels = [];
for (let i = 0; i < 40; i++) manyLabels.push('d' + i);
const lineMany = C.line({ width: 320, height: 180, labels: manyLabels, series: [{ color: '#000', values: manyLabels.map((_, i) => i * 10) }] });
const xLabelCount = (lineMany.match(/<text[^>]*text-anchor="middle"[^>]*font-size="9.5"/g) || []).length;
ok(xLabelCount > 2 && xLabelCount < 40, 'line：X 轴标签已抽稀', 'count=' + xLabelCount);

/* ---------- 2. 堆叠柱 ---------- */
const barBase = {
  width: 340, height: 210,
  items: [
    { label: '9-30', total: 312, parts: [{ value: 49.7, color: '#f59e0b', label: '写作' }, { value: 106.5, color: '#3b82f6', label: '听力' }, { value: 106.5, color: '#10b981', label: '阅读' }, { value: 49.7, color: '#ec4899', label: '翻译' }] },
    { label: '10-23', total: 504, parts: [{ value: 71, color: '#f59e0b', label: '写作' }, { value: 191.7, color: '#3b82f6', label: '听力' }, { value: 177.5, color: '#10b981', label: '阅读' }, { value: 63.9, color: '#ec4899', label: '翻译' }] }
  ],
  max: 710, ticks: [0, 200, 400, 600, 710], unit: '分', aria: '成绩构成'
};
goodSvg(C.bar(barBase), 'bar 基础');
const barSvg = C.bar(barBase);
ok(barSvg.indexOf('>710<') > 0, 'bar：整数刻度');
ok((barSvg.match(/class="c-bar"/g) || []).length >= 8, 'bar：分段已绘制', (barSvg.match(/class="c-bar"/g) || []).length);
ok(barSvg.indexOf('data-tip') > 0, 'bar：带 tooltip');
ok(C.bar({ width: 300, items: [] }).indexOf('chart-empty') > 0, 'bar 空数据占位');

/* 单段 + 全 0 */
goodSvg(C.bar({ width: 300, height: 180, items: [{ label: 'x', total: 100, parts: [{ value: 100, color: '#000', label: 'a' }] }], max: 710 }), 'bar 单段');
goodSvg(C.bar({ width: 300, height: 180, items: [{ label: 'x', total: 0, parts: [{ value: 0, color: '#000', label: 'a' }] }], max: 710 }), 'bar 全 0');

/* ---------- 3. 水平条 ---------- */
const hb = C.hbars({
  width: 340,
  rows: [
    { label: '写作', value: 71, max: 106.5, color: '#f59e0b', sub: '得分率 66.7%' },
    { label: '听力理解', value: 191.7, max: 248.5, color: '#3b82f6', sub: '得分率 77.1%' },
    { label: '阅读理解', value: 177.5, max: 248.5, color: '#10b981', sub: '得分率 71.4%' },
    { label: '翻译', value: 63.9, max: 106.5, color: '#ec4899', sub: '得分率 60%' }
  ],
  rowH: 32, unit: '分', aria: '各部分得分'
});
goodSvg(hb, 'hbars 基础');
ok(hb.indexOf('写作') > 0 && hb.indexOf('翻译') > 0, 'hbars：标签已渲染');

/* 自动 labelW 不重叠：标签文本 x=0，轨道起点应 >= 标签宽度 */
const hbAuto = C.hbars({ width: 300, rows: [{ label: '阅读理解', value: 50, max: 100 }, { label: '翻译', value: 30, max: 100 }], rowH: 30 });
const trackX = Number((hbAuto.match(/<rect x="([\d.]+)" y="[\d.]+" width="[\d.]+" height="\d+" rx="[\d.]+" fill="currentColor" fill-opacity=".075"/) || [])[1]);
ok(trackX >= 30, 'hbars：自动 labelW 合理', 'trackX=' + trackX);

/* 窄容器 200px 不崩 */
goodSvg(C.hbars({ width: 200, rows: [{ label: '很长的中文标签名称', value: 88.8, max: 100 }, { label: 'b', value: 0, max: 100 }], rowH: 32, unit: '%' }), 'hbars 窄容器');

/* ---------- 4. 环形 ---------- */
const dn = C.donut({
  size: 140, thickness: 16,
  segments: [
    { value: 71, color: '#f59e0b', label: '写作' },
    { value: 191.7, color: '#3b82f6', label: '听力' },
    { value: 177.5, color: '#10b981', label: '阅读' },
    { value: 63.9, color: '#ec4899', label: '翻译' }
  ],
  centerTitle: '504', centerSub: '估分', gap: 2, aria: '占比'
});
goodSvg(dn, 'donut 基础');
ok(dn.indexOf('>504<') > 0, 'donut：中心数值');
ok((dn.match(/class="c-seg"/g) || []).length === 4, 'donut：4 段', (dn.match(/class="c-seg"/g) || []).length);
ok(dn.indexOf('data-tip') > 0, 'donut：带 tooltip');
goodSvg(C.donut({ size: 100, segments: [] }), 'donut 空数据');
goodSvg(C.donut({ size: 100, segments: [{ value: 0, color: '#000', label: 'x' }] }), 'donut 全 0');

/* ---------- 5. 仪表盘 ---------- */
const g = C.gauge({
  size: 160, value: 504, max: 710,
  bands: [{ from: 0, to: 220, color: '#e5484d' }, { from: 220, to: 425, color: '#e08b00' }, { from: 425, to: 550, color: '#0ea672' }, { from: 550, to: 710, color: '#5b5bf5' }],
  marks: [{ value: 425, label: '425' }], label: '估分', sub: '/ 710', aria: '仪表盘'
});
goodSvg(g, 'gauge 基础');
ok(g.indexOf('>504<') > 0, 'gauge：中心数值');
ok((g.match(/<path/g) || []).length >= 5, 'gauge：分段色轨 + 进度弧', (g.match(/<path/g) || []).length);
ok(g.indexOf('425') > 0, 'gauge：425 标记');
goodSvg(C.gauge({ size: 120, value: 0, max: 710 }), 'gauge 零值');
goodSvg(C.gauge({ size: 120, value: 710, max: 710 }), 'gauge 满值');
goodSvg(C.gauge({ size: 120, value: 9999, max: 710 }), 'gauge 超上限');

/* ---------- 6. 迷你折线 ---------- */
goodSvg(C.sparkline({ width: 120, height: 32, values: [1, 2, 3, 2, 5] }), 'sparkline 基础');
ok(C.sparkline({ width: 120, values: [1] }).indexOf('<svg') === 0, 'sparkline 单点不崩');
ok(C.sparkline({ width: 120, values: [5, 5, 5] }).indexOf('NaN') < 0, 'sparkline 全等值不产生 NaN');

/* ---------- 7. 工具函数 ---------- */
ok(C.esc('<a href="x">&\'') === '&lt;a href=&quot;x&quot;&gt;&amp;&#39;', 'esc 正确转义', C.esc('<a href="x">&\''));
ok(C.n(1.2345, 2) === 1.23, 'n 保留小数');
ok(C.n(NaN) === 0, 'n 处理 NaN');
ok(C.niceStep(710) === 1000 || C.niceStep(710) === 500, 'niceStep 合理', C.niceStep(710));
ok(C.textWidth('中文', 12) > C.textWidth('ab', 12), 'textWidth 中文更宽');

/* ---------- 8. 兼容别名 ---------- */
goodSvg(C.lineChart(lineBase), 'lineChart 别名');
goodSvg(C.stackedBar(barBase), 'stackedBar 别名');
goodSvg(C.ring({ value: 504, max: 710, size: 100 }), 'ring 别名');

/* ---------- 输出 ---------- */
console.log(`\n图表测试：${pass} 通过 / ${fail} 失败`);
if (fail) {
  console.log('\n失败项：');
  fails.forEach(f => console.log('  ✗ ' + f));
  process.exit(1);
}
console.log('全部通过 ✓');
