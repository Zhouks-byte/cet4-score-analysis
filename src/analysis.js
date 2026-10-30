/*!
 * analysis.js — 针对性分析与建议引擎
 * 依赖 model.js（CET4_MODEL）与 content.js（CET4_CONTENT），不依赖 DOM。
 */
(function (root) {
  'use strict';

  function getModel() {
    if (!root.CET4_MODEL) throw new Error('analysis.js 需要先加载 model.js');
    return root.CET4_MODEL;
  }
  function getContent() {
    return root.CET4_CONTENT || { bands: [], tiers: {}, sections: {}, plans: {}, mottos: [] };
  }

  function round1(n) { return Math.round((Number(n) || 0) * 10) / 10; }

  /** 内容库分数段（与 model.BANDS 同序） */
  function bandContent(bandKey) {
    var C = getContent();
    var M = getModel();
    var idx = 0;
    for (var i = 0; i < M.BANDS.length; i++) { if (M.BANDS[i].key === bandKey) { idx = i; break; } }
    var c = (C.bands || [])[idx];
    if (c) return c;
    return { label: '—', tagline: '', desc: '', actions: [] };
  }

  function sectionOf(result, key) {
    var arr = (result && result.sections) || [];
    for (var i = 0; i < arr.length; i++) { if (arr[i].key === key) return arr[i]; }
    return null;
  }

  /** 主观题：距下一档还差多少分（15 分制 / 报道分） */
  function tierGap(score15) {
    var M = getModel();
    var s = Number(score15) || 0;
    var tiers = M.TIERS;
    for (var i = tiers.length - 1; i >= 0; i--) {
      if (s < tiers[i].min) {
        return { need15: round1(tiers[i].min - s), needReport: round1((tiers[i].min - s) * M.POINT), nextLabel: tiers[i].label, atTop: false };
      }
    }
    return { need15: 0, needReport: 0, nextLabel: '已到最高档', atTop: true };
  }

  /**
   * 主分析入口
   * @param {Object} result score() 结果
   * @param {Object} opts { target, trends, weeks }
   */
  function analyze(result, opts) {
    opts = opts || {};
    var M = getModel();
    var C = getContent();
    var target = Number(opts.target) || M.PASS_LINE;
    var band = bandContent(result.bandKey);

    /* ---------- 板块排名 ---------- */
    var rows = result.sections.map(function (sec) {
      return {
        key: sec.key, label: sec.label, short: sec.short, kind: sec.kind,
        report: sec.report, max: sec.reportMax, rate: sec.rate, loss: sec.gap,
        status: sec.status, parts: sec.parts, tier: sec.tier, raw: sec.raw
      };
    });
    var byRate = rows.slice().sort(function (a, b) { return a.rate - b.rate; });
    var byLoss = rows.slice().sort(function (a, b) { return b.loss - a.loss; });
    var weakest = byRate[0], strongest = byRate[byRate.length - 1];
    var biggestLoss = byLoss[0];

    /* ---------- 题型排名（客观题） ---------- */
    var parts = [];
    result.sections.forEach(function (sec) {
      if (sec.kind !== 'objective') return;
      sec.parts.forEach(function (p) {
        parts.push({
          key: p.key, label: p.label, short: p.short, sectionLabel: p.sectionLabel,
          section: sec.key, correct: p.correct, count: p.count, accuracy: p.accuracy,
          report: p.report, max: p.reportMax, loss: p.loss, perItem: p.perItem, status: p.status
        });
      });
    });
    var weakParts = parts.slice().sort(function (a, b) { return a.accuracy - b.accuracy; });
    var lossParts = parts.slice().sort(function (a, b) { return b.loss - a.loss; });
    var highValueWeak = parts.filter(function (p) {
      return p.perItem >= 7 && p.accuracy < 70;
    }).sort(function (a, b) { return b.loss - a.loss; });

    /* ---------- 诊断条目 ---------- */
    var diagnoses = [];
    var push = function (level, icon, title, text) {
      diagnoses.push({ level: level, icon: icon, title: title, text: text });
    };

    // 1. 目标差距
    if (result.totalInt < target) {
      var need = round1(target - result.total);
      push('high', '◎', '距目标还差 ' + Math.round(need) + ' 分',
        '你当前 ' + result.totalInt + ' 分，目标 ' + target + ' 分。按分值结构，这大约相当于 ' +
        countItems(need) + '。优先攻克单位收益高且正确率低的题型，提分效率最高。');
    } else {
      var over = Math.max(0, result.totalInt - target);
      push('good', '✓', '已达到 ' + target + ' 分目标',
        '当前 ' + result.totalInt + ' 分，比目标高 ' + over + ' 分。建议把目标上移一档，把训练重心放在稳定性和主观题上。');
    }

    // 2. 客观题 0 分 / 缺考规则
    if (result.zeroed) {
      push('warn', '!', '特别提醒：总分 ' + result.totalInt + ' 分不超过 220 分',
        '按官方规则，总分在 220 分及以下记为 0 分且不发放成绩报告单。当前估分处于该区间，需要优先保证基础题的正确率，先把 425 分的门槛跨过去。');
    }

    // 3. 短板板块
    if (weakest && weakest.rate < 60) {
      var secC = (C.sections || {})[weakest.key] || {};
      var tips = (secC.tips || []).slice(0, 2);
      push('bad', '▼', shortestLabel(weakest.key) + '是最短板（得分率 ' + weakest.rate + '%）',
        '该部分满分 ' + weakest.max + ' 分，你只拿到 ' + weakest.report + ' 分，失分 ' + weakest.loss + ' 分。' +
        (tips.length ? tips[0] : '建议把每天固定训练时段优先分给它。'));
    }

    // 4. 高价值题型
    if (highValueWeak.length) {
      var hp = highValueWeak[0];
      push('high', '◆', hp.label + '每题 ' + hp.perItem + ' 分，正确率仅 ' + hp.accuracy + '%',
        '这一题型是全卷单位收益最高的，每多答对 1 题相当于总分 +' + hp.perItem + ' 分。' +
        '当前还有 ' + (hp.count - hp.correct) + ' 题的空间，把正确率提到 80% 即可多得约 ' +
        round1((Math.round(hp.count * 0.8) - hp.correct) * hp.perItem) + ' 分。');
    }

    // 5. 主观题档位
    ['writing', 'translation'].forEach(function (key) {
      var sec = sectionOf(result, key);
      if (!sec || sec.tier == null) return;
      var g = tierGap(sec.raw);
      if (g.atTop) return;
      if (sec.raw <= 9) {
        push('bad', '✎', sec.label + '处于 ' + sec.tier.label + '（' + sec.raw + '/15）',
          '距 ' + g.nextLabel + '仅差 ' + g.need15 + ' 分（报道分 +' + g.needReport + '）。' +
          (key === 'writing'
            ? '先解决切题与结构：审题后列三段提纲，确保中心明确、句子写对，再追求高级表达。'
            : '先解决准确表达：用"提主干、调语序"的方法切分句子，检查时态、单复数和拼写。'));
      }
    });

    // 6. 时间分配与节奏（客观题整体）
    var objLost = parts.reduce(function (s, p) { return s + p.loss; }, 0);
    var objMax = parts.reduce(function (s, p) { return s + p.max; }, 0);
    push('mid', '⏱', '客观题合计失分 ' + round1(objLost) + ' 分',
      '听力 ' + result.sections[1].gap + ' 分 + 阅读 ' + result.sections[2].gap + ' 分，占全卷失分的 ' +
      Math.round(objLost / Math.max(1, result.lossTotal) * 100) + '%。' +
      '客观题 55 题合计 497 分，是估分提升的主战场，写作翻译合计 213 分则依赖长期积累。');

    // 7. 稳定性（若有趋势）
    var trends = opts.trends;
    if (trends && trends.count >= 2) {
      if (trends.improving) {
        push('good', '↗', '近 ' + trends.count + ' 次成绩整体上升',
          '平均每次提升约 ' + trends.slope + ' 分，最近一次较上次 ' + sign(trends.delta) + trends.delta + ' 分。保持当前节奏，注意不要为了刷次数打乱复习计划。');
      } else if (trends.slope < -2) {
        push('warn', '↘', '近 ' + trends.count + ' 次成绩出现回落',
          '平均每次下降约 ' + Math.abs(trends.slope) + ' 分。先检查是否题目难度不同（用得分率对比更可靠），再考虑是否练习量下降或作息紊乱。');
      }
      if (trends.volatility >= 25) {
        push('mid', '≈', '成绩波动较大（标准差 ' + trends.volatility + ' 分）',
          '波动主要来自单次发挥，说明基础还不稳定。建议用同一套真题分模块限时训练，把每部分的正确率固定在一个区间内再冲高分。');
      }
    }

    /* ---------- 提分路径 ---------- */
    var plan = M.improvementPlan(result, target, 'roi');
    var planSteps = plan.items.map(function (it) {
      return {
        title: it.label + ' 再多对 ' + it.count + ' 题',
        sub: '每题 ' + it.perItem + ' 分 · 当前正确率 ' + it.accuracy + '% · 还剩 ' + it.room + ' 题空间',
        gain: '+' + Math.round(it.gain)
      };
    });
    if (!planSteps.length && result.totalInt >= target) {
      planSteps.push({
        title: '保持每日真题训练',
        sub: '已超过目标，重点是稳定发挥并把主观题往上提一档',
        gain: '维持'
      });
    }

    /* ---------- 学习计划 ---------- */
    var weeks = opts.weeks;
    var planKey = weeks == null ? null : (weeks >= 10 ? 'long' : weeks >= 5 ? 'mid' : weeks >= 2 ? 'short' : 'sprint');
    var stage = planKey && C.plans && C.plans[planKey] ? C.plans[planKey] : null;

    /* ---------- 建议动作 ---------- */
    var actions = [];
    var secWeak = (C.sections || {})[weakest ? weakest.key : 'reading'] || {};
    if (secWeak.intro) actions.push(secWeak.intro);
    (secWeak.strategy || []).slice(0, 3).forEach(function (s) { actions.push(s); });
    if (weakParts.length) {
      var wt = weakParts[0];
      var typeC = ((C.sections || {})[wt.section] || { types: {} }).types || {};
      var tc = typeC[wt.key];
      if (tc && tc.weak) tc.weak.slice(0, 2).forEach(function (w) { actions.push(w); });
      if (tc && tc.tips) tc.tips.slice(0, 2).forEach(function (w) { actions.push(w); });
    }
    (band.actions || []).forEach(function (a) { actions.push(a); });

    /* ---------- 结论 ---------- */
    var summary = buildSummary(result, band, target, weakest, highValueWeak, plan);

    return {
      target: target,
      band: band,
      percentile: result.percentile,
      rows: rows,
      weakest: weakest,
      strongest: strongest,
      biggestLoss: biggestLoss,
      parts: parts,
      weakParts: weakParts,
      highValueWeak: highValueWeak,
      diagnoses: diagnoses,
      plan: plan,
      planSteps: planSteps,
      stage: stage,
      planKey: planKey,
      actions: dedupe(actions).slice(0, 8),
      summary: summary,
      tierGapWriting: result.sections[0] && result.sections[0].tier ? tierGap(result.sections[0].raw) : null,
      tierGapTranslation: result.sections[3] && result.sections[3].tier ? tierGap(result.sections[3].raw) : null
    };
  }

  function countItems(need) {
    // 以"仔细阅读/听力篇章每题 14.2 分"作为参照换算
    var n = Math.max(1, Math.round(need / 14.2));
    return n + ' 道仔细阅读或听力篇章题（每题 14.2 分）';
  }

  function shortestLabel(key) {
    var map = { listening: '听力', reading: '阅读', writing: '写作', translation: '翻译' };
    return map[key] || key;
  }

  function sign(n) { return n > 0 ? '+' : ''; }
  function dedupe(arr) {
    var seen = {}, out = [];
    arr.forEach(function (x) { if (x && !seen[x]) { seen[x] = 1; out.push(x); } });
    return out;
  }

  function buildSummary(result, band, target, weakest, highValueWeak, plan) {
    var t = '本次估分 ' + result.totalInt + ' 分（常模百分位约 ' + result.percentile + '%），属于「' + band.label + '」区间。';
    if (result.totalInt >= target) t += ' 已达到 ' + target + ' 分目标，';
    else t += ' 距 ' + target + ' 分目标还差 ' + Math.round(target - result.total) + ' 分，';
    t += '得分率最低的是' + shortestLabel(weakest.key) + '（' + weakest.rate + '%）。';
    if (highValueWeak.length) {
      t += '建议优先补' + highValueWeak[0].label + '，单题收益最高。';
    } else if (plan && plan.items.length) {
      t += '建议按提分路径先补' + plan.items[0].label + '。';
    }
    return t;
  }

  /* ---------------- 报告导出（纯文本，便于复制/分享） ---------------- */
  function toText(result, analysis, content) {
    var lines = [];
    lines.push('【四级成绩分析报告】');
    lines.push('录入时间：' + formatDate(result.date));
    if (result.note) lines.push('备注：' + result.note);
    lines.push('');
    lines.push('估分总分：' + result.totalInt + ' / 710（常模百分位约 ' + result.percentile + '%）');
    lines.push('分数段：' + (analysis.band.label || '') + ' ' + (analysis.band.tagline || ''));
    lines.push('');
    lines.push('各部分得分：');
    result.sections.forEach(function (s) {
      lines.push('  ' + s.label + '：' + s.report + ' / ' + s.reportMax + '（得分率 ' + s.rate + '%，失分 ' + s.gap + '）');
    });
    lines.push('');
    lines.push('题型明细：');
    analysis.parts.forEach(function (p) {
      lines.push('  ' + p.label + '：答对 ' + p.correct + '/' + p.count + '（' + p.accuracy + '%），得 ' + p.report + ' 分');
    });
    lines.push('');
    lines.push('诊断与建议：');
    analysis.diagnoses.forEach(function (d) { lines.push('  · ' + d.title + '：' + d.text); });
    if (analysis.plan && analysis.plan.items.length) {
      lines.push('');
      lines.push('达成 ' + analysis.target + ' 分的提分路径：');
      analysis.plan.items.forEach(function (it, i) {
        lines.push('  ' + (i + 1) + '. ' + it.label + ' 再多对 ' + it.count + ' 题（+' + Math.round(it.gain) + ' 分）');
      });
    }
    lines.push('');
    lines.push('说明：分数为按官方分值比例与常模模型估算的参考值，实际报道分以教育部教育考试院公布为准。');
    return lines.join('\n');
  }

  function formatDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    var p = function (x) { return (x < 10 ? '0' : '') + x; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* ---------------- 分数段进度建议 ---------------- */
  function targetProgress(result, target) {
    var M = getModel();
    var t = Number(target) || M.PASS_LINE;
    var total = Number(result.total) || 0;
    return {
      target: t,
      current: total,
      pct: Math.min(100, Math.max(0, Math.round(total / t * 100))),
      gap: Math.round(t - total),
      reached: total >= t
    };
  }

  root.CET4_ANALYSIS = {
    analyze: analyze,
    bandContent: bandContent,
    tierGap: tierGap,
    toText: toText,
    formatDate: formatDate,
    targetProgress: targetProgress
  };
})(typeof window !== 'undefined' ? window : globalThis);
