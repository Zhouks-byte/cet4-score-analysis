/*!
 * app.js — 四级成绩分析 交互层
 * 依赖：model.js / content.js / charts.js / analysis.js
 */
(function () {
  'use strict';

  var M = window.CET4_MODEL;
  var C = window.CET4_CONTENT || {};
  var CH = window.CET4_CHARTS;
  var A = window.CET4_ANALYSIS;
  var KEY = 'cet4.score.analysis.v1';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var esc = function (s) { return CH.esc(s); };
  function fmt1(n) { return Math.round((Number(n) || 0) * 10) / 10; }
  function fmtInt(n) { return Math.round(Number(n) || 0); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  var ICON = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V20a1 1 0 0 0 1 1H10v-6h4v6h3.5a1 1 0 0 0 1-1V9.5"/>',
    edit: '<path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z"/><path d="M14.5 6.5l3 3"/>',
    chart: '<path d="M4 20V6"/><path d="M4 20h16"/><path d="M8 16v-4"/><path d="M12.5 16V8"/><path d="M17 16v-6"/>',
    list: '<path d="M8 6h12"/><path d="M8 12h12"/><path d="M8 18h12"/><circle cx="4" cy="6" r="1.2"/><circle cx="4" cy="12" r="1.2"/><circle cx="4" cy="18" r="1.2"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    trash: '<path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>',
    arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
    download: '<path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M4 21h16"/>',
    upload: '<path d="M12 21V9"/><path d="m7 13 5-5 5 5"/><path d="M4 3h16"/>',
    spark: '<path d="M12 3v4"/><path d="M12 17v4"/><path d="M3 12h4"/><path d="M17 12h4"/><path d="m5.6 5.6 2.8 2.8"/><path d="m15.6 15.6 2.8 2.8"/><path d="m18.4 5.6-2.8 2.8"/><path d="m8.4 15.6-2.8 2.8"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>'
  };
  function icon(name, cls) {
    return '<svg class="ico' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICON[name] || '') + '</svg>';
  }

  /* ============================== 状态 ============================== */

  var state = {
    view: 'home',
    target: 425,
    weeks: null,
    records: [],
    draft: null,
    chartMode: 'total',
    seriesOn: { listening: true, reading: true, writing: true, translation: true },
    compareId: null
  };

  function blankDraft() {
    return {
      mode: 'items',
      parts: { news: 0, longconv: 0, passage: 0, banked: 0, matching: 0, careful: 0 },
      subjective: { writing: 0, translation: 0 },
      report: { listening: 0, reading: 0, writing: 0, translation: 0 },
      date: nowLocalInput(),
      note: ''
    };
  }

  function nowLocalInput() {
    var d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { raw = null; }
    if (raw) {
      try {
        var d = JSON.parse(raw);
        if (d && Array.isArray(d.records)) {
          state.records = d.records.filter(function (r) { return r && r.ts; });
        }
        if (d && isFinite(d.target)) state.target = d.target;
        if (d && (d.weeks === null || isFinite(d.weeks))) state.weeks = d.weeks;
        if (d && d.draft) state.draft = d.draft;
      } catch (e) { /* ignore */ }
    }
    if (!state.draft) state.draft = blankDraft();
  }

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        v: 1,
        target: state.target,
        weeks: state.weeks,
        draft: state.draft,
        records: state.records
      }));
    } catch (e) { /* 隐私模式等场景忽略 */ }
  }

  /* ============================== 计算 ============================== */

  function recordResult(rec) {
    return M.score({
      mode: rec.mode,
      parts: rec.parts,
      subjective: rec.subjective,
      report: rec.report,
      date: rec.ts,
      note: rec.note
    });
  }

  function allResults() {
    return state.records
      .map(function (r) { return recordResult(r); })
      .sort(function (a, b) { return new Date(a.date) - new Date(b.date); });
  }

  function latestResult() {
    var list = allResults();
    return list.length ? list[list.length - 1] : null;
  }

  function draftResult() {
    var d = state.draft;
    return M.score({
      mode: d.mode,
      parts: d.parts,
      subjective: d.subjective,
      report: d.report,
      date: d.date,
      note: d.note
    });
  }

  function bandLabel(key) {
    var c = A.bandContent(key);
    return c.label || '—';
  }

  function shortDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return (d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function fullDate(iso) {
    return A.formatDate(iso);
  }

  /* ============================== 通用组件 ============================== */

  function statCell(k, v, sub, tone) {
    return '<div class="stat"><div class="k">' + esc(k) + '</div><div class="v">' + v +
      '</div><div class="d ' + (tone || 'flat') + '">' + esc(sub || '') + '</div></div>';
  }

  function segHtml(items, current, act, attr) {
    attr = attr || ('data-' + act);
    return '<div class="seg" role="tablist">' + items.map(function (it) {
      return '<button type="button" role="tab" data-act="' + act + '" ' + attr + '="' + esc(it.key) + '" aria-selected="' +
        (String(it.key) === String(current)) + '">' + esc(it.label) + '</button>';
    }).join('') + '</div>';
  }

  function badgeClass(status) {
    return status === 'strong' ? 'strong' : status === 'ok' ? 'ok' : status === 'weak' ? 'weak' : 'poor';
  }
  function statusText(status) {
    return status === 'strong' ? '强项' : status === 'ok' ? '良好' : status === 'weak' ? '偏弱' : '薄弱';
  }
  function badge(status) {
    return '<span class="badge ' + badgeClass(status) + '">' + statusText(status) + '</span>';
  }

  /* ============================== 图表挂载 ============================== */

  var chartTasks = [];

  function mountChart(el, draw) {
    if (!el) return;
    chartTasks.push({ el: el, draw: draw });
    paintChart(el, draw);
  }

  function paintChart(el, draw) {
    var w = Math.floor(el.clientWidth);
    if (!w) return;
    try {
      el.innerHTML = draw(w);
    } catch (e) {
      el.innerHTML = '<div class="chart-empty">图表渲染失败</div>';
    }
  }

  var resizeRaf = null;
  function onResize() {
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(function () {
      chartTasks.forEach(function (t) {
        if (!document.body.contains(t.el)) return;
        paintChart(t.el, t.draw);
      });
    });
  }

  /* ============================== 视图：首页 ============================== */

  function viewHome() {
    var list = allResults();
    var trends = M.trendStats(list);

    if (!list.length) {
      return '<div class="card">' + emptyState() + '</div>';
    }

    var latest = list[list.length - 1];
    var band = A.bandContent(latest.bandKey);
    var tp = A.targetProgress(latest, state.target);
    var delta = trends.delta;
    var deltaTone = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
    var deltaTxt = trends.count > 1 ? (delta > 0 ? '↑' : delta < 0 ? '↓' : '→') + ' ' + Math.abs(delta) + ' 分' : '首次记录';

    var html = '';

    /* --- 主卡片 --- */
    html += '<section class="card">' +
      '<div class="card-head"><div class="card-title">' + icon('chart') + '最新估分</div>' +
      '<span class="badge ghost">' + esc(fullDate(latest.date)) + '</span></div>' +
      '<div class="hero">' +
      '<div class="ring">' +
      CH.ring({ value: latest.total, max: 710, size: 104, stroke: 9, color: 'var(--brand)', color2: 'var(--brand-2)', aria: '估分' }) +
      '<div class="ring-txt"><b>' + fmtInt(latest.total) + '</b><span>/ 710</span></div>' +
      '</div>' +
      '<div class="hero-main">' +
      '<div class="tone-bar wrap" style="margin-bottom:6px"><span class="tone-chip">' + esc(band.label) + '</span>' +
      '<span class="badge ' + (latest.passReached ? 'strong' : 'weak') + '">' + (latest.passReached ? '已达 425' : '未达 425') + '</span>' +
      (latest.zeroed ? '<span class="badge poor">≤220 记 0 分</span>' : '') + '</div>' +
      '<div class="hero-title">' + esc(band.tagline || '') + '</div>' +
      '<div class="hero-desc">常模百分位约 ' + latest.percentile + '% · 较上次 <span class="' + deltaTone + '" style="font-weight:700">' + esc(deltaTxt) + '</span></div>' +
      '<div style="margin-top:9px"><div class="track"><i style="width:' + tp.pct + '%"></i></div>' +
      '<div class="part-meta" style="display:flex;justify-content:space-between;margin-top:5px">' +
      '<span>目标 ' + tp.target + ' 分</span><span>' + (tp.reached ? '已达成 +' + (Math.round(latest.total) - tp.target) : '还差 ' + tp.gap) + '</span></div></div>' +
      '</div></div>' +
      '<div class="stat-grid" style="margin-top:14px">' +
      statCell('考试次数', String(trends.count), '共录入 ' + trends.count + ' 次', 'flat') +
      statCell('历史最高', String(fmtInt(trends.best.total)), esc(shortDate(trends.best.date)) + ' 取得', 'up') +
      statCell('平均分', String(Math.round(trends.avg)), '波动 ' + trends.volatility + ' 分', 'flat') +
      statCell('趋势斜率', (trends.slope > 0 ? '+' : '') + trends.slope, trends.improving ? '稳步提升' : trends.slope < -2 ? '有所回落' : '基本持平', trends.slope > 0 ? 'up' : trends.slope < 0 ? 'down' : 'flat') +
      '</div></section>';

    /* --- 板块得分 --- */
    var secRows = latest.sections.map(function (s) {
      return { label: s.label, value: s.report, max: s.reportMax, color: sectionColor(s.key), sub: '得分率 ' + s.rate + '%' };
    });
    html += '<section class="card">' +
      '<div class="card-head"><div class="card-title">' + icon('spark') + '各部分得分</div>' +
      '<span class="card-sub">满分 710</span></div>' +
      '<div class="chart-wrap" id="chartSections"></div>' +
      '</section>';

    /* --- 趋势 --- */
    html += '<section class="card">' +
      '<div class="card-head"><div class="card-title">' + icon('chart') + '成绩趋势</div>' +
      '<span class="card-sub">' + trends.count + ' 次记录</span></div>' +
      segHtml([{ key: 'total', label: '总分' }, { key: 'parts', label: '分项' }], state.chartMode, 'chart-mode') +
      '<div class="chart-wrap" id="chartTrend" style="margin-top:12px"></div>' +
      (state.chartMode === 'parts' ? legendHtml() : '') +
      '</section>';

    /* --- 结构堆叠 --- */
    html += '<section class="card">' +
      '<div class="card-head"><div class="card-title">' + icon('chart') + '成绩构成</div>' +
      '<span class="card-sub">最近 ' + Math.min(6, list.length) + ' 次</span></div>' +
      '<div class="chart-wrap" id="chartStack"></div>' +
      '<div class="legend">' + stackLegend() + '</div>' +
      '</section>';

    /* --- 最近记录 --- */
    html += '<section class="card flush">' +
      '<div class="card-head" style="padding:16px 16px 0"><div class="card-title">' + icon('clock') + '最近记录</div>' +
      '<button class="btn sm btn-ghost" data-act="tab" data-view="records">全部</button></div>' +
      list.slice(-3).reverse().map(recordRow).join('') +
      '</section>';

    /* --- 赋分依据 --- */
    html += formulaCard(latest);

    return html;
  }

  /* 赋分依据卡片：把「原始分 → 侧重与折算 → 报道分」讲清楚 */
  function formulaCard(latest) {
    var rowsHtml = M.SECTIONS.map(function (sec) {
      var s = latest.sections.filter(function (x) { return x.key === sec.key; })[0];
      return '<tr><td>' + esc(sec.short) + '</td>' +
        '<td>' + fmt1(s.raw) + '<span style="color:var(--muted)">/' + s.rawMax + '</span></td>' +
        '<td>' + sec.ratio + '%</td>' +
        '<td class="acc">' + fmt1(s.report) + '<span style="color:var(--muted)">/' + s.reportMax + '</span></td></tr>';
    }).join('');
    return '<section class="card">' +
      '<div class="card-head"><div class="card-title">' + icon('spark') + '赋分依据</div>' +
      '<span class="card-sub">原始分 → 报道分</span></div>' +
      '<table class="tbl">' +
      '<thead><tr><th>部分</th><th>原始分</th><th>占比</th><th>报道分</th></tr></thead>' +
      '<tbody>' + rowsHtml +
      '<tr style="border-top:1px solid var(--line)"><td style="font-weight:700">合计</td>' +
      '<td style="font-weight:700">' + fmt1(latest.rawTotal) + '<span style="color:var(--muted)">/100</span></td>' +
      '<td style="font-weight:700">100%</td>' +
      '<td class="acc" style="font-weight:800">' + fmt1(latest.total) + '<span style="color:var(--muted)">/710</span></td></tr>' +
      '</tbody></table>' +
      '<div class="note" style="margin-top:10px">' +
      '<b>折算方法</b>：原始分按官方分值比例加权为百分制（写作、翻译按 15 分制自评，恰等于其 15 点百分制），再乘以 7.1 得到 710 分制报道分。' +
      '官方报道分由常模转换产生（常模均值 500、标准差 70），因此本工具同时给出常模百分位作参考。</div>' +
      '<div class="note"><b>官方规则</b>：听力 35%、阅读 35%、写作 15%、翻译 15%；客观题共 55 题，仔细阅读与听力篇章每题约 14.2 分（最高）；总分 220 分及以下记为 0 分、不发放成绩报告单；425 分及以上视为达到「基本目标」。</div>' +
      '</section>';
  }

  function sectionColor(key) {
    return key === 'listening' ? 'var(--c-listening)' : key === 'reading' ? 'var(--c-reading)' :
      key === 'writing' ? 'var(--c-writing)' : 'var(--c-translation)';
  }

  function stackLegend() {
    return latestSectionsLegend();
  }
  function latestSectionsLegend() {
    return M.SECTIONS.map(function (s) {
      return '<span class="lg"><i style="background:' + sectionColor(s.key) + '"></i>' + esc(s.label) + '</span>';
    }).join('');
  }

  function legendHtml() {
    return '<div class="legend">' + M.SECTIONS.map(function (s) {
      return '<button type="button" data-act="series" data-key="' + s.key + '" aria-pressed="' + (state.seriesOn[s.key] !== false) + '">' +
        '<i style="background:' + sectionColor(s.key) + '"></i>' + esc(s.label) + '</button>';
    }).join('') + '</div>';
  }

  function recordRow(r) {
    return '<div class="rec">' +
      '<div class="rec-dot" style="background:' + (r.passReached ? 'var(--ok)' : 'var(--bad)') + '"></div>' +
      '<div class="rec-main">' +
      '<div class="rec-title">' + fmtInt(r.total) + ' 分 <span class="badge ghost">' + esc(bandLabel(r.bandKey)) + '</span></div>' +
      '<div class="rec-sub">' + esc(fullDate(r.date)) + (r.note ? ' · ' + esc(r.note) : '') + '</div>' +
      '<div class="rec-sub">听 ' + fmt1(r.sections[1].report) + ' / 读 ' + fmt1(r.sections[2].report) +
      ' / 写 ' + fmt1(r.sections[0].report) + ' / 译 ' + fmt1(r.sections[3].report) + '</div>' +
      '</div>' +
      '<button class="rec-del" data-act="delete" data-id="' + esc(r.id) + '" aria-label="删除记录">' + icon('trash') + '</button>' +
      '</div>';
  }

  /* ============================== 视图：录入 ============================== */

  function viewEntry() {
    var d = state.draft;
    var html = '';

    html += '<section class="card">' +
      '<div class="card-head"><div class="card-title">' + icon('edit') + '录入本次成绩</div>' +
      '<span class="badge ghost">第 ' + (state.records.length + 1) + ' 次</span></div>' +
      '<div class="note" style="margin-bottom:12px">选择录入方式：按<b>答对题数</b>录入最省事，系统按官方每题分值自动折算；已知报道分时可切换为按<b>报道分</b>直接录入。</div>' +
      segHtml([
        { key: 'items', label: '按答对题数' },
        { key: 'report', label: '按报道分' }
      ], d.mode, 'mode') +
      '</section>';

    /* 客观题 */
    M.SECTIONS.forEach(function (sec) {
      if (sec.kind !== 'objective') return;
      html += '<section class="card tone-' + sec.key + '">' +
        '<div class="card-head"><div class="card-title"><span class="tone-chip">' + esc(sec.label) + '</span>' +
        '<span class="card-sub">' + sec.parts.reduce(function (s, p) { return s + p.count; }, 0) + ' 题 · ' +
        sec.ratio + '% 分值 · ' + sec.reportMax + ' 分</span></div>' +
        '<span class="badge ghost" data-sec-out="' + sec.key + '">0 分</span></div>';

      sec.parts.forEach(function (part) {
        html += partRow(part, d);
      });
      html += '</section>';
    });

    /* 主观题 */
    ['writing', 'translation'].forEach(function (key) {
      var sec = M.SECTION_MAP[key];
      var val = Number(d.subjective[key]) || 0;
      var tier = M.tierOf(val);
      var cTier = ((C.tiers || {})[sec.tierType] || []).filter(function (t) { return t.key === tier.key; })[0];
      html += '<section class="card tone-' + key + '">' +
        '<div class="card-head"><div class="card-title"><span class="tone-chip">' + esc(sec.label) + '</span>' +
        '<span class="card-sub">15 分制 · ' + sec.ratio + '% 分值 · ' + sec.reportMax + ' 分</span></div>' +
        '<span class="badge ' + (val >= 10 ? 'strong' : val >= 7 ? 'ok' : 'weak') + '" data-tier-out="' + key + '">' + esc(tier.label) + '</span></div>' +
        '<div class="part-top" style="align-items:center">' +
        '<div class="part-meta">按 15 分制自评（官方五档总体印象评分）</div>' +
        '<div class="part-score"><b data-sub-out="' + key + '">' + val + '</b><span> / 15 · ≈ ' + fmt1(val * M.POINT) + ' 分</span></div>' +
        '</div>' +
        '<input class="range" type="range" min="0" max="15" step="1" value="' + val + '" data-range="' + key + '" ' +
        'style="--tone:var(--c-' + key + ');--fill:' + (val / 15 * 100) + '%" aria-label="' + esc(sec.label) + '自评分数">' +
        '<div class="chips" style="margin-top:8px">' +
        [0, 5, 8, 11, 14].map(function (v) {
          return '<button type="button" class="chip" data-act="sub-preset" data-key="' + key + '" data-val="' + v + '" aria-pressed="' + (val === v) + '">' + v + ' 分<small>' + M.tierOf(v).label + '</small></button>';
        }).join('') +
        '</div>' +
        '<div class="note" style="margin-top:10px" data-tier-desc="' + key + '">' + esc(cTier ? cTier.desc : '') + '</div>' +
        '<details class="acc"><summary>查看五档评分标准' + icon('chevron', 'caret') + '</summary>' +
        '<div class="acc-body"><table class="tbl"><tbody>' +
        ((C.tiers || {})[sec.tierType] || []).map(function (t) {
          return '<tr><td style="font-weight:700;white-space:nowrap">' + esc(t.label) + '</td><td style="text-align:left;color:var(--muted)">' + esc(t.desc) + '</td></tr>';
        }).join('') +
        '</tbody></table></div></details>' +
        '</section>';
    });

    /* 元信息 */
    html += '<section class="card">' +
      '<div class="card-head"><div class="card-title">' + icon('clock') + '录入时间与备注</div></div>' +
      '<div class="form-grid two">' +
      '<div class="field"><label for="inDate">考试 / 模考时间</label>' +
      '<input class="input" id="inDate" type="datetime-local" value="' + esc(d.date) + '" data-field="date"></div>' +
      '<div class="field"><label for="inNote">备注（可选）</label>' +
      '<input class="input" id="inNote" type="text" maxlength="30" placeholder="如：真题第 3 套、某机构模考" value="' + esc(d.note || '') + '" data-field="note"></div>' +
      '</div></section>';

    html += '<div class="btn-row">' +
      '<button class="btn btn-ghost" data-act="clear-draft">清空重填</button>' +
      '<button class="btn btn-primary" data-act="save">' + icon('check') + '保存并分析</button>' +
      '</div>';

    html += '<div id="previewRoot"></div>';
    return html;
  }

  function partRow(part, d) {
    var val = Number(d.parts[part.key]) || 0;
    var report = fmt1(val * part.perItem);
    var rate = part.count ? Math.round(val / part.count * 100) : 0;
    return '<div class="part tone-' + part.section + '" data-part-row="' + part.key + '">' +
      '<div class="part-top">' +
      '<div><div class="part-name">' + esc(part.label) +
      (part.perRatio >= 2 ? '<span class="badge weak">高分题</span>' : '') + '</div>' +
      '<div class="part-meta">共 ' + part.count + ' 题 · 每题 ' + part.perRatio + '% · ≈ ' + fmt1(part.perItem) + ' 分/题</div></div>' +
      '<div class="part-score"><b data-out-part="' + part.key + '">' + report + '</b><span> 分</span>' +
      '<div class="part-meta" style="margin-top:1px">原始 <i data-out-raw="' + part.key + '">' + fmt1(val * part.perRatio * 10) / 10 + '</i>/' + part.rawMax + '</div></div>' +
      '</div>' +
      '<div class="stepper">' +
      '<button class="step-btn" data-act="step" data-part="' + part.key + '" data-delta="-1" aria-label="减少">−</button>' +
      '<div class="step-val"><input type="number" inputmode="numeric" min="0" max="' + part.count + '" value="' + val +
      '" data-num="' + part.key + '" aria-label="' + esc(part.label) + '答对题数"><span class="of">/ ' + part.count + '</span></div>' +
      '<button class="step-btn" data-act="step" data-part="' + part.key + '" data-delta="1" aria-label="增加">+</button>' +
      '</div>' +
      '<div class="track thin" style="--tone:var(--c-' + part.section + ')"><i data-fill="' + part.key + '" style="width:' + rate + '%"></i></div>' +
      '</div>';
  }

  function previewHtml() {
    var r = draftResult();
    var band = A.bandContent(r.bandKey);
    var tp = A.targetProgress(r, state.target);
    var bars = r.sections.map(function (s) {
      return '<div class="pv-bar"><div class="lbl"><span>' + esc(s.short) + '</span><b>' + fmt1(s.report) + '</b></div>' +
        '<div class="t"><i style="width:' + fmt1(s.rate) + '%"></i></div></div>';
    }).join('');
    return '<div class="preview" id="preview">' +
      '<div class="preview-top">' +
      '<div><div class="pv-label">实时估分</div>' +
      '<div class="pv-score"><b>' + fmtInt(r.total) + '</b><span>/ 710</span></div>' +
      '<div class="pv-label" style="margin-top:3px;opacity:.75">原始分合计 ' + fmt1(r.rawTotal) + ' / 100</div></div>' +
      '<div class="pv-right"><div class="pv-badge">' + esc(band.label) + '</div>' +
      '<div class="pv-label" style="margin-top:5px">' + (tp.reached ? '已超目标 ' + (Math.round(r.total) - tp.target) + ' 分' : '距 ' + tp.target + ' 还差 ' + tp.gap + ' 分') + '</div></div>' +
      '</div>' +
      '<div class="pv-bars">' + bars + '</div>' +
      (r.zeroed ? '<div class="pv-label" style="margin-top:9px;opacity:.9">⚠ 总分 ≤ 220 分时官方记为 0 分</div>' : '') +
      '</div>';
  }

  function refreshPreview() {
    var root = $('#previewRoot');
    if (!root) return;
    root.innerHTML = previewHtml();
    updateEntryOutputs();
  }

  function updateEntryOutputs() {
    var r = draftResult();
    r.sections.forEach(function (sec) {
      var out = $('[data-sec-out="' + sec.key + '"]');
      if (out) out.textContent = fmt1(sec.report) + ' / ' + sec.reportMax;
      sec.parts.forEach(function (p) {
        var el = $('[data-out-part="' + p.key + '"]');
        if (el) el.textContent = fmt1(p.report);
        var raw = $('[data-out-raw="' + p.key + '"]');
        if (raw) raw.textContent = fmt1(p.raw);
        var fill = $('[data-fill="' + p.key + '"]');
        if (fill) fill.style.width = (p.count ? Math.round(p.correct / p.count * 100) : 0) + '%';
      });
    });
    ['writing', 'translation'].forEach(function (key) {
      var sec = r.sections.filter(function (s) { return s.key === key; })[0];
      var tierOut = $('[data-tier-out="' + key + '"]');
      if (tierOut) {
        tierOut.textContent = sec.tier.label;
        tierOut.className = 'badge ' + (sec.raw >= 10 ? 'strong' : sec.raw >= 7 ? 'ok' : 'weak');
      }
      var subOut = $('[data-sub-out="' + key + '"]');
      if (subOut) {
        subOut.textContent = sec.raw;
        var sib = subOut.parentNode.querySelector('span');
        if (sib) sib.textContent = ' / 15 · ≈ ' + fmt1(sec.report) + ' 分';
      }
      var desc = $('[data-tier-desc="' + key + '"]');
      if (desc) {
        var tierContent = ((C.tiers || {})[M.SECTION_MAP[key].tierType] || []).filter(function (t) { return t.key === sec.tier.key; })[0];
        desc.textContent = tierContent ? tierContent.desc : '';
      }
    });
  }

  /* ============================== 视图：分析 ============================== */

  function viewAnalysis() {
    var list = allResults();
    if (!list.length) return '<div class="card">' + emptyState() + '</div>';
    var latest = list[list.length - 1];
    var trends = M.trendStats(list);
    var an = A.analyze(latest, { target: state.target, trends: trends, weeks: state.weeks });
    var html = '';

    /* --- 结论 --- */
    html += '<section class="card">' +
      '<div class="card-head"><div class="card-title">' + icon('spark') + '综合诊断</div>' +
      '<button class="btn sm btn-ghost" data-act="copy-report">复制报告</button></div>' +
      '<div class="hero">' +
      '<div class="ring">' + CH.ring({ value: latest.total, max: 710, size: 96, stroke: 8, color: 'var(--brand)', color2: 'var(--brand-2)' }) +
      '<div class="ring-txt"><b>' + fmtInt(latest.total) + '</b><span>/ 710</span></div></div>' +
      '<div class="hero-main"><div class="hero-title">' + esc(an.band.tagline || an.band.label) + '</div>' +
      '<div class="hero-desc" style="margin-top:6px">' + esc(an.summary) + '</div></div>' +
      '</div>' +
      '<div class="note" style="margin-top:12px">' + esc(an.band.desc || '') + '</div>' +
      '</section>';

    /* --- 诊断条目 --- */
    html += '<section class="card"><div class="card-head"><div class="card-title">' + icon('target') + '关键发现</div>' +
      '<span class="card-sub">' + an.diagnoses.length + ' 条</span></div>' +
      '<div class="diag">' + an.diagnoses.map(function (d) {
        return '<div class="diag-item"><span class="di">' + d.icon + '</span><div><b>' + esc(d.title) + '</b><br>' + esc(d.text) + '</div></div>';
      }).join('') + '</div></section>';

    /* --- 目标与提分路径 --- */
    html += '<section class="card">' +
      '<div class="card-head"><div class="card-title">' + icon('arrow') + '提分路径</div>' +
      '<span class="card-sub">目标 ' + state.target + ' 分</span></div>' +
      '<div class="chips" style="margin-bottom:12px">' +
      [425, 450, 500, 550, 600].map(function (t) {
        return '<button class="chip" data-act="target" data-target="' + t + '" aria-pressed="' + (t === state.target) + '">' + t + ' 分</button>';
      }).join('') + '</div>' +
      (an.plan.needed > 0
        ? '<div class="plan-list">' + an.planSteps.map(function (s, i) {
          return '<div class="plan-item"><div class="plan-n">' + (i + 1) + '</div>' +
            '<div class="plan-main"><div class="plan-title">' + esc(s.title) + '</div><div class="plan-sub">' + esc(s.sub) + '</div></div>' +
            '<div class="plan-gain">' + esc(s.gain) + '</div></div>';
        }).join('') + '</div>' +
        '<div class="note" style="margin-top:10px">' + esc(an.plan.message) + '</div>'
        : '<div class="note">当前估分已超过 ' + state.target + ' 分目标，可把目标上调一档继续冲击。</div>') +
      '</section>';

    /* --- 各部分得分率 --- */
    var rows = an.rows.slice().sort(function (a, b) { return a.rate - b.rate; }).map(function (s) {
      return { label: s.label + ' ' + s.report, value: s.rate, max: 100, color: sectionColor(s.key), sub: '失分 ' + s.loss + ' 分 / 满分 ' + s.max };
    });
    html += '<section class="card"><div class="card-head"><div class="card-title">' + icon('chart') + '各部分得分率</div>' +
      '<span class="card-sub">单位 %</span></div><div class="chart-wrap" id="chartRate"></div>' +
      '<div class="note" style="margin-top:6px">得分率 = 该部分报道分 ÷ 该部分满分。越低的分项越值得优先投入。</div></section>';

    /* --- 题型明细 --- */
    html += '<section class="card"><div class="card-head"><div class="card-title">' + icon('list') + '题型明细</div>' +
      '<span class="card-sub">共 57 题 / 100%</span></div>';
    M.SECTIONS.forEach(function (sec) {
      if (sec.kind !== 'objective') return;
      html += '<div class="sec-title" style="margin-top:6px"><span class="tone-chip" style="--tone:' + sectionColor(sec.key) + '">' + esc(sec.label) + '</span></div>';
      sec.parts.forEach(function (part) {
        var p = an.parts.filter(function (x) { return x.key === part.key; })[0];
        var typeC = (((C.sections || {})[sec.key] || {}).types || {})[part.key] || {};
        html += '<div class="part" style="padding:10px 0">' +
          '<div class="part-top" style="align-items:center">' +
          '<div class="part-name">' + esc(part.label) + badge(p.status) + '</div>' +
          '<div class="part-score"><b>' + fmt1(p.report) + '</b><span> / ' + p.max + '</span></div>' +
          '</div>' +
          '<div class="part-meta">答对 ' + p.correct + '/' + p.count + '（' + p.accuracy + '%）· 每题 ' + fmt1(p.perItem) + ' 分 · 失分 ' + fmt1(p.loss) + '</div>' +
          '<div class="track thin" style="--tone:' + sectionColor(sec.key) + '"><i style="width:' + p.accuracy + '%"></i></div>' +
          (typeC.focus ? '<div class="note" style="margin-top:8px">' + esc(typeC.focus) + '</div>' : '') +
          '<details class="acc"><summary>这个题型怎么提' + icon('chevron', 'caret') + '</summary><div class="acc-body">' +
          '<ul class="advice">' +
          (p.accuracy < 72 ? (typeC.weak || []) : (typeC.strong || [])).concat(typeC.tips || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') +
          '</ul></div></details>' +
          '</div>';
      });
    });
    ['writing', 'translation'].forEach(function (key) {
      var sec = latest.sections.filter(function (s) { return s.key === key; })[0];
      var sc = (C.sections || {})[key] || {};
      html += '<details class="acc"><summary><span class="tone-chip" style="--tone:' + sectionColor(key) + '">' + esc(sec.label) + '</span>' +
        '<span style="margin-left:auto;font-weight:700">' + fmt1(sec.raw) + '/15 · ' + fmt1(sec.report) + ' 分</span>' + icon('chevron', 'caret') + '</summary>' +
        '<div class="acc-body"><div class="note">' + esc(sc.focus || '') + '</div><ul class="advice">' +
        (sec.raw < 10 ? (sc.weak || []) : (sc.strong || [])).concat(sc.tips || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') +
        '</ul></div></details>';
    });
    html += '</section>';

    /* --- 学习计划 --- */
    html += '<section class="card"><div class="card-head"><div class="card-title">' + icon('clock') + '学习计划</div>' +
      '<span class="card-sub">距考试可选</span></div>' +
      '<div class="chips">' +
      [['long', '10 周以上'], ['mid', '5~9 周'], ['short', '2~4 周'], ['sprint', '考前周']].map(function (x) {
        var active = state.planKey === x[0];
        return '<button class="chip" data-act="stage" data-stage="' + x[0] + '" aria-pressed="' + active + '">' + esc(x[1]) + '</button>';
      }).join('') + '</div>' +
      '<div id="stageBody" style="margin-top:12px"></div>' +
      '</section>';

    /* --- 建议动作 --- */
    html += '<section class="card"><div class="card-head"><div class="card-title">' + icon('check') + '现在就该做的事</div></div>' +
      '<ul class="advice">' + an.actions.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul>' +
      '</section>';

    return html;
  }

  function stageHtml(key) {
    var p = ((C.plans || {})[key]) || null;
    if (!p) return '<div class="note">暂无该阶段的计划模板。</div>';
    return '<div class="note" style="margin-bottom:10px"><b>' + esc(p.label) + '</b></div>' +
      '<div class="plan-list">' + (p.items || []).map(function (it, i) {
        return '<div class="plan-item"><div class="plan-n">' + (i + 1) + '</div>' +
          '<div class="plan-main"><div class="plan-title">' + esc(it.area) + ' · ' + esc(it.task) + '</div>' +
          '<div class="plan-sub">' + esc(it.freq || '') + '</div></div></div>';
      }).join('') + '</div>';
  }

  /* ============================== 视图：记录 ============================== */

  function viewRecords() {
    var list = allResults();
    if (!list.length) {
      return '<div class="card">' + emptyState() + '</div>';
    }
    var trends = M.trendStats(list);
    var html = '';

    html += '<section class="card"><div class="card-head"><div class="card-title">' + icon('list') + '全部记录</div>' +
      '<span class="card-sub">' + list.length + ' 次 · 平均 ' + Math.round(trends.avg) + ' 分</span></div>' +
      '<div style="overflow-x:auto;-webkit-overflow-scrolling:touch">' +
      '<table class="tbl" style="min-width:330px"><thead><tr>' +
      '<th>录入时间</th><th>听力</th><th>阅读</th><th>写作</th><th>翻译</th><th>总分</th></tr></thead><tbody>' +
      list.slice().reverse().map(function (r) {
        return '<tr><td style="white-space:nowrap">' + esc(fullDate(r.date)) + (r.note ? '<br><span style="color:var(--muted);font-size:11px">' + esc(r.note) + '</span>' : '') + '</td>' +
          '<td>' + fmt1(r.sections[1].report) + '</td><td>' + fmt1(r.sections[2].report) + '</td>' +
          '<td>' + fmt1(r.sections[0].report) + '</td><td>' + fmt1(r.sections[3].report) + '</td>' +
          '<td class="acc">' + fmtInt(r.total) + '</td></tr>';
      }).join('') +
      '</tbody></table></div></section>';

    html += '<section class="card"><div class="card-head"><div class="card-title">' + icon('chart') + '成绩构成对比</div>' +
      '<span class="card-sub">最近 ' + Math.min(8, list.length) + ' 次</span></div>' +
      '<div class="chart-wrap" id="chartStackAll"></div><div class="legend">' + latestSectionsLegend() + '</div></section>';

    html += '<section class="card flush"><div class="card-head" style="padding:16px 16px 0"><div class="card-title">' + icon('clock') + '管理</div></div>' +
      list.slice().reverse().map(function (r) {
        return '<div class="rec">' +
          '<div class="rec-dot" style="background:' + (r.passReached ? 'var(--ok)' : 'var(--bad)') + '"></div>' +
          '<div class="rec-main"><div class="rec-title">' + fmtInt(r.total) + ' 分 <span class="badge ghost">' + esc(bandLabel(r.bandKey)) + '</span></div>' +
          '<div class="rec-sub">' + esc(fullDate(r.date)) + (r.note ? ' · ' + esc(r.note) : '') + '</div></div>' +
          '<button class="btn sm btn-ghost" data-act="load" data-id="' + esc(r.id) + '">载入</button>' +
          '<button class="rec-del" data-act="delete" data-id="' + esc(r.id) + '" aria-label="删除">' + icon('trash') + '</button>' +
          '</div>';
      }).join('') +
      '</section>';

    html += '<section class="card"><div class="card-head"><div class="card-title">' + icon('download') + '数据备份</div></div>' +
      '<div class="note" style="margin-bottom:12px">记录保存在本机浏览器（localStorage），不上传服务器。换设备或清理浏览器前请先导出备份。</div>' +
      '<div class="btn-row" style="margin-bottom:10px">' +
      '<button class="btn btn-ghost" data-act="export">' + icon('download') + '导出 JSON</button>' +
      '<button class="btn btn-ghost" data-act="choose-import">' + icon('upload') + '导入备份</button></div>' +
      '<input type="file" id="fileImport" accept="application/json,.json" hidden>' +
      '<button class="btn btn-ghost btn-block" data-act="wipe" style="color:var(--bad)">清空全部记录</button>' +
      '</section>';

    return html;
  }

  /* ============================== 空状态 ============================== */

  function emptyState() {
    return '<div class="empty">' +
      '<div class="em-ico">' + icon('chart') + '</div>' +
      '<h3>还没有成绩记录</h3>' +
      '<p>录入一次四级模考或真题成绩，系统会按官方分值结构折算 710 分制报道分，并生成趋势图与针对性分析。</p>' +
      '<div class="btn-row" style="margin-top:16px;max-width:340px;margin-left:auto;margin-right:auto">' +
      '<button class="btn btn-ghost" data-act="demo">载入示例</button>' +
      '<button class="btn btn-primary" data-act="tab" data-view="entry">开始录入</button>' +
      '</div></div>';
  }

  /* ============================== 渲染主流程 ============================== */

  function renderTopbar() {
    var list = allResults();
    var latest = list.length ? list[list.length - 1] : null;
    var meta = $('#topbarMeta');
    if (!meta) return;
    if (latest) {
      meta.innerHTML = '<span class="pill big ' + (latest.passReached ? 'pass' : 'fail') + '"><i class="dot"></i>' +
        fmtInt(latest.total) + ' 分</span>' +
        '<span class="pill">目标 ' + state.target + '</span>';
    } else {
      meta.innerHTML = '<span class="pill">目标 ' + state.target + '</span>';
    }
  }

  function renderTabbar() {
    $$('#tabbar .tab').forEach(function (b) {
      b.setAttribute('aria-selected', String(b.getAttribute('data-view') === state.view));
    });
  }

  function renderView() {
    var view = $('#view');
    chartTasks = [];
    var html = state.view === 'home' ? viewHome()
      : state.view === 'entry' ? viewEntry()
        : state.view === 'analysis' ? viewAnalysis()
          : viewRecords();
    view.className = 'view' + (state.view === 'entry' ? ' has-preview' : '');
    view.innerHTML = html;
    renderTopbar();
    renderTabbar();

    if (state.view === 'home') afterHome();
    if (state.view === 'entry') afterEntry();
    if (state.view === 'analysis') afterAnalysis();
    if (state.view === 'records') afterRecords();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function afterHome() {
    var list = allResults();
    if (!list.length) return;
    var latest = list[list.length - 1];
    var trends = M.trendStats(list);

    mountChart($('#chartSections'), function (w) {
      return CH.hbars({ width: w, rows: latest.sections.map(function (s) {
        return { label: s.short, value: s.report, max: s.reportMax, color: sectionColor(s.key), sub: '得分率 ' + s.rate + '%' };
      }), rowH: 30, labelW: 46, rightW: 52, unit: '' });
    });

    mountChart($('#chartTrend'), function (w) {
      var marks = [{ value: 425, label: '425 基本目标', color: '#f59e0b' }];
      if (state.target !== 425) marks.push({ value: state.target, label: '目标 ' + state.target, color: '#ef4444' });
      if (state.chartMode === 'total') {
        return CH.lineChart({
          width: w, height: 210,
          labels: list.map(function (r) { return shortDate(r.date); }),
          series: [{ key: 'total', name: '总分', color: 'var(--brand)', values: list.map(function (r) { return r.total; }) }],
          marks: marks,
          yMin: 0, yMax: 710, unit: ' 分', aria: '总分趋势'
        });
      }
      return CH.lineChart({
        width: w, height: 230,
        labels: list.map(function (r) { return shortDate(r.date); }),
        series: M.SECTIONS.map(function (s, i) {
          return {
            key: s.key, name: s.label, color: sectionColor(s.key),
            values: list.map(function (r) { return r.sections[i].report; }),
            visible: state.seriesOn[s.key] !== false
          };
        }),
        yMin: 0, yMax: 250, unit: ' 分', area: false, showLast: false, aria: '分项趋势'
      });
    });

    mountChart($('#chartStack'), function (w) {
      return CH.stackedBar({
        width: w, height: 200,
        items: list.slice(-6).map(function (r) {
          return {
            label: shortDate(r.date), total: r.total,
            parts: r.sections.map(function (s) { return { value: s.report, color: sectionColor(s.key), label: s.label }; })
          };
        }),
        max: 710, aria: '成绩构成'
      });
    });

    CH.bindTooltips($('#view'));
  }

  function afterEntry() {
    refreshPreview();
  }

  function afterAnalysis() {
    var list = allResults();
    if (!list.length) return;
    var latest = list[list.length - 1];
    var an = A.analyze(latest, { target: state.target, trends: M.trendStats(list), weeks: state.weeks });

    mountChart($('#chartRate'), function (w) {
      var rows = an.rows.slice().sort(function (a, b) { return a.rate - b.rate; }).map(function (s) {
        return { label: s.short, value: s.rate, max: 100, color: sectionColor(s.key), sub: '失分 ' + s.loss + ' 分 / 满分 ' + s.max };
      });
      return CH.hbars({ width: w, rows: rows, rowH: 32, labelW: 46, rightW: 44, unit: '%' });
    });

    if (!state.planKey) {
      state.planKey = state.weeks == null ? 'mid' : (state.weeks >= 10 ? 'long' : state.weeks >= 5 ? 'mid' : state.weeks >= 2 ? 'short' : 'sprint');
    }
    $('#stageBody').innerHTML = stageHtml(state.planKey);
    CH.bindTooltips($('#view'));
  }

  function afterRecords() {
    var list = allResults();
    if (!list.length) return;
    mountChart($('#chartStackAll'), function (w) {
      return CH.stackedBar({
        width: w, height: 220,
        items: list.slice(-8).map(function (r) {
          return {
            label: shortDate(r.date), total: r.total,
            parts: r.sections.map(function (s) { return { value: s.report, color: sectionColor(s.key), label: s.label }; })
          };
        }),
        max: 710, aria: '成绩构成对比'
      });
    });
    CH.bindTooltips($('#view'));
  }

  /* ============================== 交互 ============================== */

  var toastTimer = null;
  function toast(msg) {
    var t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 1900);
  }

  var tooltipBoundOn = null;
  function ensureTooltips() {
    var view = $('#view');
    if (tooltipBoundOn === view) return;
    CH.bindTooltips(view);
    tooltipBoundOn = view;
  }

  function setNum(partKey, value) {
    var part = M.PART_MAP[partKey];
    if (!part) return;
    state.draft.parts[partKey] = M.clampInt(value, 0, part.count);
    var input = $('[data-num="' + partKey + '"]');
    if (input && String(input.value) !== String(state.draft.parts[partKey])) input.value = state.draft.parts[partKey];
    persist();
    refreshPreview();
  }

  function saveRecord() {
    var d = state.draft;
    var r = draftResult();
    var rec = {
      id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      ts: d.date ? new Date(d.date).toISOString() : new Date().toISOString(),
      mode: d.mode,
      parts: JSON.parse(JSON.stringify(d.parts)),
      subjective: JSON.parse(JSON.stringify(d.subjective)),
      report: JSON.parse(JSON.stringify(d.report)),
      note: (d.note || '').slice(0, 30)
    };
    if (isNaN(new Date(rec.ts).getTime())) rec.ts = new Date().toISOString();
    state.records.push(rec);
    state.records.sort(function (a, b) { return new Date(a.ts) - new Date(b.ts); });
    persist();
    toast('已保存：' + fmtInt(r.total) + ' 分');
    state.view = 'analysis';
    renderView();
  }

  function loadDemo() {
    var demo = [
      { daysAgo: 26, parts: { news: 3, longconv: 4, passage: 4, banked: 4, matching: 5, careful: 4 }, sub: { writing: 7, translation: 7 }, note: '真题第 1 套' },
      { daysAgo: 18, parts: { news: 4, longconv: 5, passage: 5, banked: 5, matching: 6, careful: 5 }, sub: { writing: 8, translation: 8 }, note: '真题第 2 套' },
      { daysAgo: 10, parts: { news: 5, longconv: 6, passage: 6, banked: 6, matching: 7, careful: 6 }, sub: { writing: 9, translation: 8 }, note: '真题第 3 套' },
      { daysAgo: 3, parts: { news: 6, longconv: 7, passage: 7, banked: 6, matching: 8, careful: 7 }, sub: { writing: 10, translation: 9 }, note: '模拟考' }
    ];
    demo.forEach(function (x, i) {
      var d = new Date();
      d.setDate(d.getDate() - x.daysAgo);
      d.setHours(20, 30, 0, 0);
      state.records.push({
        id: 'demo' + i + Date.now().toString(36),
        ts: d.toISOString(),
        mode: 'items',
        parts: x.parts,
        subjective: x.sub,
        report: { listening: 0, reading: 0, writing: 0, translation: 0 },
        note: x.note
      });
    });
    state.records.sort(function (a, b) { return new Date(a.ts) - new Date(b.ts); });
    state.draft = blankDraft();
    persist();
    toast('已载入 4 条示例记录');
    renderView();
  }

  function download(filename, text) {
    var blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 400);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('报告已复制到剪贴板'); }, function () { fallbackCopy(text); });
    } else fallbackCopy(text);
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('报告已复制到剪贴板'); } catch (e) { toast('复制失败，请手动选择'); }
    ta.remove();
  }

  function onViewClick(e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var act = btn.getAttribute('data-act');

    if (act === 'tab') {
      state.view = btn.getAttribute('data-view');
      renderView();
      return;
    }
    if (act === 'step') {
      var pk = btn.getAttribute('data-part');
      var dv = Number(btn.getAttribute('data-delta'));
      setNum(pk, (Number(state.draft.parts[pk]) || 0) + dv);
      return;
    }
    if (act === 'mode') {
      state.draft.mode = btn.getAttribute('data-mode');
      persist();
      renderView();
      return;
    }
    if (act === 'sub-preset') {
      var sk = btn.getAttribute('data-key');
      state.draft.subjective[sk] = Number(btn.getAttribute('data-val'));
      var rg = $('[data-range="' + sk + '"]');
      if (rg) { rg.value = state.draft.subjective[sk]; rg.style.setProperty('--fill', (state.draft.subjective[sk] / 15 * 100) + '%'); }
      $$('.chip[data-act="sub-preset"][data-key="' + sk + '"]').forEach(function (c) {
        c.setAttribute('aria-pressed', String(Number(c.getAttribute('data-val')) === state.draft.subjective[sk]));
      });
      persist();
      refreshPreview();
      return;
    }
    if (act === 'save') { saveRecord(); return; }
    if (act === 'clear-draft') {
      state.draft = blankDraft();
      persist();
      renderView();
      toast('已清空录入内容');
      return;
    }
    if (act === 'delete') {
      var id = btn.getAttribute('data-id');
      var idx = state.records.findIndex(function (r) { return r.id === id; });
      if (idx >= 0) {
        state.records.splice(idx, 1);
        persist();
        renderView();
        toast('已删除该条记录');
      }
      return;
    }
    if (act === 'load') {
      var rec = state.records.filter(function (r) { return r.id === btn.getAttribute('data-id'); })[0];
      if (rec) {
        state.draft = {
          mode: rec.mode,
          parts: Object.assign({}, rec.parts),
          subjective: Object.assign({}, rec.subjective),
          report: Object.assign({}, rec.report),
          date: (function () {
            var d = new Date(rec.ts);
            d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
            return d.toISOString().slice(0, 16);
          })(),
          note: rec.note || ''
        };
        persist();
        state.view = 'entry';
        renderView();
        toast('已载入到录入页，可修改后重新保存');
      }
      return;
    }
    if (act === 'target') {
      state.target = Number(btn.getAttribute('data-target'));
      persist();
      $$('.chip[data-act="target"]').forEach(function (c) {
        c.setAttribute('aria-pressed', String(Number(c.getAttribute('data-target')) === state.target));
      });
      renderTopbar();
      renderView();
      return;
    }
    if (act === 'stage') {
      state.planKey = btn.getAttribute('data-stage');
      $$('.chip[data-act="stage"]').forEach(function (c) {
        c.setAttribute('aria-pressed', String(c.getAttribute('data-stage') === state.planKey));
      });
      $('#stageBody').innerHTML = stageHtml(state.planKey);
      return;
    }
    if (act === 'chart-mode') {
      state.chartMode = btn.getAttribute('data-chart-mode');
      renderView();
      return;
    }
    if (act === 'series') {
      var k = btn.getAttribute('data-key');
      state.seriesOn[k] = state.seriesOn[k] === false;
      btn.setAttribute('aria-pressed', String(state.seriesOn[k] !== false));
      var list = allResults();
      var legendEl = btn.parentNode;
      renderView();
      return;
    }
    if (act === 'demo') { loadDemo(); return; }
    if (act === 'export') {
      download('cet4-score-backup-' + new Date().toISOString().slice(0, 10) + '.json',
        JSON.stringify({ v: 1, target: state.target, records: state.records }, null, 2));
      toast('已导出备份文件');
      return;
    }
    if (act === 'choose-import') {
      var fi = $('#fileImport');
      if (fi) fi.click();
      return;
    }
    if (act === 'wipe') {
      if (!window.confirm('确定清空全部成绩记录？此操作不可恢复。')) return;
      state.records = [];
      persist();
      state.view = 'home';
      renderView();
      toast('已清空全部记录');
      return;
    }
    if (act === 'copy-report') {
      var l = allResults();
      if (!l.length) return;
      var latest = l[l.length - 1];
      var an = A.analyze(latest, { target: state.target, trends: M.trendStats(l), weeks: state.weeks });
      copyText(A.toText(latest, an, C));
      return;
    }
  }

  function onViewInput(e) {
    var t = e.target;
    if (t.matches('[data-num]')) {
      var pk = t.getAttribute('data-num');
      var part = M.PART_MAP[pk];
      var v = M.clampInt(t.value === '' ? 0 : t.value, 0, part.count);
      state.draft.parts[pk] = v;
      persist();
      refreshPreview();
      return;
    }
    if (t.matches('[data-range]')) {
      var sk = t.getAttribute('data-range');
      var val = M.clampInt(t.value, 0, 15);
      state.draft.subjective[sk] = val;
      t.style.setProperty('--fill', (val / 15 * 100) + '%');
      $$('.chip[data-act="sub-preset"][data-key="' + sk + '"]').forEach(function (c) {
        c.setAttribute('aria-pressed', String(Number(c.getAttribute('data-val')) === val));
      });
      persist();
      refreshPreview();
      return;
    }
    if (t.matches('[data-field="date"]')) { state.draft.date = t.value; persist(); return; }
    if (t.matches('[data-field="note"]')) { state.draft.note = t.value; persist(); return; }
  }

  function onViewChange(e) {
    var t = e.target;
    if (t.matches('[data-num]')) {
      var pk = t.getAttribute('data-num');
      var part = M.PART_MAP[pk];
      var v = M.clampInt(t.value, 0, part.count);
      t.value = v;
      state.draft.parts[pk] = v;
      persist();
      refreshPreview();
    }
  }

  function importFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(String(reader.result));
        var recs = data.records || data;
        if (!Array.isArray(recs)) throw new Error('格式不正确');
        var added = 0;
        recs.forEach(function (r) {
          if (!r || !r.ts || !r.parts) return;
          var exist = state.records.some(function (x) { return x.ts === r.ts && Math.abs(recordResult(x).total - recordResult({ ts: r.ts, mode: r.mode || 'items', parts: r.parts, subjective: r.subjective || {}, report: r.report || {} }).total) < 0.5; });
          if (exist) return;
          state.records.push({
            id: 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            ts: r.ts,
            mode: r.mode === 'report' ? 'report' : 'items',
            parts: Object.assign({}, r.parts),
            subjective: Object.assign({}, r.subjective),
            report: Object.assign({}, r.report),
            note: r.note || ''
          });
          added++;
        });
        if (isFinite(data.target)) state.target = data.target;
        state.records.sort(function (a, b) { return new Date(a.ts) - new Date(b.ts); });
        persist();
        renderView();
        toast(added ? '已导入 ' + added + ' 条记录' : '没有可导入的新记录');
      } catch (err) {
        toast('导入失败：文件格式不正确');
      }
    };
    reader.readAsText(file);
  }

  /* ============================== 初始化 ============================== */

  function init() {
    load();
    if (!state.draft) state.draft = blankDraft();
    if (!state.draft.date) state.draft.date = nowLocalInput();

    /* 事件委托挂在 document 上：#tabbar 在 #view 之外，切页时 #view 会重建 */
    document.addEventListener('click', onViewClick);
    document.addEventListener('input', onViewInput);
    document.addEventListener('change', onViewChange);
    document.addEventListener('change', function (e) {
      if (e.target && e.target.id === 'fileImport' && e.target.files && e.target.files[0]) {
        importFile(e.target.files[0]);
        e.target.value = '';
      }
    });

    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', function () { setTimeout(onResize, 260); });
    window.addEventListener('scroll', function () {
      var tb = $('#topbar');
      if (tb) tb.classList.toggle('is-scrolled', window.scrollY > 4);
    }, { passive: true });

    renderView();
    ensureTooltips();

    // 键盘快捷键：1~4 切换视图（桌面端）
    document.addEventListener('keydown', function (e) {
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      var map = { '1': 'home', '2': 'entry', '3': 'analysis', '4': 'records' };
      if (map[e.key]) { state.view = map[e.key]; renderView(); }
    });

    // 每天首次打开提示保存
    window.__CET4_APP__ = { state: state, render: renderView, model: M };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
