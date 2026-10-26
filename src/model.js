/*!
 * model.js — 四级（CET-4）成绩赋分估算核心引擎
 * ------------------------------------------------------------------
 * 分值结构来源：《英语考试应试指南》第一章 第 3 问（官方试卷结构表）
 *   写作      1 题  15%
 *   听力      短篇新闻 7 题 7% / 长对话 8 题 8% / 听力篇章 10 题 20%   （共 25 题 35%）
 *   阅读      词汇理解 10 题 5% / 长篇阅读 10 题 10% / 仔细阅读 10 题 20%（共 30 题 35%）
 *   翻译      1 题  15%
 *   合计 57 题 / 100% / 125 分钟
 * 赋分规则：
 *   1) 各部分按官方"分值比例"折算为百分制原始分；写作、翻译按 15 分制（恰等于其 15 点百分制）；
 *   2) 百分制原始分 × 7.1 = 710 分制报道分（线性赋分参考值，710 / 100 = 7.1）；
 *   3) 官方报道分实为常模转换所得（常模均值 500、标准差 70），故额外给出正态近似的常模百分位；
 *   4) 官方规则：总分 220 分及以下记 0 分、不发放成绩报告单；425 分及以上达到"基本目标"。
 * ------------------------------------------------------------------
 * 本文件不依赖 DOM，可同时用于浏览器与 Node（测试）。
 */
