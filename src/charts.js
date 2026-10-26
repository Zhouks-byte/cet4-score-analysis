/*!
 * charts.js — 纯手写 SVG 图表（无第三方依赖）
 * lineChart / stackedBar / hbars / ring / tooltips
 * 所有函数返回 SVG 字符串；宽度由调用方按容器实测传入（1 用户单位 = 1 CSS px）。
 */
(function (root) {
  'use strict';

  var ICON_FONT = 'font-family="inherit"';

  function n(v, d) {
    var p = Math.pow(10, d == null ? 1 : d);
    return Math.round((Number(v) || 0) * p) / p;
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  /** 平滑曲线（Catmull-Rom → 三次贝塞尔），并限制在绘图区内 */
  function smoothPath(pts, lo, hi) {
    if (pts.length < 2) return '';
    if (pts.length === 2) return 'M' + n(pts[0].x) + ',' + n(pts[0].y) + ' L' + n(pts[1].x) + ',' + n(pts[1].y);
    var d = 'M' + n(pts[0].x) + ',' + n(pts[0].y);
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      var t = 0.2;
      var c1x = p1.x + (p2.x - p0.x) * t;
      var c1y = clamp(p1.y + (p2.y - p0.y) * t, lo, hi);
      var c2x = p2.x - (p3.x - p1.x) * t;
      var c2y = clamp(p2.y - (p3.y - p1.y) * t, lo, hi);
      d += ' C' + n(c1x) + ',' + n(c1y) + ' ' + n(c2x) + ',' + n(c2y) + ' ' + n(p2.x) + ',' + n(p2.y);
    }
    return d;
  }

  /**
   * 折线图
   * @param {Object} o
   *  width, height, labels[], series[{key,name,color,values[],visible}],
   *  yMin, yMax, unit, marks[{value,label,color}], showLast, area
   */
  function lineChart(o) {
    var W = Math.max(240, o.width || 340);
    var H = o.height || 200;
    var unit = o.unit || '分';
    var labels = o.labels || [];
    var series = (o.series || []).filter(function (s) { return s.visible !== false; });
    var nPts = labels.length;
    var pad = { l: 38, r: 16, t: 18, b: 30 };
    var iw = W - pad.l - pad.r;
    var ih = H - pad.t - pad.b;

    if (!nPts || !series.length) {
      return '<div class="chart-empty">暂无数据，录入成绩后自动生成</div>';
    }

    var allVals = [];
    series.forEach(function (s) {
      (s.values || []).forEach(function (v) { if (isFinite(v)) allVals.push(v); });
    });
    (o.marks || []).forEach(function (m) { if (isFinite(m.value)) allVals.push(m.value); });

    var lo = o.yMin, hi = o.yMax;
    if (lo == null || hi == null) {
      var mn = Math.min.apply(null, allVals);
      var mx = Math.max.apply(null, allVals);
      var span = Math.max(40, mx - mn);
      var step = niceStep(span / 3);
      lo = Math.max(0, Math.floor((mn - span * 0.18) / step) * step);
      hi = Math.min(o.floorMax == null ? 100 : o.floorMax, Math.ceil((mx + span * 0.22) / step) * step);
      if (hi - lo < step * 2) hi = lo + step * 2;
    }

    var xAt = function (i) { return nPts === 1 ? n(pad.l + iw / 2) : n(pad.l + iw * i / (nPts - 1)); };
    var yAt = function (v) { return n(pad.t + ih - (clamp(v, lo, hi) - lo) / (hi - lo) * ih); };

    var ticks = 4;
    var grid = '';
    for (var g = 0; g <= ticks; g++) {
      var vv = lo + (hi - lo) * g / ticks;
      var yy = yAt(vv);
      grid += '<line x1="' + pad.l + '" y1="' + n(yy) + '" x2="' + n(W - pad.r) + '" y2="' + n(yy) +
        '" stroke="currentColor" stroke-opacity="' + (g === 0 ? '.22' : '.09') + '" stroke-width="1"/>';
      grid += '<text x="' + (pad.l - 7) + '" y="' + n(yy + 3.4) + '" text-anchor="end" font-size="9.5" fill="currentColor" fill-opacity=".52">' +
        n(vv, vv >= 100 ? 1 : 1) + '</text>';
    }

    // 参考线（425 基本目标等）：标签过近时上下错开，避免互相压字
    var marks = '';
    var drawn = [];
    (o.marks || []).forEach(function (m) {
      if (!isFinite(m.value) || m.value < lo || m.value > hi) return;
      var my = yAt(m.value);
      var dir = 1;
      for (var k = 0; k < drawn.length; k++) {
        if (Math.abs(drawn[k] - my) < 18) dir = drawn[k] > my ? -1 : 1;
      }
      var labelY = my + (dir > 0 ? -2 : 11);
      var anchorX = pad.l + 4;
      drawn.push(my);
      marks += '<line x1="' + pad.l + '" y1="' + n(my) + '" x2="' + n(W - pad.r) + '" y2="' + n(my) +
        '" stroke="' + (m.color || '#ef4444') + '" stroke-width="1.4" stroke-dasharray="5 4" stroke-opacity=".75"/>';
      marks += '<rect x="' + anchorX + '" y="' + n(labelY - 7.5) + '" width="' + (m.label.length * 6.2 + 10) + '" height="14" rx="7" fill="' +
        (m.color || '#ef4444') + '" fill-opacity=".14"/>';
      marks += '<text x="' + (anchorX + 5) + '" y="' + n(labelY + 3.4) + '" font-size="9.5" font-weight="600" fill="' +
        (m.color || '#ef4444') + '">' + esc(m.label) + '</text>';
    });

    // X 轴标签
    var axis = '';
    var every = Math.max(1, Math.ceil(nPts / Math.max(3, Math.floor(iw / 44))));
    labels.forEach(function (lb, i) {
      if (i % every !== 0 && i !== nPts - 1) return;
      axis += '<text x="' + xAt(i) + '" y="' + (H - pad.b + 15) + '" text-anchor="middle" font-size="9.5" fill="currentColor" fill-opacity=".55">' +
        esc(lb) + '</text>';
    });

    // 系列
    var paths = '';
    series.forEach(function (s, si) {
      var vals = s.values || [];
      var pts = [];
      for (var i = 0; i < vals.length; i++) {
        if (vals[i] == null || !isFinite(vals[i])) continue;
        pts.push({ x: xAt(i), y: yAt(vals[i]), v: vals[i], i: i });
      }
      if (!pts.length) return;
      var d = smoothPath(pts, pad.t, pad.t + ih);
      if (o.area !== false && series.length === 1) {
        var gid = 'lg' + si + '_' + Math.random().toString(36).slice(2, 7);
        paths += '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="' + s.color + '" stop-opacity=".22"/>' +
          '<stop offset="100%" stop-color="' + s.color + '" stop-opacity="0"/></linearGradient></defs>' +
          '<path d="' + d + ' L' + n(pts[pts.length - 1].x) + ',' + n(pad.t + ih) + ' L' + n(pts[0].x) + ',' + n(pad.t + ih) + ' Z" fill="url(#' + gid + ')"/>';
      }
      paths += '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="' + (series.length > 1 ? 2 : 2.6) +
        '" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="' + (s.faded ? '.45' : '.95') + '"/>';
      pts.forEach(function (p, k) {
        var last = k === pts.length - 1;
        paths += '<circle cx="' + n(p.x) + '" cy="' + n(p.y) + '" r="' + (last && series.length === 1 ? 4.4 : 3.2) + '" fill="' +
          (s.color) + '" stroke="var(--card)" stroke-width="1.6"/>';
        if (last && series.length === 1 && o.showLast !== false) {
          var txt = n(p.v, p.v >= 100 ? 1 : 1);
          var tx = clamp(p.x, pad.l + 14, W - pad.r - 16);
          paths += '<text x="' + n(tx) + '" y="' + n(p.y - 11) + '" text-anchor="middle" font-size="11" font-weight="700" fill="' + s.color + '">' + txt + '</text>';
        }
      });
      pts.forEach(function (p) {
        var tip = s.tipPrefix ? s.tipPrefix + ' ' : '';
        paths += '<circle class="hit" cx="' + n(p.x) + '" cy="' + n(p.y) + '" r="13" fill="transparent" data-tip="' +
          esc('<b>' + tip + n(p.v, 1) + unit + '</b><br>' + (labels[p.i] || '')) + '"/>';
      });
    });

    return '<svg viewBox="0 0 ' + n(W) + ' ' + n(H) + '" width="100%" height="' + n(H) + '" role="img" aria-label="' + esc(o.aria || '趋势折线图') + '" style="color:var(--ink)">' +
      grid + marks + axis + paths + '</svg>';
  }

  function niceStep(x) {
    if (!isFinite(x) || x <= 0) return 10;
    var exp = Math.floor(Math.log(x) / Math.LN10);
    var f = x / Math.pow(10, exp);
    var nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return nf * Math.pow(10, exp);
  }

  /**
   * 堆叠柱状图（每次考试的分数构成）
   * o: { width, height, items:[{label, total, parts:[{value,color,label}]}], series[], max }
   */
  function stackedBar(o) {
    var W = Math.max(240, o.width || 340);
    var H = o.height || 220;
    var items = o.items || [];
    var series = o.series || [];
    var max = o.max || 710;
    var pad = { l: 34, r: 12, t: 22, b: 30 };
    var iw = W - pad.l - pad.r;
    var ih = H - pad.t - pad.b;

    if (!items.length) return '<div class="chart-empty">暂无数据，录入成绩后自动生成</div>';

    var yAt = function (v) { return n(pad.t + ih - clamp(v, 0, max) / max * ih); };
    var grid = '';
    for (var g = 0; g <= 4; g++) {
      var vv = max * g / 4;
      var yy = yAt(vv);
      grid += '<line x1="' + pad.l + '" y1="' + n(yy) + '" x2="' + n(W - pad.r) + '" y2="' + n(yy) +
        '" stroke="currentColor" stroke-opacity="' + (g === 0 ? '.22' : '.08') + '" stroke-width="1"/>' +
        '<text x="' + (pad.l - 6) + '" y="' + n(yy + 3.4) + '" text-anchor="end" font-size="9" fill="currentColor" fill-opacity=".5">' +
        n(vv, 0) + '</text>';
    }

    var slot = iw / Math.max(items.length, 1);
    var bw = clamp(slot * 0.52, 8, 52);
    var bars = '';
    items.forEach(function (it, i) {
      var cx = n(pad.l + slot * i + slot / 2);
      var x = cx - bw / 2;
      var base = pad.t + ih;
      var acc = 0;
      (it.parts || []).forEach(function (p, si) {
        if (!p.value) return;
        var y0 = yAt(acc);
        var y1 = yAt(acc + p.value);
        var h = Math.max(0, y0 - y1);
        acc += p.value;
        var isTop = si === (it.parts.length - 1);
        bars += '<rect x="' + n(x) + '" y="' + n(y1) + '" width="' + n(bw) + '" height="' + n(h) +
          '" fill="' + p.color + '" rx="' + (isTop ? 3 : 0) + '" fill-opacity=".92" data-tip="' +
          esc('<b>' + (p.label || '') + ' ' + n(p.value, 1) + ' 分</b><br>' + it.label) + '"/>';
      });
      // 顶部总分
      if (items.length <= 9 || i % 2 === 0) {
        bars += '<text x="' + cx + '" y="' + n(yAt(it.total) - 6) + '" text-anchor="middle" font-size="10" font-weight="700" fill="currentColor" fill-opacity=".82">' +
          n(it.total, 0) + '</text>';
      }
      // 底部时间
      if (items.length <= 8 || i % 2 === 0) {
        bars += '<text x="' + cx + '" y="' + (H - pad.b + 15) + '" text-anchor="middle" font-size="9" fill="currentColor" fill-opacity=".55">' +
          esc(it.label) + '</text>';
      }
      bars += '<rect x="' + n(cx - slot / 2 + 1) + '" y="' + pad.t + '" width="' + n(slot - 2) + '" height="' + ih +
        '" fill="transparent" data-tip="' + esc('<b>' + n(it.total, 1) + ' 分</b><br>' + it.label + '<br>' +
          (it.parts || []).map(function (p) { return p.label + ' ' + n(p.value, 1); }).join(' · ')) + '"/>';
    });

    return '<svg viewBox="0 0 ' + n(W) + ' ' + n(H) + '" width="100%" height="' + n(H) + '" role="img" aria-label="' +
      esc(o.aria || '各次成绩柱状图') + '" style="color:var(--ink)">' + grid + bars + '</svg>';
  }

  /**
   * 水平条形图
   * o: { width, rows:[{label, value, max, color, suffix, sub}], rowH, labelW, unit }
   */
  function hbars(o) {
    var W = Math.max(240, o.width || 340);
    var rows = o.rows || [];
    var rowH = o.rowH || 29;
    var labelW = o.labelW || 0;
    var unit = o.unit == null ? '分' : o.unit;
    var padT = 4, padB = 4;
    var H = padT + padB + rowH * rows.length;
    if (!rows.length) return '<div class="chart-empty">暂无数据</div>';

    var rightW = o.rightW || 44;
    var trackX = labelW;
    var trackW = W - labelW - rightW - 6;

    var out = '';
    rows.forEach(function (r, i) {
      var y = padT + i * rowH;
      var cy = y + rowH / 2;
      var pct = clamp((r.value || 0) / (r.max || 1), 0, 1);
      var bh = Math.min(13, rowH - 12);
      if (labelW) {
        out += '<text x="0" y="' + n(cy + 3.4) + '" font-size="10.5" fill="currentColor" fill-opacity=".62">' + esc(r.label) + '</text>';
      }
      out += '<rect x="' + trackX + '" y="' + n(cy - bh / 2) + '" width="' + n(trackW) + '" height="' + n(bh) +
        '" rx="' + n(bh / 2) + '" fill="currentColor" fill-opacity=".08"/>';
      out += '<rect x="' + trackX + '" y="' + n(cy - bh / 2) + '" width="' + n(Math.max(pct * trackW, bh)) + '" height="' + n(bh) +
        '" rx="' + n(bh / 2) + '" fill="' + (r.color || 'var(--brand)') + '"/>';
      out += '<text x="' + n(W - 2) + '" y="' + n(cy + 3.4) + '" text-anchor="end" font-size="10.5" font-weight="650" fill="currentColor" fill-opacity=".8">' +
        n(r.value, 1) + (unit || '') + '</text>';
      out += '<rect x="0" y="' + y + '" width="' + n(W) + '" height="' + rowH + '" fill="transparent" data-tip="' +
        esc('<b>' + r.label + '</b><br>' + n(r.value, 1) + unit + (r.max ? ' / ' + n(r.max, 1) + unit : '') +
          (r.sub ? '<br>' + r.sub : '')) + '"/>';
    });

    return '<svg viewBox="0 0 ' + n(W) + ' ' + n(H) + '" width="100%" height="' + n(H) + '" role="img" aria-label="' +
      esc(o.aria || '得分明细条形图') + '" style="color:var(--ink)">' + out + '</svg>';
  }

  /** 环形进度 */
  function ring(o) {
    var size = o.size || 112;
    var stroke = o.stroke || 9;
    var r = (size - stroke) / 2;
    var c = 2 * Math.PI * r;
    var pct = clamp((o.value || 0) / (o.max || 1), 0, 1);
    var dash = n(c * pct);
    var color = o.color || 'var(--brand)';
    var center = size / 2;
    return '<svg viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '" role="img" aria-label="' +
      esc(o.aria || '进度') + '">' +
      '<defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0%" stop-color="' + color + '"/><stop offset="100%" stop-color="' + (o.color2 || color) + '"/></linearGradient></defs>' +
      '<circle cx="' + center + '" cy="' + center + '" r="' + n(r) + '" fill="none" stroke="currentColor" stroke-opacity=".1" stroke-width="' + stroke + '"/>' +
      '<circle cx="' + center + '" cy="' + center + '" r="' + n(r) + '" fill="none" stroke="url(#ringGrad)" stroke-width="' + stroke +
      '" stroke-linecap="round" stroke-dasharray="' + dash + ' ' + n(c - dash) + '" transform="rotate(-90 ' + center + ' ' + center + ')"/>' +
      '</svg>';
  }

  /* ------------------------------ tooltip ------------------------------ */
  var tipEl = null, tipTimer = null;

  function ensureTip(wrap) {
    var t = wrap.querySelector('.chart-tip');
    if (!t) {
      t = document.createElement('div');
      t.className = 'chart-tip';
      wrap.appendChild(t);
    }
    return t;
  }

  function showTip(wrap, html, x, y) {
    var t = ensureTip(wrap);
    t.innerHTML = html;
    t.classList.add('show');
    var w = t.offsetWidth;
    var left = clamp(x, w / 2 + 6, wrap.clientWidth - w / 2 - 6);
    t.style.left = left + 'px';
    t.style.top = Math.max(30, y) + 'px';
  }

  function hideTip() {
    if (tipEl) tipEl.classList.remove('show');
  }

  function bindTooltips(container) {
    container.addEventListener('pointerover', function (e) {
      var node = e.target.closest && e.target.closest('[data-tip]');
      if (!node) return;
      var wrap = node.closest('.chart-wrap');
      if (!wrap) return;
      tipEl = ensureTip(wrap);
      var rect = wrap.getBoundingClientRect();
      var nr = node.getBoundingClientRect();
      showTip(wrap, node.getAttribute('data-tip'), nr.left - rect.left + nr.width / 2, nr.top - rect.top);
      clearTimeout(tipTimer);
    });
    container.addEventListener('pointerout', function (e) {
      var node = e.target.closest && e.target.closest('[data-tip]');
      if (!node) return;
      clearTimeout(tipTimer);
      tipTimer = setTimeout(hideTip, 60);
    });
    container.addEventListener('pointerdown', function (e) {
      var node = e.target.closest && e.target.closest('[data-tip]');
      if (!node) return;
      var wrap = node.closest('.chart-wrap');
      if (!wrap) return;
      tipEl = ensureTip(wrap);
      var rect = wrap.getBoundingClientRect();
      var nr = node.getBoundingClientRect();
      showTip(wrap, node.getAttribute('data-tip'), nr.left - rect.left + nr.width / 2, nr.top - rect.top);
      clearTimeout(tipTimer);
      tipTimer = setTimeout(hideTip, 2200);
    }, { passive: true });
    container.addEventListener('pointerup', function () {
      clearTimeout(tipTimer);
      tipTimer = setTimeout(hideTip, 900);
    }, { passive: true });
  }

  root.CET4_CHARTS = {
    lineChart: lineChart,
    stackedBar: stackedBar,
    hbars: hbars,
    ring: ring,
    bindTooltips: bindTooltips,
    esc: esc,
    n: n,
    niceStep: niceStep
  };
})(typeof window !== 'undefined' ? window : globalThis);
