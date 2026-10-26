/*!
 * charts.js — 纯手写 SVG 图表库 v2（零依赖）
 * ------------------------------------------------------------------
 * 对外 API（同时保留 v1 别名，方便平滑替换）：
 *   line(o)      折线图（支持显式整数刻度、平滑曲线、多参考线错位标签）
 *   bar(o)       堆叠柱状图（顶段圆角、逐段提示）
 *   hbars(o)     水平条形图（标签宽度自动测量，宽屏不再稀疏）
 *   donut(o)     环形占比图
 *   gauge(o)     270° 仪表盘（分段着色 + 425 参考）
 *   sparkline(o) 迷你趋势线
 *   bindTooltips(rootEl)  事件委托式数据浮层
 *   esc / n / niceStep
 *
 * 所有函数返回 SVG 字符串；宽度按容器实测传入（1 用户单位 = 1 CSS px）。
 */
(function (root) {
  'use strict';

  /* ============================== 工具 ============================== */

  function n(v, d) {
    var p = Math.pow(10, d == null ? 1 : d);
    var r = Math.round((Number(v) || 0) * p) / p;
    return isFinite(r) ? r : 0;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function clamp(v, lo, hi) {
    v = Number(v);
    if (!isFinite(v)) v = lo;
    return Math.min(hi, Math.max(lo, v));
  }

  function isNum(v) { return v !== null && v !== undefined && v !== '' && isFinite(Number(v)); }

  /** 好看的刻度步长 */
  function niceStep(x) {
    if (!isFinite(x) || x <= 0) return 10;
    var exp = Math.floor(Math.log(x) / Math.LN10);
    var f = x / Math.pow(10, exp);
    var nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return nf * Math.pow(10, exp);
  }

  /** 整数刻度的文字（710 而不是 710.0） */
  function tickText(v) {
    var r = Math.round(Number(v) || 0);
    return String(r);
  }

  /** 中文宽度估算：中文/全角按 11.5px，数字英文按 6.4px */
  function textWidth(str, fontSize) {
    var s = String(str == null ? '' : str);
    var size = fontSize || 10.5;
    var w = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      w += c > 0x2e80 ? size * 1.02 : size * 0.56;
    }
    return w;
  }

  /** 折线平滑（Catmull-Rom → 三次贝塞尔），并把控制点钳制在绘图区内避免溢出
   *  t 取 0.5 是 Catmull-Rom 的标准张力，曲线会精确穿过每个数据点 */
  function smoothPath(pts, lo, hi) {
    if (!pts.length) return '';
    if (pts.length === 1) return 'M' + n(pts[0].x) + ',' + n(pts[0].y);
    if (pts.length === 2) {
      return 'M' + n(pts[0].x) + ',' + n(pts[0].y) + ' L' + n(pts[1].x) + ',' + n(pts[1].y);
    }
    var d = 'M' + n(pts[0].x) + ',' + n(pts[0].y);
    var t = 0.5 / 3 * 2;  /* ≈0.333：既穿过数据点，又不会过度鼓包 */
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i];
      var p1 = pts[i];
      var p2 = pts[i + 1];
      var p3 = pts[i + 2] || p2;
      var c1x = p1.x + (p2.x - p0.x) * t * 0.5;
      var c1y = clamp(p1.y + (p2.y - p0.y) * t * 0.5, lo, hi);
      var c2x = p2.x - (p3.x - p1.x) * t * 0.5;
      var c2y = clamp(p2.y - (p3.y - p1.y) * t * 0.5, lo, hi);
      d += ' C' + n(c1x) + ',' + n(c1y) + ' ' + n(c2x) + ',' + n(c2y) + ' ' + n(p2.x) + ',' + n(p2.y);
    }
    return d;
  }

  function openSvg(W, H, aria, extra) {
    return '<svg viewBox="0 0 ' + n(W) + ' ' + n(H) + '" width="100%" height="' + n(H) + '" role="img" aria-label="' +
      esc(aria || '图表') + '" style="color:var(--ink);overflow:visible"' + (extra || '') + '>';
  }

  function emptyBox(text) {
    return '<div class="chart-empty">' + esc(text || '暂无数据') + '</div>';
  }

  function uid(prefix) {
    return (prefix || 'c') + Math.random().toString(36).slice(2, 8);
  }

  /* ============================== 折线图 ============================== */

  /**
   * line(o)
   * o = { width, height, labels[], series[{key,name,color,values[],visible}],
   *       ticks[], yMin, yMax, marks[{value,label,color}], unit, area, showLast, aria }
   */
  function line(o) {
    o = o || {};
    var W = Math.max(220, Math.round(o.width || 340));
    var H = o.height || 200;
    var unit = o.unit || '';
    var labels = o.labels || [];
    var series = (o.series || []).filter(function (s) { return s && s.visible !== false; });
    var nPts = labels.length;

    if (!nPts || !series.length) return emptyBox('暂无数据，录入成绩后自动生成');

    var pad = { l: 40, r: 14, t: 20, b: 26 };
    var iw = Math.max(40, W - pad.l - pad.r);
    var ih = Math.max(40, H - pad.t - pad.b);

    /* 范围与刻度 */
    var vals = [];
    series.forEach(function (s) {
      (s.values || []).forEach(function (v) { if (isNum(v)) vals.push(Number(v)); });
    });
    (o.marks || []).forEach(function (m) { if (isNum(m.value)) vals.push(Number(m.value)); });

    var lo = isNum(o.yMin) ? Number(o.yMin) : 0;
    var hi = isNum(o.yMax) ? Number(o.yMax) : 100;
    var ticks = Array.isArray(o.ticks) && o.ticks.length ? o.ticks.slice() : (function () {
      var mx = vals.length ? Math.max.apply(null, vals) : hi;
      var step = niceStep(Math.max(10, (mx - lo) / 4));
      var out = [];
      for (var v = lo; v <= mx + 0.001; v += step) out.push(Math.round(v));
      if (!out.length) out = [lo, hi];
      return out;
    })();
    /* ticks 的最后一个值作为上界，保证曲线不出框 */
    var top = Math.max(hi, ticks[ticks.length - 1]);

    var xAt = function (i) { return nPts === 1 ? n(pad.l + iw / 2) : n(pad.l + iw * i / (nPts - 1)); };
    var yAt = function (v) { return n(pad.t + ih - (clamp(Number(v) || 0, lo, top) - lo) / (top - lo) * ih); };

    /* 网格 + Y 轴刻度 */
    var grid = '';
    ticks.forEach(function (tv, i) {
      var y = yAt(tv);
      grid += '<line x1="' + pad.l + '" y1="' + n(y) + '" x2="' + n(W - pad.r) + '" y2="' + n(y) +
        '" stroke="currentColor" stroke-opacity="' + (i === 0 ? '.20' : '.075') + '" stroke-width="1"/>';
      grid += '<text x="' + (pad.l - 7) + '" y="' + n(y + 3.2) + '" text-anchor="end" font-size="9.5" ' +
        'fill="currentColor" fill-opacity=".5" style="font-variant-numeric:tabular-nums">' + tickText(tv) + '</text>';
    });

    /* 参考线：多标签垂直错位，避免互相压字 */
    var marks = '';
    var placed = [];
    (o.marks || []).forEach(function (m) {
      if (!isNum(m.value)) return;
      var mv = Number(m.value);
      if (mv < lo || mv > top) return;
      var my = yAt(mv);
      var dir = -1;
      for (var k = 0; k < placed.length; k++) {
        if (Math.abs(placed[k] - my) < 16) dir = placed[k] > my ? 1 : -1;
      }
      placed.push(my);
      var color = m.color || '#ef4444';
      var lw = textWidth(m.label || '', 9.5) + 12;
      var ly = clamp(my + (dir < 0 ? -3 : 11), pad.t + 8, pad.t + ih - 2);
      marks += '<line x1="' + pad.l + '" y1="' + n(my) + '" x2="' + n(W - pad.r) + '" y2="' + n(my) +
        '" stroke="' + color + '" stroke-width="1.3" stroke-dasharray="5 4" stroke-opacity=".7"/>';
      marks += '<rect x="' + (pad.l + 2) + '" y="' + n(ly - 8) + '" width="' + n(lw) + '" height="15" rx="7.5" ' +
        'fill="' + color + '" fill-opacity=".16"/>';
      marks += '<text x="' + (pad.l + 8) + '" y="' + n(ly + 2.6) + '" font-size="9.5" font-weight="650" fill="' +
        color + '">' + esc(m.label || '') + '</text>';
    });

    /* X 轴标签：按可用宽度抽稀，避免重叠 */
    var axis = '';
    var perLabel = Math.max(34, textWidth(labels[0] || '00-00', 9.5) + 12);
    var every = Math.max(1, Math.ceil(nPts * perLabel / iw));
    labels.forEach(function (lb, i) {
      if (i % every !== 0 && i !== nPts - 1) return;
      axis += '<text x="' + xAt(i) + '" y="' + (H - pad.b + 14) + '" text-anchor="middle" font-size="9.5" ' +
        'fill="currentColor" fill-opacity=".52">' + esc(lb) + '</text>';
    });

    /* 系列曲线 + 数据点 + 命中区 */
    var body = '';
    var single = series.length === 1;
    series.forEach(function (s, si) {
      var color = s.color || 'var(--brand)';
      var sv = s.values || [];
      var pts = [];
      for (var i = 0; i < sv.length; i++) {
        if (!isNum(sv[i])) continue;
        pts.push({ x: xAt(i), y: yAt(sv[i]), v: Number(sv[i]), i: i });
      }
      if (!pts.length) return;

      var d = smoothPath(pts, pad.t, pad.t + ih);
      var len = n(Math.max(iw, ih) * 2.2, 0);

      if (o.area !== false && single && pts.length > 1) {
        var gid = uid('lg');
        body += '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="' + color + '" stop-opacity=".26"/>' +
          '<stop offset="92%" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs>';
        body += '<path d="' + d + ' L' + n(pts[pts.length - 1].x) + ',' + n(pad.t + ih) +
          ' L' + n(pts[0].x) + ',' + n(pad.t + ih) + ' Z" fill="url(#' + gid + ')"/>';
      }

      body += '<path class="c-line" d="' + d + '" pathLength="1" fill="none" stroke="' + color +
        '" stroke-width="' + (single ? 2.4 : 2) + '" stroke-linecap="round" stroke-linejoin="round" ' +
        'stroke-dasharray="1" stroke-dashoffset="1" stroke-opacity="' + (s.faded ? '.42' : '.95') + '"/>';

      pts.forEach(function (p, k) {
        var isLast = k === pts.length - 1;
        if (single || isLast) {
          body += '<circle class="c-dot" cx="' + n(p.x) + '" cy="' + n(p.y) + '" r="' +
            (isLast && single ? 4.2 : 3) + '" fill="' + color + '" stroke="var(--card)" stroke-width="1.6"/>';
        }
        body += '<circle class="hit" cx="' + n(p.x) + '" cy="' + n(p.y) + '" r="14" fill="transparent" data-tip="' +
          esc('<b>' + (s.name ? s.name + ' ' : '') + n(p.v, 1) + unit + '</b><br>' + (labels[p.i] || '')) + '"/>';
      });

      if (single && o.showLast !== false && pts.length) {
        var lastP = pts[pts.length - 1];
        var label = n(lastP.v, 1) + unit;
        var tx = clamp(lastP.x, pad.l + 16, W - pad.r - 16);
        body += '<text x="' + n(tx) + '" y="' + n(clamp(lastP.y - 12, pad.t + 9, H - pad.b)) +
          '" text-anchor="middle" font-size="10.5" font-weight="750" fill="' + color + '">' + esc(label) + '</text>';
      }
    });

    return openSvg(W, H, o.aria) + grid + marks + axis + body + '</svg>';
  }

  /* ============================== 堆叠柱 ============================== */

  /**
   * bar(o)
   * o = { width, height, items:[{label,total,parts:[{value,color,label}]}], max, ticks[], unit, aria }
   */
  function bar(o) {
    o = o || {};
    var W = Math.max(220, Math.round(o.width || 340));
    var H = o.height || 210;
    var unit = o.unit || '';
    var items = o.items || [];
    var max = isNum(o.max) ? Number(o.max) : 710;

    if (!items.length) return emptyBox('暂无数据，录入成绩后自动生成');

    var pad = { l: 36, r: 12, t: 24, b: 26 };
    var iw = Math.max(40, W - pad.l - pad.r);
    var ih = Math.max(40, H - pad.t - pad.b);

    var ticks = Array.isArray(o.ticks) && o.ticks.length ? o.ticks.slice() : (function () {
      var step = niceStep(max / 4);
      var out = [];
      for (var v = 0; v <= max + 0.001; v += step) out.push(Math.round(v));
      if (!out.length) out = [0];
      return out;
    })();
    /* 覆盖上界：末位不足则追加 max，不能直接改写末位（会破坏等距刻度） */
    if (ticks[ticks.length - 1] < max) ticks.push(Math.round(max));
    var top = Math.max(max, ticks[ticks.length - 1]);

    var yAt = function (v) { return n(pad.t + ih - clamp(Number(v) || 0, 0, top) / top * ih); };

    var grid = '';
    ticks.forEach(function (tv, i) {
      var y = yAt(tv);
      grid += '<line x1="' + pad.l + '" y1="' + n(y) + '" x2="' + n(W - pad.r) + '" y2="' + n(y) +
        '" stroke="currentColor" stroke-opacity="' + (i === 0 ? '.20' : '.075') + '" stroke-width="1"/>';
      grid += '<text x="' + (pad.l - 6) + '" y="' + n(y + 3.2) + '" text-anchor="end" font-size="9" ' +
        'fill="currentColor" fill-opacity=".48" style="font-variant-numeric:tabular-nums">' + tickText(tv) + '</text>';
    });

    var slot = iw / items.length;
    var bw = clamp(slot * 0.56, 7, 64);
    var body = '';

    items.forEach(function (it, i) {
      var cx = n(pad.l + slot * i + slot / 2);
      var x = n(cx - bw / 2);
      var acc = 0;
      var parts = it.parts || [];
      var base = n(pad.t + ih);

      parts.forEach(function (p, si) {
        var v = Number(p.value) || 0;
        if (v <= 0) return;
        var y1 = yAt(acc + v);
        var y0 = yAt(acc);
        var h = Math.max(0.8, y0 - y1);
        acc += v;
        var isTop = si === parts.length - 1 || acc >= (it.total || 0) - 0.01;
        /* 只有顶段圆角：普通 rect 的 rx 会把四角都圆掉，导致上下出现缺口 */
        var r = isTop ? Math.min(4, bw / 2) : 0;
        if (r > 0) {
          var bx = x, by = n(y1), bwid = n(bw), bh = n(h);
          var dpath = 'M' + bx + ',' + n(by + bh) +
            ' L' + bx + ',' + n(by + r) +
            ' Q' + bx + ',' + by + ' ' + n(bx + r) + ',' + by +
            ' L' + n(bx + bwid - r) + ',' + by +
            ' Q' + n(bx + bwid) + ',' + by + ' ' + n(bx + bwid) + ',' + n(by + r) +
            ' L' + n(bx + bwid) + ',' + n(by + bh) + ' Z';
          body += '<path class="c-bar" d="' + dpath + '" fill="' + (p.color || 'var(--brand)') + '" ' +
            'style="animation-delay:' + (i * 30) + 'ms" data-tip="' +
            esc('<b>' + (p.label || '') + ' ' + n(v, 1) + unit + '</b><br>' + it.label) + '"/>';
        } else {
          body += '<rect class="c-bar" x="' + x + '" y="' + n(y1) + '" width="' + n(bw) + '" height="' + n(h) +
            '" fill="' + (p.color || 'var(--brand)') + '" ' +
            'style="animation-delay:' + (i * 30) + 'ms" data-tip="' +
            esc('<b>' + (p.label || '') + ' ' + n(v, 1) + unit + '</b><br>' + it.label) + '"/>';
        }
      });

      /* 柱顶总分 */
      if (items.length <= 10) {
        body += '<text x="' + cx + '" y="' + n(yAt(it.total) - 6) + '" text-anchor="middle" font-size="10" ' +
          'font-weight="750" fill="currentColor" fill-opacity=".84">' + n(it.total, 0) + '</text>';
      }
      /* X 轴标签 */
      var showLabel = items.length <= 7 || i % Math.ceil(items.length / 6) === 0 || i === items.length - 1;
      if (showLabel) {
        body += '<text x="' + cx + '" y="' + (H - pad.b + 14) + '" text-anchor="middle" font-size="9.5" ' +
          'fill="currentColor" fill-opacity=".52">' + esc(it.label) + '</text>';
      }
      /* 整列命中区（显示总分与构成） */
      body += '<rect x="' + n(cx - slot / 2 + 1) + '" y="' + pad.t + '" width="' + n(slot - 2) + '" height="' + ih +
        '" fill="transparent" data-tip="' + esc('<b>' + n(it.total, 1) + unit + '</b><br>' + it.label +
          (parts.length ? '<br>' + parts.map(function (p) { return (p.label || '') + ' ' + n(p.value, 1); }).join(' · ') : '')) + '"/>';
    });

    return openSvg(W, H, o.aria) + grid + body + '</svg>';
  }

  /* ============================== 水平条 ============================== */

  /**
   * hbars(o)
   * o = { width, rows:[{label,value,max,color,sub}], rowH, labelW, rightW, unit, showPct, aria }
   * labelW / rightW 传 0 或省略时自动按内容估算。
   */
  function hbars(o) {
    o = o || {};
    var W = Math.max(200, Math.round(o.width || 340));
    var rows = o.rows || [];
    var rowH = o.rowH || 30;
    var unit = o.unit == null ? '分' : o.unit;
    var showPct = !!o.showPct;

    if (!rows.length) return emptyBox('暂无数据');

    /* 自动测量标签与数值宽度 */
    var labelW = Number(o.labelW) || 0;
    if (!labelW) {
      var lw = 0;
      rows.forEach(function (r) { lw = Math.max(lw, textWidth(r.label || '', 10.5)); });
      labelW = Math.min(Math.round(W * 0.34), Math.max(30, Math.ceil(lw) + 8));
    }
    var rightW = Number(o.rightW) || 0;
    if (!rightW) {
      var rw = 0;
      rows.forEach(function (r) {
        rw = Math.max(rw, textWidth(n(r.value, 1) + (unit || ''), 10.5));
      });
      rightW = Math.min(Math.round(W * 0.3), Math.max(28, Math.ceil(rw) + 8));
    }

    var trackX = labelW;
    var trackW = Math.max(20, W - labelW - rightW - 4);
    var H = rowH * rows.length + 6;
    var barH = Math.min(12, Math.max(6, rowH - 14));

    var out = '';
    rows.forEach(function (r, i) {
      var cy = i * rowH + rowH / 2;
      var v = Number(r.value) || 0;
      var mx = Number(r.max) || 1;
      var pct = clamp(v / mx, 0, 1);
      var w = Math.max(pct * trackW, v > 0 ? barH : 0);

      out += '<text x="0" y="' + n(cy + 3.4) + '" font-size="10.5" fill="currentColor" fill-opacity=".66">' +
        esc(r.label || '') + '</text>';
      out += '<rect x="' + trackX + '" y="' + n(cy - barH / 2) + '" width="' + n(trackW) + '" height="' + barH +
        '" rx="' + n(barH / 2) + '" fill="currentColor" fill-opacity=".075"/>';
      if (w > 0) {
        out += '<rect class="c-bar" x="' + trackX + '" y="' + n(cy - barH / 2) + '" width="' + n(w) + '" height="' + barH +
          '" rx="' + n(barH / 2) + '" fill="' + (r.color || 'var(--brand)') + '" style="animation-delay:' + (i * 50) + 'ms"/>';
      }
      var valTxt = n(v, 1) + (unit || '') + (showPct ? ' · ' + Math.round(pct * 100) + '%' : '');
      out += '<text x="' + n(W - 1) + '" y="' + n(cy + 3.4) + '" text-anchor="end" font-size="10.5" font-weight="700" ' +
        'fill="currentColor" fill-opacity=".82">' + esc(valTxt) + '</text>';
      out += '<rect x="0" y="' + (i * rowH) + '" width="' + n(W) + '" height="' + rowH + '" fill="transparent" data-tip="' +
        esc('<b>' + (r.label || '') + '</b><br>' + n(v, 1) + (unit || '') +
          (r.max ? ' / ' + n(r.max, 1) + (unit || '') : '') + (r.sub ? '<br>' + r.sub : '')) + '"/>';
    });

    return openSvg(W, H, o.aria) + out + '</svg>';
  }

  /* ============================== 环形图 ============================== */

  /**
   * donut(o)
   * o = { size, thickness, segments:[{value,color,label}], centerTitle, centerSub, gap, aria }
   */
  function donut(o) {
    o = o || {};
    var size = o.size || 150;
    var th = o.thickness || 16;
    var segs = (o.segments || []).filter(function (s) { return s && Number(s.value) > 0; });
    var cx = size / 2;
    var cy = size / 2;
    var r = (size - th) / 2 - 1;
    var circ = 2 * Math.PI * r;

    var body = '<circle cx="' + n(cx) + '" cy="' + n(cy) + '" r="' + n(r) + '" fill="none" stroke="currentColor" ' +
      'stroke-opacity=".09" stroke-width="' + th + '"/>';

    var total = segs.reduce(function (s, x) { return s + Number(x.value); }, 0);
    if (total > 0) {
      var gapDeg = Math.max(0, Math.min(6, Number(o.gap) == null ? 2 : Number(o.gap)));
      var acc = 0;
      segs.forEach(function (seg) {
        var frac = Number(seg.value) / total;
        var len = Math.max(0, frac * circ - (gapDeg / 360) * circ);
        var off = -acc * circ;
        body += '<circle class="c-seg" cx="' + n(cx) + '" cy="' + n(cy) + '" r="' + n(r) + '" fill="none" stroke="' +
          (seg.color || 'var(--brand)') + '" stroke-width="' + th + '" stroke-linecap="round" ' +
          'stroke-dasharray="' + n(len) + ' ' + n(circ - len) + '" stroke-dashoffset="' + n(off) + '" ' +
          'transform="rotate(-90 ' + n(cx) + ' ' + n(cy) + ')" data-tip="' +
          esc('<b>' + (seg.label || '') + '</b><br>' + n(seg.value, 1) + ' 分 · ' + Math.round(frac * 100) + '%') + '"/>';
        acc += frac;
      });
    }

    var title = o.centerTitle != null ? String(o.centerTitle) : '';
    if (title) {
      body += '<text x="' + n(cx) + '" y="' + n(cy + (o.centerSub ? -1 : 6)) + '" text-anchor="middle" ' +
        'font-size="' + n(Math.max(16, size * 0.2), 0) + '" font-weight="800" fill="currentColor" ' +
        'style="font-variant-numeric:tabular-nums;letter-spacing:-.5px">' + esc(title) + '</text>';
    }
    if (o.centerSub) {
      body += '<text x="' + n(cx) + '" y="' + n(cy + (title ? 15 : 5)) + '" text-anchor="middle" font-size="9.5" ' +
        'fill="currentColor" fill-opacity=".55">' + esc(o.centerSub) + '</text>';
    }

    return '<svg viewBox="0 0 ' + n(size) + ' ' + n(size) + '" width="' + n(size) + '" height="' + n(size) +
      '" role="img" aria-label="' + esc(o.aria || '占比环形图') + '" style="color:var(--ink)">' + body + '</svg>';
  }

  /* ============================== 仪表盘 ============================== */

  /**
   * gauge(o)
   * o = { size, value, max, bands:[{from,to,color}], marks:[{value,label}], label, sub, aria }
   * 270° 弧：从 135° 顺时针到 405°
   */
  function gauge(o) {
    o = o || {};
    var size = o.size || 160;
    var cx = size / 2;
    var cy = size / 2;
    var th = Math.max(8, Math.round(size * 0.085));
    var r = (size - th) / 2 - 2;
    var max = Number(o.max) || 710;
    var val = clamp(Number(o.value) || 0, 0, max);

    var START = 135;
    var SWEEP = 270;

    function polar(deg, radius) {
      var a = deg * Math.PI / 180;
      return { x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) };
    }
    function arcPath(fromDeg, toDeg, radius) {
      var p1 = polar(fromDeg, radius);
      var p2 = polar(toDeg, radius);
      var large = (toDeg - fromDeg) > 180 ? 1 : 0;
      return 'M' + n(p1.x) + ',' + n(p1.y) +
        ' A' + n(radius) + ',' + n(radius) + ' 0 ' + large + ' 1 ' + n(p2.x) + ',' + n(p2.y);
    }
    var degOf = function (v) { return START + SWEEP * clamp(v / max, 0, 1); };

    var body = '';

    /* 分段色轨 */
    var bands = Array.isArray(o.bands) && o.bands.length ? o.bands : [{ from: 0, to: max, color: 'var(--brand)' }];
    bands.forEach(function (b) {
      var d1 = degOf(b.from);
      var d2 = degOf(b.to);
      if (d2 <= d1) return;
      body += '<path d="' + arcPath(d1, d2 - 0.7, r) + '" fill="none" stroke="' + (b.color || 'var(--brand)') +
        '" stroke-width="' + th + '" stroke-linecap="butt" stroke-opacity=".22"/>';
    });

    /* 进度弧 */
    var vd = degOf(val);
    if (vd > START) {
      var gid = uid('gg');
      body += '<defs><linearGradient id="' + gid + '" x1="0" y1="1" x2="1" y2="0">' +
        '<stop offset="0%" stop-color="var(--brand)"/><stop offset="100%" stop-color="var(--brand-2)"/></linearGradient></defs>';
      body += '<path class="c-gauge" d="' + arcPath(START, vd, r) + '" fill="none" stroke="url(#' + gid + ')" ' +
        'stroke-width="' + th + '" stroke-linecap="round"/>';
    }

    /* 刻度齿 */
    for (var v = 0; v <= max; v += 100) {
      var p1 = polar(degOf(v), r - th / 2 - 1);
      var p2 = polar(degOf(v), r - th / 2 - 5);
      body += '<line x1="' + n(p1.x) + '" y1="' + n(p1.y) + '" x2="' + n(p2.x) + '" y2="' + n(p2.y) +
        '" stroke="currentColor" stroke-opacity=".28" stroke-width="1.2"/>';
    }

    /* 标记（如 425） */
    (o.marks || []).forEach(function (m) {
      if (!isNum(m.value)) return;
      var pd = polar(degOf(Number(m.value)), r);
      var pt = polar(degOf(Number(m.value)), r + th / 2 + 6);
      body += '<circle cx="' + n(pd.x) + '" cy="' + n(pd.y) + '" r="2.4" fill="currentColor" fill-opacity=".55"/>';
      if (m.label) {
        body += '<text x="' + n(pt.x) + '" y="' + n(pt.y + 3) + '" text-anchor="middle" font-size="9" ' +
          'font-weight="650" fill="currentColor" fill-opacity=".55">' + esc(m.label) + '</text>';
      }
    });

    /* 中心数值 */
    var big = n(val, 0);
    body += '<text x="' + n(cx) + '" y="' + n(cy + size * 0.045) + '" text-anchor="middle" ' +
      'font-size="' + n(Math.max(20, size * 0.25), 0) + '" font-weight="820" fill="currentColor" ' +
      'style="font-variant-numeric:tabular-nums;letter-spacing:-1.2px">' + esc(big) + '</text>';
    if (o.sub) {
      body += '<text x="' + n(cx) + '" y="' + n(cy + size * 0.045 + Math.max(14, size * 0.115)) + '" ' +
        'text-anchor="middle" font-size="10" fill="currentColor" fill-opacity=".55">' + esc(o.sub) + '</text>';
    }
    if (o.label) {
      body += '<text x="' + n(cx) + '" y="' + n(cy - size * 0.16) + '" text-anchor="middle" font-size="9.5" ' +
        'fill="currentColor" fill-opacity=".5">' + esc(o.label) + '</text>';
    }

    return '<svg viewBox="0 0 ' + n(size) + ' ' + n(size) + '" width="100%" height="' + n(size) +
      '" role="img" aria-label="' + esc(o.aria || '仪表盘') + '" style="color:var(--ink)">' + body + '</svg>';
  }

  /* ============================== 迷你折线 ============================== */

  function sparkline(o) {
    o = o || {};
    var W = Math.max(40, Math.round(o.width || 120));
    var H = o.height || 34;
    var vals = (o.values || []).filter(isNum).map(Number);
    if (vals.length < 2) return '<svg viewBox="0 0 ' + n(W) + ' ' + n(H) + '" width="' + n(W) + '" height="' + n(H) + '"></svg>';
    var lo = Math.min.apply(null, vals);
    var hi = Math.max.apply(null, vals);
    if (hi === lo) { hi = lo + 1; }
    var color = o.color || 'var(--brand)';
    var pad = 3;
    var pts = vals.map(function (v, i) {
      return {
        x: n(pad + (W - pad * 2) * i / (vals.length - 1)),
        y: n(H - pad - (v - lo) / (hi - lo) * (H - pad * 2))
      };
    });
    var d = smoothPath(pts, pad, H - pad);
    var out = '';
    if (o.fill) {
      out += '<path d="' + d + ' L' + n(pts[pts.length - 1].x) + ',' + n(H) + ' L' + n(pts[0].x) + ',' + n(H) +
        ' Z" fill="' + color + '" fill-opacity=".12"/>';
    }
    out += '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>';
    out += '<circle cx="' + n(pts[pts.length - 1].x) + '" cy="' + n(pts[pts.length - 1].y) + '" r="2.6" fill="' + color + '"/>';
    return '<svg viewBox="0 0 ' + n(W) + ' ' + n(H) + '" width="100%" height="' + n(H) +
      '" role="img" aria-label="' + esc(o.aria || '迷你趋势') + '" style="color:var(--ink)">' + out + '</svg>';
  }

  /* ============================== 兼容别名 ============================== */

  /** v1: lineChart → line */
  function lineChart(o) { return line(o); }
  /** v1: stackedBar → bar */
  function stackedBar(o) { return bar(o); }
  /** v1: ring → 简单环形进度 */
  function ring(o) {
    o = o || {};
    var size = o.size || 112;
    var stroke = o.stroke || 9;
    var r = (size - stroke) / 2;
    var c = 2 * Math.PI * r;
    var pct = clamp((Number(o.value) || 0) / (Number(o.max) || 1), 0, 1);
    var dash = n(c * pct);
    var color = o.color || 'var(--brand)';
    var color2 = o.color2 || color;
    var gid = uid('rg');
    return '<svg viewBox="0 0 ' + n(size) + ' ' + n(size) + '" width="' + n(size) + '" height="' + n(size) +
      '" role="img" aria-label="' + esc(o.aria || '进度') + '">' +
      '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0%" stop-color="' + color + '"/><stop offset="100%" stop-color="' + color2 + '"/></linearGradient></defs>' +
      '<circle cx="' + n(size / 2) + '" cy="' + n(size / 2) + '" r="' + n(r) + '" fill="none" stroke="currentColor" ' +
      'stroke-opacity=".1" stroke-width="' + stroke + '"/>' +
      '<circle cx="' + n(size / 2) + '" cy="' + n(size / 2) + '" r="' + n(r) + '" fill="none" stroke="url(#' + gid + ')" ' +
      'stroke-width="' + stroke + '" stroke-linecap="round" stroke-dasharray="' + dash + ' ' + n(c - dash) +
      '" transform="rotate(-90 ' + n(size / 2) + ' ' + n(size / 2) + ')"/>' +
      '</svg>';
  }

  /* ============================== 浮层提示 ============================== */

  var tipTimer = null;
  var tipEl = null;

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
    if (!wrap) return;
    tipEl = ensureTip(wrap);
    tipEl.innerHTML = html;
    tipEl.classList.add('show');
    var w = tipEl.offsetWidth || 80;
    var left = clamp(x, w / 2 + 4, Math.max(w / 2 + 4, wrap.clientWidth - w / 2 - 4));
    tipEl.style.left = left + 'px';
    tipEl.style.top = Math.max(26, y) + 'px';
  }

  function hideTip() {
    if (tipEl) tipEl.classList.remove('show');
    tipEl = null;
  }

  function nodeOf(e) {
    var t = e.target;
    if (!t) return null;
    if (t.closest) return t.closest('[data-tip]');
    /* 兜底：手工向上找 */
    while (t && t !== document) {
      if (t.getAttribute && t.getAttribute('data-tip')) return t;
      t = t.parentNode;
    }
    return null;
  }

  function bindTooltips(container) {
    if (!container || container.getAttribute('data-tipbound') === '1') return;
    container.setAttribute('data-tipbound', '1');

    container.addEventListener('pointerover', function (e) {
      var node = nodeOf(e);
      if (!node) return;
      var wrap = node.closest ? node.closest('.chart-wrap') : null;
      if (!wrap) return;
      var rect = wrap.getBoundingClientRect();
      var nr = node.getBoundingClientRect();
      showTip(wrap, node.getAttribute('data-tip'), nr.left - rect.left + nr.width / 2, nr.top - rect.top);
      clearTimeout(tipTimer);
    });

    container.addEventListener('pointerout', function (e) {
      var node = nodeOf(e);
      if (!node) return;
      clearTimeout(tipTimer);
      tipTimer = setTimeout(hideTip, 70);
    });

    container.addEventListener('pointerdown', function (e) {
      var node = nodeOf(e);
      if (!node) return;
      var wrap = node.closest ? node.closest('.chart-wrap') : null;
      if (!wrap) return;
      var rect = wrap.getBoundingClientRect();
      var nr = node.getBoundingClientRect();
      showTip(wrap, node.getAttribute('data-tip'), nr.left - rect.left + nr.width / 2, nr.top - rect.top);
      clearTimeout(tipTimer);
      tipTimer = setTimeout(hideTip, 2400);
    }, { passive: true });

    container.addEventListener('pointerup', function () {
      clearTimeout(tipTimer);
      tipTimer = setTimeout(hideTip, 1400);
    }, { passive: true });
  }

  /* ============================== 导出 ============================== */

  root.CET4_CHARTS = {
    line: line,
    bar: bar,
    hbars: hbars,
    donut: donut,
    gauge: gauge,
    sparkline: sparkline,
    bindTooltips: bindTooltips,
    esc: esc,
    n: n,
    niceStep: niceStep,
    textWidth: textWidth,
    /* v1 兼容 */
    lineChart: lineChart,
    stackedBar: stackedBar,
    ring: ring
  };
})(typeof window !== 'undefined' ? window : globalThis);