(function (root) {
  'use strict';

  /* ============================== 常量 ============================== */

  var FULL_SCORE = 710;          // 报道总分满分
  var RAW_FULL = 100;            // 百分制加权原始分满分
  var POINT = FULL_SCORE / RAW_FULL;  // 7.1：百分制 1 分 = 报道分 7.1 分
  var PASS_LINE = 425;           // 官方"基本目标"线
  var REPORT_FLOOR = 220;        // 220 分及以下：官方记 0 分 / 不发成绩报告单
  var NORM_MEAN = 500;           // 常模均值
  var NORM_SD = 70;              // 常模标准差
  var SUBJECTIVE_FULL = 15;      // 写作 / 翻译 15 分制

  /* 官方五档总体印象评分（写作、翻译通用档位划分） */
  var TIERS = [
    { key: 't14', label: '14分档', min: 13, max: 15, anchor: 14 },
    { key: 't11', label: '11分档', min: 10, max: 12, anchor: 11 },
    { key: 't8',  label: '8分档',  min: 7,  max: 9,  anchor: 8  },
    { key: 't5',  label: '5分档',  min: 4,  max: 6,  anchor: 5  },
    { key: 't2',  label: '2分档',  min: 1,  max: 3,  anchor: 2  }
  ];

  /* 分数段（用于展示与建议分档，标签由 content.js 提供文案） */
  var BANDS = [
    { key: 'b_under', min: 0,   max: 424 },
    { key: 'b_pass',  min: 425, max: 499 },
    { key: 'b_fair',  min: 500, max: 549 },
    { key: 'b_good',  min: 550, max: 599 },
    { key: 'b_great', min: 600, max: 649 },
    { key: 'b_top',   min: 650, max: 710 }
  ];

  /* 试卷结构：客观题型按官方题量与每题分值比例（百分制）定义 */
  var SECTIONS = [
    {
      key: 'writing', label: '写作', short: '写作', ratio: 15, kind: 'subjective',
      tierType: 'writing', order: 1, minutes: 30,
      parts: [
        { key: 'writing', label: '短文写作', short: '作文', count: 1, perRatio: 15 }
      ]
    },
    {
      key: 'listening', label: '听力理解', short: '听力', ratio: 35, kind: 'objective',
      order: 2, minutes: 25,
      parts: [
        { key: 'news',     label: '短篇新闻', short: '新闻',   count: 7,  perRatio: 1, tip: '3 篇新闻：前两篇各 2 题，第三篇 3 题' },
        { key: 'longconv', label: '长对话',   short: '长对话', count: 8,  perRatio: 1, tip: '2 篇长对话，每篇各 4 题' },
        { key: 'passage',  label: '听力篇章', short: '篇章',   count: 10, perRatio: 2, tip: '3 篇短文：4+3+3 题，每题分值最高' }
      ]
    },
    {
      key: 'reading', label: '阅读理解', short: '阅读', ratio: 35, kind: 'objective',
      order: 3, minutes: 40,
      parts: [
        { key: 'banked',   label: '词汇理解（选词填空）', short: '选词', count: 10, perRatio: 0.5, tip: '1 篇 200~250 词短文，10 空、15 备选词' },
        { key: 'matching', label: '长篇阅读（段落匹配）', short: '匹配', count: 10, perRatio: 1,   tip: '约 1000 词长文，10 句信息匹配' },
        { key: 'careful',  label: '仔细阅读', short: '仔细', count: 10, perRatio: 2,   tip: '2 篇 300~350 词短文，每篇 5 题' }
      ]
    },
    {
      key: 'translation', label: '翻译', short: '翻译', ratio: 15, kind: 'subjective',
      tierType: 'translation', order: 4, minutes: 30,
      parts: [
        { key: 'translation', label: '汉译英段落翻译', short: '翻译', count: 1, perRatio: 15 }
      ]
    }
  ];

  var SECTION_MAP = {};
  var PART_LIST = [];   // 全部客观题小项（6 个）
  var PART_MAP = {};
  SECTIONS.forEach(function (sec) {
    SECTION_MAP[sec.key] = sec;
    sec.reportMax = round1(sec.ratio * POINT);
    sec.rawMax = sec.ratio;
    sec.parts.forEach(function (part) {
      part.section = sec.key;
      part.sectionLabel = sec.label;
      part.rawMax = round2(part.count * part.perRatio);
      part.reportMax = round1(part.count * part.perRatio * POINT);
      part.perItem = part.perRatio * POINT;          // 每答对 1 题 ≈ 报道分
      PART_MAP[part.key] = part;
      if (sec.kind === 'objective') PART_LIST.push(part);
    });
  });

  /* ============================== 工具 ============================== */

  function clamp(n, lo, hi) {
    n = Number(n);
    if (!isFinite(n)) return 0;
    return Math.min(hi, Math.max(lo, n));
  }
  function clampInt(n, lo, hi) {
    return Math.round(clamp(n, lo, hi));
  }
  function round1(n) { return Math.round((Number(n) || 0) * 10) / 10; }
  function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  function round0(n) { return Math.round(Number(n) || 0); }

  /** 误差函数（Abramowitz & Stegun 7.1.26，绝对误差 < 1.5e-7） */
  function erf(x) {
    var sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    var a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741,
        a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    var t = 1 / (1 + p * x);
    var y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return sign * y;
  }

  /** 标准正态分布 CDF */
  function normalCdf(z) {
    return 0.5 * (1 + erf(z / Math.SQRT2));
  }

  /** 报道分 → 常模百分位（0~100，正态近似） */
  function percentileOf(reportScore, mean, sd) {
    mean = mean == null ? NORM_MEAN : mean;
    sd = sd == null ? NORM_SD : sd;
    var p = normalCdf((Number(reportScore) - mean) / sd) * 100;
    return Math.min(100, Math.max(0, round1(p)));
  }

  /** 报道分 → 分数段 */
  function bandOf(reportScore) {
    var s = Number(reportScore) || 0;
    for (var i = 0; i < BANDS.length; i++) {
      if (s >= BANDS[i].min && s <= BANDS[i].max) return BANDS[i];
    }
    return s < 0 ? BANDS[0] : BANDS[BANDS.length - 1];
  }

  /** 15 分制得分 → 档位 */
  function tierOf(score) {
    var s = clamp(score, 0, SUBJECTIVE_FULL);
    if (s >= 13) return TIERS[0];
    if (s >= 10) return TIERS[1];
    if (s >= 7) return TIERS[2];
    if (s >= 4) return TIERS[3];
    if (s >= 1) return TIERS[4];
    return { key: 't0', label: '0 分', min: 0, max: 0, anchor: 0 };
  }

  /** 正确率 → 状态（用于 UI 与诊断） */
  function statusOf(accuracy) {
    if (accuracy >= 0.85) return 'strong';
    if (accuracy >= 0.7) return 'ok';
    if (accuracy >= 0.55) return 'weak';
    return 'poor';
  }

  /* ============================== 赋分 ============================== */

  /**
   * 计算一次成绩
   * @param {Object} input
   * @param {'items'|'report'} [input.mode] 录入方式
   * @param {Object} [input.parts] {news,longconv,passage,banked,matching,careful} 答对题数
   * @param {Object} [input.subjective] {writing,translation} 15 分制自评
   * @param {Object} [input.report] {listening,reading,writing,translation} 已知报道分
   * @param {string} [input.date] 录入时间（ISO 字符串）
   * @param {string} [input.note]
   * @returns {Object} 结果快照
   */
  function score(input) {
    input = input || {};
    var mode = input.mode === 'report' ? 'report' : 'items';
    var warnings = [];
    var partsIn = input.parts || {};
    var subjIn = input.subjective || {};
    var reportIn = input.report || {};
    var sections = [];
    var rawTotal = 0;
    var reportTotal = 0;

    SECTIONS.forEach(function (sec) {
      var out = {
        key: sec.key,
        label: sec.label,
        short: sec.short,
        ratio: sec.ratio,
        kind: sec.kind,
        order: sec.order,
        rawMax: sec.rawMax,
        reportMax: sec.reportMax,
        parts: [],
        correct: null,
        derived: false
      };

      if (sec.kind === 'objective') {
        var raw = 0, correctSum = 0, itemCount = 0;
        sec.parts.forEach(function (part) {
          var c = clampInt(partsIn[part.key], 0, part.count);
          if (partsIn[part.key] != null && Number(partsIn[part.key]) > part.count) {
            warnings.push(part.label + ' 最多 ' + part.count + ' 题，已自动修正');
          } else if (partsIn[part.key] != null && Number(partsIn[part.key]) < 0) {
            warnings.push(part.label + ' 答对题数不能为负，已按 0 计');
          }
          var pr = c * part.perRatio;
          correctSum += c;
          itemCount += part.count;
          raw += pr;
          var partOut = {
            key: part.key,
            label: part.label,
            short: part.short,
            section: sec.key,
            sectionLabel: sec.label,
            count: part.count,
            correct: c,
            wrong: part.count - c,
            accuracy: round1(c / part.count * 100),
            raw: round2(pr),
            rawMax: part.rawMax,
            report: round1(pr * POINT),
            reportMax: part.reportMax,
            perItem: round2(part.perItem),
            loss: round1((part.count - c) * part.perItem),
            status: statusOf(c / part.count),
            tip: part.tip
          };
          out.parts.push(partOut);
        });
        out.correct = correctSum;
        out.itemCount = itemCount;
        out.raw = round2(raw);
        out.accuracy = round1(raw / sec.ratio * 100);
        out.status = statusOf(raw / sec.ratio);
      } else {
        var sc = clamp(Number(subjIn[sec.key]) || 0, 0, SUBJECTIVE_FULL);
        if (mode === 'items') sc = Math.round(sc);
        if (subjIn[sec.key] != null && (Number(subjIn[sec.key]) > SUBJECTIVE_FULL || Number(subjIn[sec.key]) < 0)) {
          warnings.push(sec.label + '按 15 分制评分（0~15），已自动修正为 ' + sc + ' 分');
        }
        var tier = tierOf(sc);
        out.raw = round2(sc);
        out.accuracy = round1(sc / SUBJECTIVE_FULL * 100);
        out.status = statusOf(sc / SUBJECTIVE_FULL);
        out.tier = { key: tier.key, label: tier.label, min: tier.min, max: tier.max };
        out.parts.push({
          key: sec.key,
          label: sec.parts[0].label,
          short: sec.parts[0].short,
          section: sec.key,
          sectionLabel: sec.label,
          count: 1,
          correct: null,
          accuracy: out.accuracy,
          raw: round2(sc),
          rawMax: SUBJECTIVE_FULL,
          report: round1(sc * POINT),
          reportMax: sec.reportMax,
          perItem: round2(POINT),
          loss: round1(sec.reportMax - sc * POINT),
          status: out.status,
          tier: out.tier
        });
      }

      if (mode === 'report') {
        var given = clamp(Number(reportIn[sec.key]), 0, sec.reportMax);
        if (reportIn[sec.key] != null && Number(reportIn[sec.key]) > sec.reportMax) {
          warnings.push(sec.label + '报道分最高 ' + sec.reportMax + '，已自动修正');
        }
        out.report = round1(given);
        out.raw = round2(given / POINT);      // 由报道分反推的百分制等效分
        out.derived = true;
        out.accuracy = round1(out.raw / sec.ratio * 100);
        out.status = statusOf(out.raw / sec.ratio);
        out.parts.forEach(function (p) {
          p.report = round1(p.report);          // 保留录入时的分项（若为 0 则无参考意义）
          p.derived = true;
        });
      } else {
        out.report = round1(out.raw * POINT);
      }

      out.gap = round1(sec.reportMax - out.report);        // 距满分失分
      out.rate = round1(out.report / sec.reportMax * 100);  // 得分率

      rawTotal += out.raw;
      reportTotal += out.report;
      sections.push(out);
    });

    var total = round1(reportTotal);
    var totalInt = round0(total);
    var percentile = percentileOf(total);
    var band = bandOf(total);
    var zeroed = totalInt <= REPORT_FLOOR;

    return {
      mode: mode,
      date: input.date || new Date().toISOString(),
      note: String(input.note == null ? '' : input.note).slice(0, 120),
      sections: sections,
      rawTotal: round2(rawTotal),
      total: total,
      totalInt: totalInt,
      percentile: percentile,
      bandKey: band.key,
      bandRange: [band.min, band.max],
      passLine: PASS_LINE,
      passGap: round1(PASS_LINE - total),
      passReached: totalInt >= PASS_LINE,
      zeroed: zeroed,
      lossTotal: round1(FULL_SCORE - total),
      warnings: warnings
    };
  }

  /** 便捷：由"答对题数"直接计算（不含写作/翻译时按 0 计） */
  function scoreByItems(parts, subjective) {
    return score({ mode: 'items', parts: parts || {}, subjective: subjective || {} });
  }

  /** 由各板块报道分直接计算 */
  function scoreByReport(report) {
    return score({ mode: 'report', report: report || {} });
  }

  /** 目标达成所需报道分差 */
  function gapToTarget(total, target) {
    var t = Number(target) || PASS_LINE;
    return round1(t - (Number(total) || 0));
  }

  /**
   * 提分路径：给定当前各小项正确数与每题收益，求达成目标需要"多对几题"
   * @param {Object} result score() 结果
   * @param {number} target 目标总分
   * @param {'roi'|'loss'|'balanced'} [strategy]
   */
  function improvementPlan(result, target, strategy) {
    strategy = strategy || 'roi';
    var need = gapToTarget(result.total, target);
    var objective = [];
    result.sections.forEach(function (sec) {
      if (sec.kind !== 'objective') return;
      sec.parts.forEach(function (p) {
        objective.push({
          key: p.key,
          label: p.label,
          short: p.short,
          sectionLabel: p.sectionLabel,
          perItem: p.perItem,
          room: p.count - p.correct,        // 还能多对的题数
          accuracy: p.accuracy,
          loss: p.loss
        });
      });
    });

    if (need <= 0) {
      return { needed: 0, strategy: strategy, feasible: true, items: [], message: '目标已达成，保持节奏并冲击更高分数。' };
    }

    var pool = objective.slice();
    if (strategy === 'loss') {
      pool.sort(function (a, b) { return b.loss - a.loss || b.perItem - a.perItem; });
    } else if (strategy === 'balanced') {
      // 先照顾得分率低的题型（边际提升空间大），再按单位收益排序
      pool.sort(function (a, b) { return a.accuracy - b.accuracy || b.perItem - a.perItem; });
    } else {
      pool.sort(function (a, b) { return b.perItem - a.perItem || a.accuracy - b.accuracy; });
    }

    var items = [];
    var remain = need;
    for (var i = 0; i < pool.length && remain > 0; i++) {
      var p = pool[i];
      if (p.room <= 0) continue;
      var n = Math.min(p.room, Math.ceil(remain / p.perItem - 1e-9));
      if (n <= 0) continue;
      var gain = round1(n * p.perItem);
      items.push({
        key: p.key, label: p.label, short: p.short, sectionLabel: p.sectionLabel,
        count: n, perItem: round2(p.perItem), gain: gain,
        accuracy: p.accuracy, room: p.room
      });
      remain = round1(remain - gain);
    }

    var maxPossible = 0;
    objective.forEach(function (p) { maxPossible += p.room * p.perItem; });
    var covered = round1(need - remain);

    return {
      needed: need,
      strategy: strategy,
      feasible: remain <= 0,
      covered: covered,
      maxPossible: round1(maxPossible),
      shortfall: remain > 0 ? round1(remain) : 0,
      items: items,
      message: remain > 0
        ? '仅靠客观题已不足以覆盖目标差距，还需要写作与翻译同步提分（每档约 7.1 分）。'
        : '按此路径把题答对，即可覆盖目标差距。'
    };
  }

  /** 趋势统计：对一组 result 快照做时间序列分析 */
  function trendStats(results) {
    var list = (results || []).slice().sort(function (a, b) {
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });
    if (!list.length) {
      return { count: 0, latest: null, best: null, worst: null, delta: 0, slope: 0, volatility: 0, sections: {} };
    }
    var totals = list.map(function (r) { return r.total; });
    var best = list[0], worst = list[0];
    list.forEach(function (r) {
      if (r.total > best.total) best = r;
      if (r.total < worst.total) worst = r;
    });
    var latest = list[list.length - 1];
    var prev = list.length > 1 ? list[list.length - 2] : null;
    var avg = totals.reduce(function (a, b) { return a + b; }, 0) / totals.length;
    var variance = totals.reduce(function (a, b) { return a + (b - avg) * (b - avg); }, 0) / totals.length;
    var sd = Math.sqrt(variance);

    // 以"第几次"为自变量的线性回归斜率（分/次）
    var n = list.length, sx = 0, sy = 0, sxx = 0, sxy = 0;
    list.forEach(function (r, i) {
      sx += i; sy += r.total; sxx += i * i; sxy += i * r.total;
    });
    var slope = n > 1 ? (n * sxy - sx * sy) / (n * sxx - sx * sx) : 0;

    var sections = {};
    SECTIONS.forEach(function (sec) {
      var vals = list.map(function (r) {
        var arr = (r && r.sections) || [];
        for (var i = 0; i < arr.length; i++) { if (arr[i] && arr[i].key === sec.key) return arr[i].report; }
        return 0;
      });
      var mean = vals.reduce(function (a, b) { return a + b; }, 0) / (vals.length || 1);
      var v = vals.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / (vals.length || 1);
      sections[sec.key] = {
        key: sec.key,
        label: sec.label,
        latest: vals[vals.length - 1],
        mean: round1(mean),
        sd: round1(Math.sqrt(v)),
        max: Math.max.apply(null, vals),
        min: Math.min.apply(null, vals),
        delta: vals.length > 1 ? round1(vals[vals.length - 1] - vals[vals.length - 2]) : 0
      };
    });

    return {
      count: list.length,
      list: list,
      latest: latest,
      prev: prev,
      best: best,
      worst: worst,
      avg: round1(avg),
      delta: prev ? round1(latest.total - prev.total) : 0,
      slope: round1(slope),
      volatility: round1(sd),
      stable: n < 2 ? null : sd <= 20,
      improving: n < 2 ? null : slope > 3,
      sections: sections
    };
  }

  /* ============================== 导出 ============================== */

  root.CET4_MODEL = {
    FULL_SCORE: FULL_SCORE,
    RAW_FULL: RAW_FULL,
    POINT: POINT,
    PASS_LINE: PASS_LINE,
    REPORT_FLOOR: REPORT_FLOOR,
    NORM_MEAN: NORM_MEAN,
    NORM_SD: NORM_SD,
    SUBJECTIVE_FULL: SUBJECTIVE_FULL,
    TIERS: TIERS,
    BANDS: BANDS,
    SECTIONS: SECTIONS,
    SECTION_MAP: SECTION_MAP,
    PART_LIST: PART_LIST,
    PART_MAP: PART_MAP,
    score: score,
    scoreByItems: scoreByItems,
    scoreByReport: scoreByReport,
    percentileOf: percentileOf,
    bandOf: bandOf,
    tierOf: tierOf,
    statusOf: statusOf,
    gapToTarget: gapToTarget,
    improvementPlan: improvementPlan,
    trendStats: trendStats,
    normalCdf: normalCdf,
    round1: round1,
    round2: round2,
    round0: round0,
    clamp: clamp,
    clampInt: clampInt
  };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
