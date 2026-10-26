/*!
 * tests/model.test.js — 赋分引擎单元测试（Node 直接运行）
 * 运行：node tests/model.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'model.js'), 'utf8'), ctx);
const M = ctx.window.CET4_MODEL;

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
  if (cond) { pass++; } else { fail++; failures.push(name + (extra ? ' → ' + extra : '')); }
}
function near(a, b, eps, name) {
  eps = eps == null ? 0.051 : eps;
  ok(Math.abs(a - b) <= eps, name, `got ${a}, want ${b} ±${eps}`);
}
function eq(a, b, name) {
  ok(a === b, name, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

/* ---------------- 1. 结构完整性 ---------------- */
eq(M.SECTIONS.length, 4, '四个部分');
eq(M.PART_LIST.length, 6, '六个客观题小项');
const partCount = M.PART_LIST.reduce((s, p) => s + p.count, 0);
eq(partCount, 55, '客观题共 55 题');
let ratioSum = 0;
M.SECTIONS.forEach(s => { ratioSum += s.ratio; });
near(ratioSum, 100, 1e-9, '分值比例合计 100');
eq(M.SECTIONS.map(s => s.ratio).join(','), '15,35,35,15', '各板块比例 15/35/35/15');
eq(M.PART_MAP.careful.perItem, 14.2, '仔细阅读每题 14.2 报道分');
near(M.PART_MAP.careful.perItem, 14.2, 0.001, '仔细阅读每题 14.2');
eq(M.PART_MAP.banked.perItem, 3.55, '选词填空每题 3.55');
eq(M.PART_MAP.news.perItem, 7.1, '新闻每题 7.1');
eq(M.SECTION_MAP.listening.reportMax, 248.5, '听力满分 248.5');
eq(M.SECTION_MAP.reading.reportMax, 248.5, '阅读满分 248.5');
eq(M.SECTION_MAP.writing.reportMax, 106.5, '写作满分 106.5');
eq(M.SECTION_MAP.translation.reportMax, 106.5, '翻译满分 106.5');

/* ---------------- 2. 满分与零分 ---------------- */
const full = M.scoreByItems(
  { news: 7, longconv: 8, passage: 10, banked: 10, matching: 10, careful: 10 },
  { writing: 15, translation: 15 }
);
near(full.total, 710, 0.051, '全对满分 710');
eq(full.totalInt, 710, '满分整数 710');
near(full.percentile, 99.9, 0.11, '满分百分位 ≈ 99.9');
eq(full.bandKey, 'b_top', '满分属于最高分数段');
eq(full.sections[1].report, 248.5, '听力报道分 248.5');
eq(full.sections[2].report, 248.5, '阅读报道分 248.5');
eq(full.passGap, -285, '超线 285 分');

const zero = M.scoreByItems({}, {});
near(zero.total, 0, 0.001, '全错总分 0');
eq(zero.zeroed, true, '220 分及以下标记 zeroed');
eq(zero.passReached, false, '未过线');
eq(zero.bandKey, 'b_under', '零分属待提升段');

/* ---------------- 3. 官方误差与 0 分规则 ---------------- */
const s219 = M.scoreByReport({ listening: 70, reading: 70, writing: 40, translation: 39 }); // 219
near(s219.total, 219, 0.11, '219 分');
eq(s219.zeroed, true, '219 分触发官方 0 分规则');
const s425 = M.scoreByReport({ listening: 120, reading: 120, writing: 92.5, translation: 92.5 });
near(s425.total, 425, 0.11, '425 分');
eq(s425.passReached, true, '425 达标');
eq(s425.zeroed, false, '425 不触发 0 分规则');
near(s425.percentile, 14.2, 0.6, '425 分 ≈ 常模 14.2 百分位');
near(M.percentileOf(500), 50, 0.11, '常模均值 500 → 50 百分位');
near(M.percentileOf(570), 84.1, 0.7, '570 → 84.1 百分位');
near(M.percentileOf(430), 15.9, 0.7, '430 → 15.9 百分位');

/* ---------------- 4. 逐题赋分（mode=items） ---------------- */
const r = M.scoreByItems(
  { news: 5, longconv: 6, passage: 6, banked: 6, matching: 7, careful: 5 },
  { writing: 10, translation: 9 }
);
// 听力 raw = 5*1 + 6*1 + 6*2 = 23 → 163.3
near(r.sections[1].raw, 23, 0.001, '听力原始分 23');
near(r.sections[1].report, 163.3, 0.051, '听力报道分 163.3');
// 阅读 raw = 6*0.5 + 7*1 + 5*2 = 20 → 142
near(r.sections[2].raw, 20, 0.001, '阅读原始分 20');
near(r.sections[2].report, 142, 0.051, '阅读报道分 142');
// 写作 raw 10 → 71；翻译 9 → 63.9
near(r.sections[0].report, 71, 0.051, '写作报道分 71');
near(r.sections[3].report, 63.9, 0.051, '翻译报道分 63.9');
near(r.total, 163.3 + 142 + 71 + 63.9, 0.051, '总分等于各部分之和');
eq(r.totalInt, 440, '总分整数 440');
eq(r.sections[2].parts[0].accuracy, 60, '选词正确率 60%');
eq(r.sections[2].parts[0].perItem, 3.55, '选词每题 3.55 分');
near(r.sections[2].parts[2].loss, (10 - 5) * 14.2, 0.051, '仔细阅读失分 71');

