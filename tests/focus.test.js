/*!
 * tests/focus.test.js — 「查看历史任意一次分析」的静态回归测试
 * 运行：node tests/focus.test.js
 *
 * 目的：防止以下已知回归
 *   · viewAnalysis/afterAnalysis 又变回硬编码 list[list.length-1]
 *   · recordResult 忘记把 id 带到结果上（会导致切换条永远显示第 1 次）
 *   · persist 漏存 focusId（刷新后丢失查看目标）
 *   · 记录列表/表格/首页行不可点击
 *   · 「比目标高 079 分」这类拼接垃圾
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, name, extra) {
  if (cond) pass++; else { fail++; fails.push(name + (extra ? ' → ' + extra : '')); }
}

const app = read('src/app.js');
const analysis = read('src/analysis.js');

/* ---------------- 1. 焦点解析 ---------------- */
ok(/function focusResult\(/.test(app), '提供 focusResult() 解析当前查看记录');
ok(/function focusIndex\(/.test(app), '提供 focusIndex() 计算序号');
ok(/base|state\.focusId/.test(app), 'state 含 focusId');
ok(/if \(state\.focusId\) \{/.test(app), 'focusResult 优先使用 focusId');
ok(/state\.focusId = null;/.test(app), '失效 focusId 会被清理');

/* ---------------- 2. id 必须随结果返回（关键回归点） ---------------- */
const rr = app.slice(app.indexOf('function recordResult'), app.indexOf('function recordResult') + 700);
ok(/r\.id = rec\.id/.test(rr), 'recordResult 把 id 附加到结果上', '缺少 r.id = rec.id');
ok(/return r;/.test(rr), 'recordResult 返回带 id 的结果对象');

/* ---------------- 3. 分析页不再硬编码最新 ---------------- */
const va = app.slice(app.indexOf('function viewAnalysis'), app.indexOf('function viewAnalysis') + 900);
ok(/var latest = focusResult\(list\);/.test(va), 'viewAnalysis 使用 focusResult（不硬编码最新）',
  va.slice(0, 160));
ok(!/var latest = list\[list\.length - 1\];/.test(va), 'viewAnalysis 不再取 list[length-1]');
ok(/recordSwitcher\(list, latest, fi\)/.test(app), '分析页渲染记录切换条');

const aa = app.slice(app.indexOf('function afterAnalysis'), app.indexOf('function afterAnalysis') + 700);
ok(/var latest = focusResult\(list\);/.test(aa), 'afterAnalysis 图表跟随当前查看记录');

const cp = app.slice(app.indexOf("act === 'copy-report'"), app.indexOf("act === 'copy-report'") + 500);
ok(/focusResult\(l\)/.test(cp), '复制报告跟随当前查看记录');

/* ---------------- 4. 交互动作 ---------------- */
for (const act of ['analyze', 'focus-step', 'focus-latest']) {
  ok(new RegExp(`act === '${act}'`).test(app), '实现动作 ' + act);
}
ok(/state\.focusId = btn\.getAttribute\('data-id'\)/.test(app), '点击记录设置 focusId');
ok(/state\.focusId = null;[\s\S]{0,60}renderView\(\)/.test(app) || /act === 'focus-latest'[\s\S]{0,120}state\.focusId = null/.test(app),
  '「回到最新」清空 focusId');

/* ---------------- 5. 三个入口都可点击 ---------------- */
ok((app.match(/rec-click" data-act="analyze"/g) || []).length >= 1, '记录列表行可点击打开分析');
ok(/tbl-click" data-act="analyze"/.test(app), '记录表格行可点击打开分析');
ok(/data-act="analyze" data-id="' \+ esc\(r\.id\) \+ '" role="button"/.test(app), '首页最近记录可点击');

/* ---------------- 6. 持久化 ---------------- */
ok(/focusId: state\.focusId/.test(app), 'persist 保存 focusId');
ok(/d\.focusId/.test(app), 'load 恢复 focusId');

/* ---------------- 7. 删除当前查看记录时不崩溃 ---------------- */
ok(/state\.focusId === id[\s\S]{0,120}state\.focusId = null/.test(app), '删除正在查看的记录时自动回退最新');

/* ---------------- 8. 键盘可访问 ---------------- */
ok(/data-act="analyze"[\s\S]{0,40}tabindex="0"/.test(app) || /tabindex="0" aria-label="查看该次成绩分析"/.test(app),
  '记录行可键盘聚焦');
ok(/e\.key !== 'Enter' && e\.key !== ' '/.test(app), '支持 Enter / 空格 打开分析');

/* ---------------- 9. 文案 bug 回归 ---------------- */
ok(!/Math\.round\(-result\.passGap < 0 \? 0 : 0\)/.test(analysis), '不再有「比目标高 079 分」的垃圾拼接');
ok(/比目标高 ' \+ over \+ ' 分/.test(analysis), '「比目标高」使用干净变量');

/* ---------------- 10. 切换条样式 ---------------- */
const swcss = read('src/switch.css');
ok(/\.switch-bar/.test(swcss), '存在切换条样式');
ok(/position:\s*sticky/.test(swcss), '切换条吸顶');
ok(/z-index:\s*35/.test(swcss), '切换条层级足够（不被卡片遮挡）');
ok(/\.rec-click\.is-focus/.test(swcss), '标记"正在查看"的行样式');
ok(/\.sb-nav\[disabled\]/.test(swcss), '边界处箭头禁用样式');

/* ---------------- 输出 ---------------- */
console.log(`\n历史查看测试：${pass} 通过 / ${fail} 失败`);
if (fail) { console.log('\n失败项：'); fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log('全部通过 ✓');
