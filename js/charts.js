/* charts.js - 외부 라이브러리 없이 직접 그리는 SVG 차트. 색은 CSS 변수(--s1~--sn)를 따른다. */
(function (root) {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmt(x, d) { return Number(x).toLocaleString('en-US', { maximumFractionDigits: d === undefined ? 1 : d }); }

  function tipFor(host) {
    var t = host.querySelector('.tip');
    if (!t) { t = document.createElement('div'); t.className = 'tip'; host.appendChild(t); }
    return t;
  }
  function showTip(host, html, clientX, clientY) {
    var t = tipFor(host), b = host.getBoundingClientRect();
    t.innerHTML = html; t.style.display = 'block';
    var x = clientX - b.left + 12, y = clientY - b.top + 12;
    if (x + t.offsetWidth > b.width) x = clientX - b.left - t.offsetWidth - 12;
    t.style.left = Math.max(0, x) + 'px'; t.style.top = y + 'px';
  }
  function hideTip(host) { var t = host.querySelector('.tip'); if (t) t.style.display = 'none'; }

  var HATCH = '<defs><pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
    '<line x1="0" y1="0" x2="0" y2="7" stroke="currentColor" stroke-width="1.2" opacity=".22"/></pattern></defs>';

  /* 산점도: x=투입(로그), y=복합 밀도(log10(1+y)). 점검 구역(우하단)을 빗금으로 표시 */
  function scatter(host, R) {
    var rows = R.analyzable.filter(function (r) { return r.comp !== null; });
    var W = 760, H = 400, m = { l: 54, r: 14, t: 14, b: 46 };
    var xs = rows.map(function (r) { return r.input; }), ys = rows.map(function (r) { return r.comp; });
    var xmin = Math.min.apply(null, xs) * 0.8, xmax = Math.max.apply(null, xs) * 1.25;
    var ymax = Math.max.apply(null, ys) * 1.08;
    var lx = function (v) { return Math.log10(v); }, ty = function (v) { return Math.log10(1 + v); };
    var X = function (v) { return m.l + (lx(v) - lx(xmin)) / (lx(xmax) - lx(xmin)) * (W - m.l - m.r); };
    var Y = function (v) { return H - m.b - ty(v) / ty(ymax) * (H - m.t - m.b); };
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="투입 대비 복합 밀도 산점도. 같은 내용을 아래 표에서 확인할 수 있습니다.">' + HATCH;
    [1, 3, 10, 30, 100, 300, 1000, 3000, 10000].forEach(function (v) {
      if (v < xmin || v > xmax) return;
      s += '<line class="grid" x1="' + X(v) + '" x2="' + X(v) + '" y1="' + m.t + '" y2="' + (H - m.b) + '"/><text x="' + X(v) + '" y="' + (H - m.b + 16) + '" text-anchor="middle">' + fmt(v, 0) + '</text>';
    });
    [0, 1, 2, 5, 10, 20, 50, 100, 200].forEach(function (v) {
      if (v > ymax) return;
      s += '<line class="grid" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(v) + '" y2="' + Y(v) + '"/><text x="' + (m.l - 8) + '" y="' + (Y(v) + 4) + '" text-anchor="end">' + v + '</text>';
    });
    if (R.cut.inputHi !== null && R.cut.inputHi >= xmin) {
      var x0 = X(R.cut.inputHi), y0 = Y(R.cut.densityLo);
      s += '<rect class="zone" x="' + x0 + '" y="' + y0 + '" width="' + (W - m.r - x0) + '" height="' + (H - m.b - y0) + '" style="color:var(--ink)"/>';
      s += '<line class="cutline" x1="' + x0 + '" x2="' + x0 + '" y1="' + m.t + '" y2="' + (H - m.b) + '"/><line class="cutline" x1="' + x0 + '" x2="' + (W - m.r) + '" y1="' + y0 + '" y2="' + y0 + '"/>';
      s += '<text class="zlabel" x="' + (W - m.r - 6) + '" y="' + (H - m.b - 8) + '" text-anchor="end">점검 구역</text>';
    }
    s += '<line class="axis" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + (H - m.b) + '" y2="' + (H - m.b) + '"/><line class="axis" x1="' + m.l + '" x2="' + m.l + '" y1="' + m.t + '" y2="' + (H - m.b) + '"/>';
    s += '<text class="ttl" x="' + ((W + m.l) / 2) + '" y="' + (H - 8) + '" text-anchor="middle">투입 ' + esc(R.units.input) + ' (로그 눈금)</text>';
    s += '<text class="ttl" transform="translate(13,' + ((H - m.b + m.t) / 2) + ') rotate(-90)" text-anchor="middle">복합 밀도 (' + esc(R.units.densityLabel) + ' 건, 완만한 로그 눈금)</text>';
    var cls = { '논문형': 's1', '균형형': 's2', '특허형': 's3', '성과 없음': 'sn' };
    var pts = rows.map(function (r) {
      var c = R.flags.hasBoth ? cls[r.type] : 's1';
      return { r: r, x: X(r.input), y: Y(r.comp), c: c };
    });
    // 성과 없음(회색)을 먼저 그려 색 있는 점이 위로 오게 한다
    pts.slice().sort(function (a, b) { return (a.c === 'sn' ? 0 : 1) - (b.c === 'sn' ? 0 : 1); }).forEach(function (p) {
      s += '<circle class="pt ' + p.c + '" cx="' + p.x + '" cy="' + p.y + '" r="4.5"/>';
      if (p.r.flag) s += '<circle class="ring" cx="' + p.x + '" cy="' + p.y + '" r="8"/>';
    });
    s += '<circle class="hl" r="9" cx="-50" cy="-50" id="sc-hl"/></svg>';
    host.innerHTML = s; host.appendChild(tipFor(host));
    var svg = host.querySelector('svg'), hl = svg.querySelector('#sc-hl');
    svg.addEventListener('mousemove', function (e) {
      var b = svg.getBoundingClientRect(), k = W / b.width, mx = (e.clientX - b.left) * k, my = (e.clientY - b.top) * k;
      var best = null, bd = 14 * 14;
      pts.forEach(function (p) { var d = (p.x - mx) * (p.x - mx) + (p.y - my) * (p.y - my); if (d < bd) { bd = d; best = p; } });
      if (!best) { hl.setAttribute('cx', -50); hideTip(host); return; }
      hl.setAttribute('cx', best.x); hl.setAttribute('cy', best.y);
      var r = best.r;
      showTip(host, '<b>' + esc(r.label) + '</b><br>' + (r.group ? esc(r.group) + '<br>' : '') + '투입 ' + fmt(r.input) + R.units.input +
        '<br>논문 ' + fmt(r.paper, 0) + ' · 특허 ' + fmt(r.patent, 0) + '<br>복합 밀도 ' + fmt(r.comp, 2) + (r.type ? '<br>' + r.type : '') + (r.flag ? '<br>점검 후보' : ''), e.clientX, e.clientY);
    });
    svg.addEventListener('mouseleave', function () { hl.setAttribute('cx', -50); hideTip(host); });
  }

  /* 가로 막대(유형 분포 등) */
  function hbars(host, items, total) {
    var W = 420, rowH = 34, H = items.length * rowH + 4, lw = 74, rw = 86;
    var max = Math.max.apply(null, items.map(function (i) { return i.v; })) || 1;
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="분포 막대 그래프">';
    items.forEach(function (it, i) {
      var y = i * rowH + 4, w = Math.max(it.v ? 3 : 0, it.v / max * (W - lw - rw));
      s += '<text x="0" y="' + (y + 17) + '">' + esc(it.k) + '</text>';
      s += '<rect class="' + it.c + '" x="' + lw + '" y="' + (y + 4) + '" width="' + w + '" height="18" rx="3"/>';
      s += '<text x="' + (lw + w + 8) + '" y="' + (y + 17) + '">' + it.v + '행 · ' + (total ? (it.v / total * 100).toFixed(0) : 0) + '%</text>';
    });
    host.innerHTML = s + '</svg>';
  }

  /* 누적 집중도 곡선 */
  function lorenz(host, R) {
    var c = R.conc, W = 420, H = 330, m = { l: 44, r: 14, t: 14, b: 42 };
    var X = function (v) { return m.l + v * (W - m.l - m.r); }, Y = function (v) { return H - m.b - v * (H - m.t - m.b); };
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="투입 큰 순서로 쌓은 누적 비중 곡선">';
    [0, 0.25, 0.5, 0.75, 1].forEach(function (v) {
      s += '<line class="grid" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(v) + '" y2="' + Y(v) + '"/><text x="' + (m.l - 7) + '" y="' + (Y(v) + 4) + '" text-anchor="end">' + v * 100 + '%</text>';
      s += '<text x="' + X(v) + '" y="' + (H - m.b + 16) + '" text-anchor="middle">' + v * 100 + '%</text>';
    });
    s += '<line class="cutline" x1="' + X(0) + '" y1="' + Y(0) + '" x2="' + X(1) + '" y2="' + Y(1) + '"/>';
    var d = 'M' + X(0) + ' ' + Y(0) + c.curve.map(function (p) { return ' L' + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1); }).join('');
    s += '<path class="l1" d="' + d + '"/>';
    var tx = c.k / R.analyzable.length, ty = c.topShareInput;
    s += '<circle class="pt s1" cx="' + X(tx) + '" cy="' + Y(ty) + '" r="5"/>';
    s += '<text x="' + (X(tx) + 10) + '" y="' + (Y(ty) + 18) + '" style="fill:var(--ink);font-weight:600">상위 ' + c.k + '행 → ' + (ty * 100).toFixed(1) + '%</text>';
    s += '<text class="ttl" x="' + ((W + m.l) / 2) + '" y="' + (H - 6) + '" text-anchor="middle">투입 큰 순서로 쌓은 행 비중</text>';
    s += '<text class="ttl" transform="translate(11,' + ((H - m.b + m.t) / 2) + ') rotate(-90)" text-anchor="middle">누적 투입 비중</text></svg>';
    host.innerHTML = s;
  }

  /* 세로 막대(연도 추이) */
  function vbars(host, items, ytitle, dec) {
    var W = 360, H = 240, m = { l: 48, r: 10, t: 22, b: 34 };
    var max = Math.max.apply(null, items.map(function (i) { return i.v; })) || 1;
    var bw = Math.min(56, (W - m.l - m.r) / items.length - 14);
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(ytitle) + ' 연도별 막대 그래프">';
    s += '<text class="ttl" x="0" y="12">' + esc(ytitle) + '</text>';
    s += '<line class="axis" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + (H - m.b) + '" y2="' + (H - m.b) + '"/>';
    items.forEach(function (it, i) {
      var cw = (W - m.l - m.r) / items.length, cx = m.l + cw * i + cw / 2, h = it.v / max * (H - m.t - m.b);
      s += '<path class="s1" d="M' + (cx - bw / 2) + ' ' + (H - m.b) + 'V' + (H - m.b - h + 4) + 'Q' + (cx - bw / 2) + ' ' + (H - m.b - h) + ' ' + (cx - bw / 2 + 4) + ' ' + (H - m.b - h) + 'H' + (cx + bw / 2 - 4) + 'Q' + (cx + bw / 2) + ' ' + (H - m.b - h) + ' ' + (cx + bw / 2) + ' ' + (H - m.b - h + 4) + 'V' + (H - m.b) + 'Z"/>';
      s += '<text x="' + cx + '" y="' + (H - m.b - h - 6) + '" text-anchor="middle" style="fill:var(--ink)">' + fmt(it.v, dec) + '</text>';
      s += '<text x="' + cx + '" y="' + (H - 14) + '" text-anchor="middle">' + esc(it.k) + '</text>';
    });
    host.innerHTML = s + '</svg>';
  }

  root.Charts = { scatter: scatter, hbars: hbars, lorenz: lorenz, vbars: vbars, esc: esc };
})(typeof self !== 'undefined' ? self : this);