/* ---------------- 5. 越界修正与警告 ---------------- */
const over = M.scoreByItems(
  { news: 99, longconv: -3, passage: 10, banked: 10, matching: 10, careful: 10 },
  { writing: 20, translation: 99 }
);
eq(over.sections[1].parts[0].correct, 7, '超量题数被截断为 7');
eq(over.sections[1].parts[1].correct, 0, '负题数归零');
near(over.sections[0].raw, 15, 0.001, '写作超分截断为 15');
ok(over.warnings.length >= 2, '越界输入产生警告', JSON.stringify(over.warnings));

const overReport = M.scoreByReport({ listening: 300, reading: -5, writing: 120, translation: 50 });
eq(overReport.sections[1].report, 248.5, '报道分超上限截断');
eq(overReport.sections[2].report, 0, '报道分负数归零');
ok(overReport.warnings.length >= 2, '报道分越界产生警告');

/* ---------------- 6. 档位判定 ---------------- */
eq(M.tierOf(15).key, 't14', '15 → 14分档');
eq(M.tierOf(13).key, 't14', '13 → 14分档');
eq(M.tierOf(12).key, 't11', '12 → 11分档');
eq(M.tierOf(9).key, 't8', '9 → 8分档');
eq(M.tierOf(6).key, 't5', '6 → 5分档');
eq(M.tierOf(3).key, 't2', '3 → 2分档');
eq(M.tierOf(0).key, 't0', '0 → 0分档');
eq(r.sections[0].tier.label, '11分档', '写作 10 分为 11 分档');

/* ---------------- 7. 分数段 ---------------- */
eq(M.bandOf(0).key, 'b_under', '0 待提升');
eq(M.bandOf(424).key, 'b_under', '424 待提升');
eq(M.bandOf(425).key, 'b_pass', '425 已达标');
eq(M.bandOf(499).key, 'b_pass', '499 已达标');
eq(M.bandOf(500).key, 'b_fair', '500 良好');
eq(M.bandOf(600).key, 'b_great', '600 拔尖');

/* ---------------- 8. 提分路径 ---------------- */
const planRes = M.scoreByItems(
  { news: 4, longconv: 4, passage: 4, banked: 4, matching: 4, careful: 4 },
  { writing: 8, translation: 8 }
);
// raw = 4+4+8 + 2+4+8 + 8 + 8 = 46 → 326.6
near(planRes.total, 326.6, 0.11, '薄弱成绩 326.6');
const plan = M.improvementPlan(planRes, 425, 'roi');
ok(plan.needed > 0, '存在目标差距', plan.needed);
ok(plan.items.length > 0, '给出提分条目');
ok(plan.items[0].perItem >= 14.2, '优先单位收益最高的题型', JSON.stringify(plan.items.map(i => i.key + ':' + i.perItem)));
ok(plan.feasible === true, '目标可通过客观题达成', JSON.stringify(plan));
const coveredSum = plan.items.reduce((s, i) => s + i.gain, 0);
ok(coveredSum >= plan.needed - 0.11, '提分条目收益覆盖缺口', `${coveredSum} vs ${plan.needed}`);
const done = M.improvementPlan(full, 425, 'roi');
eq(done.needed, 0, '已达成目标无需提分');
eq(done.feasible, true, '已达成目标 feasible');

/* ---------------- 9. 趋势统计 ---------------- */
const t = M.trendStats([
  { date: '2026-03-01T00:00:00Z', total: 380, sections: full.sections },
  { date: '2026-04-01T00:00:00Z', total: 420, sections: full.sections },
  { date: '2026-05-01T00:00:00Z', total: 470, sections: full.sections }
]);
eq(t.count, 3, '趋势样本数 3');
eq(t.best.total, 470, '最高分 470');
eq(t.worst.total, 380, '最低分 380');
eq(t.delta, 50, '最近一次提升 50');
eq(t.latest.total, 470, '最新一次 470');
ok(t.slope > 40, '线性斜率为正', t.slope);
ok(t.improving === true, 'improving 标记');
ok(t.volatility > 0, '波动率已计算', t.volatility);
eq(t.sections.listening.label, '听力理解', '分板块统计存在');
eq(M.trendStats([]).count, 0, '空数据安全');

/* ---------------- 10. 时间排序与边界 ---------------- */
const sorted = M.trendStats([
  { date: '2026-05-01T00:00:00Z', total: 300 },
  { date: '2025-01-01T00:00:00Z', total: 500 }
]);
eq(sorted.list[0].total, 500, '早的排前面');
eq(sorted.delta, -200, '下降 200');
const single = M.trendStats([{ date: '2026-05-01T00:00:00Z', total: 300, sections: [] }]);
eq(single.stable, null, '单次记录不判断稳定性');
eq(single.delta, 0, '单次记录 delta 为 0');

/* ---------------- 11. NaN / 缺失输入健壮性 ---------------- */
const bad = M.score({ mode: 'items', parts: { news: NaN, longconv: 'abc', passage: null }, subjective: { writing: undefined } });
ok(isFinite(bad.total) && bad.total === 0, '非法输入不产生 NaN', bad.total);
const noInput = M.score();
ok(isFinite(noInput.total) && noInput.total === 0, '无参调用安全', noInput.total);
ok(M.score({ mode: 'report' }).total === 0, '报道分模式空输入安全');

/* ---------------- 输出 ---------------- */
console.log(`\n单元测试：${pass} 通过 / ${fail} 失败`);
if (fail) {
  console.log('\n失败项：');
  failures.forEach(f => console.log('  ✗ ' + f));
  process.exit(1);
}
console.log('全部通过 ✓');
