/* app.js - 화면 동작. 계산은 Core, 그림은 Charts가 맡는다. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = Charts.esc, F = Core.fmt;
  var B = window.BUILTIN || { profiles: [], examples: [] };

  var S = { profiles: B.profiles.slice(), table: null, name: '', R: null, th: {}, sortKey: null, sortDir: -1, showAll: false, groupsAll: false, files: null };

  /* ---------- 입력 ---------- */

  function setMsg(kind, html) { $('msg').innerHTML = html ? '<div class="msg ' + kind + '">' + html + '</div>' : ''; }

  function loadText(text, name) {
    var t = Core.parseTable(text);
    if (t.length < 2) { setMsg('err', '데이터 행이 없습니다. 첫 줄에 컬럼명, 다음 줄부터 값이 있어야 합니다.'); return false; }
    S.table = t; S.name = name || '붙여넣은 자료'; S.th = {};
    $('inname').textContent = S.name + ' · ' + (t.length - 1) + '행 · ' + t[0].length + '컬럼';
    pickProfile(); buildMapForm();
    return true;
  }

  function pickProfile() {
    var sug = Core.suggestProfiles(S.table[0], S.profiles), best = sug[0];
    $('profile').value = best.profile.id;
    showMatch(sug); resetThresholdInputs();
    if (best.score < 1) $('mapbox').open = true;
  }
  function showMatch(sug) {
    var cur = sug.filter(function (s) { return s.profile.id === $('profile').value; })[0];
    if (!cur) return;
    $('match').innerHTML = cur.score === 1 ? '컬럼 ' + cur.total + '개가 모두 맞습니다.' :
      '컬럼 ' + cur.matched + '/' + cur.total + '개만 맞습니다. 다른 프로필을 고르거나 아래에서 컬럼을 직접 지정하세요.';
  }
  function curProfile() { return S.profiles.filter(function (p) { return p.id === $('profile').value; })[0]; }

  function fillProfileSelect() {
    $('profile').innerHTML = S.profiles.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>'; }).join('');
  }

  var TH_FIELDS = [['typePaper', '논문형: 논문 비중 이상 (%)'], ['typePatent', '특허형: 논문 비중 이하 (%)'], ['flagInputTop', '점검: 투입 상위 (%)'],
    ['flagDensityBottom', '점검: 복합 밀도 하위 (%)'], ['concentrationTop', '집중도: 상위 행 (%)'],
    ['smallInputBottom', '분모 작음: 투입 하위 (%)'], ['expandInputBottom', '확대 검토: 투입 하위 (%)'], ['expandDensityTop', '확대 검토: 복합 밀도 상위 (%)'],
    ['smallCountMax', '과제 수 적음: 과제 수 이하 (개)', true]];
  function resetThresholdInputs() {
    var th = Object.assign({}, Core.DEFAULT_TH, curProfile().thresholds || {});
    $('th').innerHTML = TH_FIELDS.map(function (f) {
      return '<div><label class="f" for="th-' + f[0] + '">' + f[1] + '</label><input type="number" id="th-' + f[0] + '" min="' + (f[2] ? 0 : 1) + '" max="' + (f[2] ? 9999 : 99) + '" step="1" value="' + (f[2] ? th[f[0]] : Math.round(th[f[0]] * 100)) + '"></div>';
    }).join('');
    TH_FIELDS.forEach(function (f) {
      $('th-' + f[0]).addEventListener('change', function () { readThresholds(); if (S.R) run(); });
    });
    S.th = {};
  }
  function readThresholds() {
    var o = {};
    TH_FIELDS.forEach(function (f) {
      var v = parseFloat($('th-' + f[0]).value);
      if (f[2]) { if (v >= 0) o[f[0]] = v; } else if (v > 0 && v < 100) o[f[0]] = v / 100;
    });
    S.th = o;
  }

  /* ---------- 컬럼 직접 지정 ---------- */

  /* 컬럼 이름에 단위가 적혀 있을 때만(예: "연구비(백만원)") 채운다. 모르면 빈 칸으로 두어 사용자가 직접 쓰게 한다. */
  function unitOf(name) {
    var m = /(백만원|천만원|억원|천원|만원)/.exec(name || '');
    return m ? m[1] : '';
  }
  function guess(h, re, not) { return h.filter(function (x) { return re.test(x) && !(not && not.test(x)); }); }
  function buildMapForm() {
    var h = S.table[0].map(function (x) { return x.trim(); });
    var opt = function (sel, none) {
      return (none ? '<option value="">(사용 안 함)</option>' : '') + h.map(function (x) { return '<option' + (x === sel ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('');
    };
    var g = {
      input: guess(h, /출연|연구비|투입|예산|금액|비용/)[0], count: guess(h, /과제.*(수|건)|건수/)[0],
      group: guess(h, /사업/)[0], year: guess(h, /연도|년도/)[0],
      paper: guess(h, /논문|SCI/), patent: guess(h, /특허.*등록|등록.*특허/)
    };
    var chk = function (name, sel) {
      return '<div class="chk">' + h.map(function (x, i) { return '<label><input type="checkbox" name="' + name + '" value="' + esc(x) + '"' + (sel && sel.indexOf(x) >= 0 ? ' checked' : '') + '>' + esc(x) + '</label>'; }).join('') + '</div>';
    };
    $('mapform').innerHTML =
      '<p class="note">컬럼 역할을 지정하면 새 프로필이 만들어집니다. 투입 컬럼은 필수입니다.</p>' +
      '<div><label class="f" for="m-input">투입(연구비·출연금) *</label><select id="m-input">' + opt(g.input) + '</select></div>' +
      '<div class="grid2"><div><label class="f" for="m-unit">투입 단위 표기</label><input type="text" id="m-unit" value="' + esc(unitOf(g.input)) + '" placeholder="필수: 예) 억원, 백만원, 천원"></div>' +
      '<div><label class="f" for="m-per">밀도 기준 (투입 몇 단위당)</label><input type="number" id="m-per" value="10" min="1"></div></div>' +
      '<div><label class="f" for="m-count">과제 수</label><select id="m-count">' + opt(g.count, true) + '</select></div>' +
      '<div><label class="f">논문 컬럼 (여러 개 선택 가능)</label>' + chk('m-paper', g.paper) + '</div>' +
      '<div><label class="f">특허 컬럼 (여러 개 선택 가능)</label>' + chk('m-patent', g.patent) + '</div>' +
      '<div><label class="f" for="m-group">집계 기준 그룹</label><select id="m-group">' + opt(g.group, true) + '</select></div>' +
      '<div><label class="f" for="m-year">연도</label><select id="m-year">' + opt(g.year, true) + '</select></div>' +
      '<div><label class="f" for="m-label">행 이름으로 쓸 컬럼 (여러 개 선택 가능)</label>' + chk('m-label', [h[0]]) + '</div>' +
      '<div class="row"><button type="button" class="primary" id="m-go">이 지정으로 분석</button><button type="button" id="m-dl">프로필 JSON 내려받기</button></div>';
    $('m-unit').oninput = function () { this.dataset.touched = '1'; };
    $('m-input').onchange = function () { if (!$('m-unit').dataset.touched) $('m-unit').value = unitOf(this.value); };
    $('m-go').onclick = function () { if (!unitFilled()) return; var p = mapProfile(); S.profiles.push(p); fillProfileSelect(); $('profile').value = p.id; resetThresholdInputs(); run(); };
    $('m-dl').onclick = function () { if (!unitFilled()) return; var p = mapProfile(); download(p.id + '.json', JSON.stringify(p, null, 2) + '\n', 'application/json'); };
  }
  function unitFilled() {
    if ($('m-unit').value.trim()) return true;
    setMsg('err', '투입 단위를 입력하세요(예: 억원, 백만원). 단위를 모르는 채로 억원으로 가정하면 합계와 밀도가 잘못 표시됩니다.');
    $('mapbox').open = true; $('m-unit').focus(); return false;
  }
  function checked(name) { return Array.prototype.map.call(document.querySelectorAll('input[name="' + name + '"]:checked'), function (e) { return e.value; }); }
  function mapProfile() {
    var id = 'custom_' + (S.profiles.length + 1);
    return {
      id: id, name: '직접 지정 프로필 ' + (S.profiles.length + 1), description: '화면에서 컬럼을 지정해 만든 프로필',
      columns: { year: $('m-year').value || null, group: $('m-group').value || null, label: checked('m-label'), count: $('m-count').value || null,
        input: $('m-input').value, paper: checked('m-paper'), patent: checked('m-patent'), aux: [] },
      units: { input: $('m-unit').value, densityPer: parseFloat($('m-per').value) || 1, densityLabel: '투입 ' + (parseFloat($('m-per').value) || 1) + $('m-unit').value + '당' },
      thresholds: Object.assign({}, Core.DEFAULT_TH)
    };
  }

  /* ---------- 실행 ---------- */

  function run() {
    if (!S.table) { setMsg('err', '먼저 자료를 고르거나 붙여넣으세요.'); return; }
    readThresholds();
    var R = Core.analyze(S.table, curProfile(), { thresholds: S.th });
    if (!R.ok) {
      $('result').classList.add('hidden');
      setMsg('err', esc(R.errors.join(' ')) + '<br>다른 프로필을 고르거나 "컬럼 직접 지정"을 사용하세요.');
      $('mapbox').open = true; return;
    }
    S.R = R; S.files = Core.buildOutputs(R, { inputName: S.name });
    setMsg(R.allOk ? 'ok' : 'warn', R.allOk ? '분석을 마쳤습니다. 검산이 모두 일치합니다.' : '분석은 했지만 검산에 불일치가 있습니다. 아래 검산 표를 확인하세요.');
    $('result').classList.remove('hidden');
    render(R);
    $('sec-glance').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- 표 보조 ---------- */

  function table(cols, rows, extra) {
    var h = '<div class="tw"><table><thead><tr>' + cols.map(function (c) {
      return '<th class="' + (c.n ? 'n ' : '') + (c.l ? 'l ' : '') + (c.sort ? 'sort' : '') + '"' + (c.sort ? ' data-k="' + c.key + '" tabindex="0"' : '') + '>' + esc(c.h) + (extra && extra.sortKey === c.key ? (extra.sortDir > 0 ? ' ▲' : ' ▼') : '') + '</th>';
    }).join('') + '</tr></thead><tbody>' + rows.map(function (r) {
      return '<tr' + (r.flag ? ' class="flag"' : r.expand ? ' class="expand"' : '') + '>' + cols.map(function (c) { return '<td class="' + (c.n ? 'n ' : '') + (c.l ? 'l' : '') + '">' + c.f(r) + '</td>'; }).join('') + '</tr>';
    }).join('') + '</tbody></table></div>';
    return h;
  }
  var N = F.num;
  function tagHtml(t) {
    var c = { '논문형': 's1', '균형형': 's2', '특허형': 's3', '성과 없음': 'sn' }[t];
    return t ? '<span class="tag"><i style="background:var(--' + c + ')"></i>' + esc(t) + '</span>' : '';
  }
  function hitsCell(n, cells) { return n === cells ? '<b>' + n + '/' + cells + '</b>' : n + '/' + cells; }
  function cols(R, withType, withSmall, stab) {
    var u = R.units.input, f = R.flags, c = [];
    if (R.cols.year && R.years) c.push({ h: '연도', key: 'year', f: function (r) { return esc(r.year); }, sort: true });
    if (f.hasGroup) c.push({ h: '그룹', key: 'group', f: function (r) { return esc(r.group); }, l: true, sort: true });
    c.push({ h: '항목', key: 'label', f: function (r) { return esc(r.label); }, l: true, sort: true });
    if (f.hasCount) c.push({ h: '과제수', key: 'count', n: 1, f: function (r) { return N(r.count); }, sort: true });
    c.push({ h: '투입(' + u + ')', key: 'input', n: 1, f: function (r) { return N(r.input); }, sort: true });
    if (f.hasPaper) c.push({ h: '논문', key: 'paper', n: 1, f: function (r) { return N(r.paper); }, sort: true });
    if (f.hasPatent) c.push({ h: '특허', key: 'patent', n: 1, f: function (r) { return N(r.patent); }, sort: true });
    if (withType) {
      if (f.hasPaper || f.hasPatent) c.push({ h: '복합 밀도', key: 'comp', n: 1, f: function (r) { return N(r.comp); }, sort: true });
      if (f.hasBoth) c.push({ h: '유형', key: 'type', f: function (r) { return tagHtml(r.type); }, sort: true });
    }
    if (withSmall) c.push({ h: '표시', key: 'small', f: function (r) {
      return (r.small ? '<span class="tag small">분모 작음</span> ' : '') + (r.fewTasks ? '<span class="tag small">과제 수 적음</span>' : '');
    }, sort: true });
    if (stab && R.stability) {
      var cells = R.stability.cells;
      if (stab === 'flag' || stab === 'both') c.push({ h: '점검 유지', key: 'flagHits', n: 1, f: function (r) { return stab === 'both' && !r.flagHits ? '' : hitsCell(r.flagHits, cells); }, sort: true });
      if (stab === 'expand' || stab === 'both') c.push({ h: '확대 유지', key: 'expandHits', n: 1, f: function (r) { return stab === 'both' && !r.expandHits ? '' : hitsCell(r.expandHits, cells); }, sort: true });
    }
    return c;
  }

  /* ---------- 화면 그리기 ---------- */

  function render(R) {
    var t = R.totals, u = R.units.input, f = R.flags;

    // 0. 한눈에 보기: 검산 결과를 머리에 붙여, 확인되지 않은 숫자를 그대로 읽지 않게 한다
    $('sec-glance').innerHTML = '<h2>한눈에 보기</h2>' +
      '<p class="sub">규칙으로 채운 문장입니다. 숫자 비교만 적었고 원인이나 우열은 판단하지 않았습니다.</p>' +
      '<div class="msg ' + (R.allOk ? 'ok' : 'err') + '" style="margin-bottom:10px">' + (R.allOk ? '✓ 검산이 모두 일치합니다.' : '✕ 검산에 불일치가 있습니다. 아래 수치를 쓰기 전에 검산 표를 먼저 확인하세요.') + ' <a href="#sec-check">검산 표 보기</a></div>' +
      '<ul class="obs">' + R.observations.filter(function (o) { return o.key !== 'scope'; }).map(function (o) { return '<li>' + esc(o.text) + '</li>'; }).join('') + '</ul>';

    // 0-2. 빠진 것: 분석에 들어오지 못한 몫
    var cv = R.coverage, mrows = [{ k: '행 수', all: t.rows, inc: t.analyzable, exc: t.excluded, sh: cv.rows }];
    if (f.hasCount) mrows.push({ k: '과제 수', all: t.count, inc: t.analyzableCount, exc: t.excludedCount, sh: cv.count });
    if (f.hasPaper) mrows.push({ k: '논문', all: t.paper, inc: t.analyzablePaper, exc: t.excludedPaper, sh: cv.paper });
    if (f.hasPatent) mrows.push({ k: '특허', all: t.patent, inc: t.analyzablePatent, exc: t.excludedPatent, sh: cv.patent });
    $('sec-missing').innerHTML = '<h2>빠진 것</h2><p class="sub">투입이 0이거나 비어 있으면 밀도를 계산할 수 없어 지표에서 빠집니다. 아래 "분석 포함 비율"이 낮을수록 이 결과는 전체의 일부만 본 것입니다.</p>' +
      '<div class="msg ' + (t.excludedWithOutput ? 'warn' : 'ok') + '" style="margin-bottom:10px">' + esc(R.observations[0].text) + (t.excludedWithOutput ? ' <a href="#sec-excl">제외 행 보기</a>' : '') + '</div>' +
      table([{ h: '구분', f: function (r) { return esc(r.k); }, l: true }, { h: '전체', n: 1, f: function (r) { return N(r.all); } },
        { h: '분석 포함', n: 1, f: function (r) { return N(r.inc); } }, { h: '제외', n: 1, f: function (r) { return N(r.exc); } },
        { h: '분석 포함 비율', n: 1, f: function (r) { return F.pct(r.sh); } }], mrows);

    // 1. 검산
    var inp = R.checks.filter(function (c) { return c.item === R.cols.input; })[0];
    $('sec-check').innerHTML =
      '<h2>2. 검산</h2><p class="sub">결과를 보기 전에 원본 합계와 집계 합계가 같은지 먼저 확인합니다. 투입이 0이거나 비어 있는 행은 지표 계산에서 빠지지만, 합계에는 남아 있어야 합니다.</p>' +
      '<div class="ledger"><div class="ledger-head ' + (R.allOk ? 'ok' : 'bad') + '">' + (R.allOk ? '✓ 모든 검산 일치' : '✕ 불일치 있음') +
      '<span class="eq">투입 원본 ' + N(inp.source) + u + ' = 분석 대상 ' + N(inp.analyzable) + ' + 제외 ' + N(inp.excluded) + '</span></div>' +
      table([{ h: '항목', f: function (r) { return esc(r.item); }, l: true }, { h: '원본 합계', n: 1, f: function (r) { return N(r.source); } },
        { h: '분석 대상', n: 1, f: function (r) { return N(r.analyzable); } }, { h: '제외', n: 1, f: function (r) { return N(r.excluded); } },
        { h: '집계표', n: 1, f: function (r) { return r.groupTotal === null ? '-' : N(r.groupTotal); } },
        { h: '결과', f: function (r) { return r.ok ? '<span style="color:var(--ok)">일치</span>' : '<b style="color:var(--bad)">불일치</b>'; } }], R.checks) + '</div>' +
      '<div class="stack" style="margin-top:12px">' +
      '<div class="msg ' + (t.excludedWithOutput ? 'warn' : 'ok') + '">전체 ' + t.rows + '행 중 분석 대상 ' + t.analyzable + '행, 투입 0·빈 칸으로 제외 ' + t.excluded + '행.' +
      (t.excludedWithOutput ? ' 제외 행 중 ' + t.excludedWithOutput + '행에는 성과가 있어(논문 ' + N(t.excludedPaper) + '건, 특허 ' + N(t.excludedPatent) + '건) 밀도를 계산할 수 없으므로 아래 "제외 행" 표에 따로 둡니다.' : '') + '</div>' +
      '<div class="msg ' + (R.dups || R.badCells ? 'warn' : 'ok') + '">이중 집계 의심 ' + R.dups + '건(같은 연도·그룹·항목 중복), 숫자로 읽히지 않은 칸 ' + R.badCells + '개.</div>' +
      (R.disabled.length ? '<div class="note">자동으로 꺼진 기능: ' + esc(R.disabled.join(' / ')) + '</div>' : '') + '</div>';

    // 2. KPI
    var k = [['분석 대상 행', N(t.analyzable) + ' / ' + N(t.rows)], ['투입 합계', N(t.analyzableInput) + u]];
    if (f.hasCount) { k.push(['과제 수', N(t.analyzableCount) + '건']); k.push(['과제당 평균 투입', N(t.avgInput) + u]); }
    if (f.hasPaper) k.push(['논문', N(t.analyzablePaper) + '건']);
    if (f.hasPatent) k.push(['특허', N(t.analyzablePatent) + '건']);
    if (t.comp !== null) k.push(['전체 복합 밀도', N(t.comp)]);
    $('sec-kpi').innerHTML = '<h2>3. 요약</h2><p class="sub">분석 대상 행 기준입니다. 복합 밀도는 ' + esc(R.units.densityLabel) + ' 논문+특허 건수입니다.</p><div class="kpis">' +
      k.map(function (x) { return '<div class="kpi"><b>' + x[1] + '</b><span>' + esc(x[0]) + '</span></div>'; }).join('') + '</div>';

    // 3. 산점도
    var sp = $('sec-scatter');
    if (R.cut.inputHi !== null) {
      sp.innerHTML = '<h2>4. 투입과 성과 밀도</h2><p class="sub">한 점은 한 행입니다. 오른쪽 아래(투입은 크고 밀도는 낮은 구역)의 실선 고리 행이 점검 후보, 왼쪽 위(투입은 작고 밀도는 높은 구역)의 점선 고리 행이 확대 검토 후보입니다. 작은 점은 투입이 작아 밀도가 흔들릴 수 있는 \'분모 작음\' 행입니다. 마우스를 올리면 값이 보입니다.</p>' +
        (f.hasBoth ? '<div class="legend"><span><i style="background:var(--s1)"></i>논문형</span><span><i style="background:var(--s2)"></i>균형형</span><span><i style="background:var(--s3)"></i>특허형</span><span><i style="background:var(--sn)"></i>성과 없음</span><span><i class="ringkey"></i>점검 후보</span><span><i class="ringkey dash"></i>확대 검토 후보</span><span><i class="smallkey"></i>분모 작음</span></div>' : '<div class="legend"><span><i class="ringkey"></i>점검 후보</span><span><i class="ringkey dash"></i>확대 검토 후보</span><span><i class="smallkey"></i>분모 작음</span></div>') +
        '<div class="chart" id="ch-sc"></div>';
      Charts.scatter($('ch-sc'), R);
    } else sp.innerHTML = '<h2>4. 투입과 성과 밀도</h2><div class="msg warn">논문·특허 컬럼이 없어 이 그래프를 만들 수 없습니다.</div>';

    // 4. 분포
    $('sec-dist').innerHTML = '<h2>5. 유형 분포와 투입 집중도</h2><p class="sub">유형은 논문 비중으로 나눕니다(논문형 ≥ ' + F.pct(R.thresholds.typePaper, 0) + ', 특허형 ≤ ' + F.pct(R.thresholds.typePatent, 0) + '). 집중도는 투입이 큰 행부터 쌓은 누적 비중입니다.</p>' +
      '<div class="grid2"><div><h3>성과 유형 분포</h3><div class="chart" id="ch-type">' + (R.typeCount ? '' : '<div class="msg warn">논문·특허 컬럼이 모두 있어야 유형을 나눌 수 있습니다.</div>') + '</div>' +
      (R.conc ? '<p class="note">투입 상위 ' + F.pct(R.thresholds.concentrationTop, 0) + '(' + R.conc.k + '행)의 투입 비중 <b>' + F.pct(R.conc.topShareInput) + '</b>' +
        (R.conc.topSharePatent !== null ? ', 특허 비중 ' + F.pct(R.conc.topSharePatent) : '') + (R.conc.topSharePaper !== null ? ', 논문 비중 ' + F.pct(R.conc.topSharePaper) : '') +
        '. 지니계수(투입) ' + R.conc.giniInput.toFixed(3) + '.</p>' : '') + '</div>' +
      '<div><h3>누적 투입 비중</h3><div class="chart" id="ch-lz"></div></div></div>';
    if (R.typeCount) Charts.hbars($('ch-type'), [['논문형', 's1'], ['균형형', 's2'], ['특허형', 's3'], ['성과 없음', 'sn']].map(function (x) { return { k: x[0], c: x[1], v: R.typeCount[x[0]] }; }), t.analyzable);
    if (R.conc) Charts.lorenz($('ch-lz'), R);

    // 5. 점검 후보
    $('sec-flags').innerHTML = '<h2>6. 점검 후보</h2>' + (R.cut.inputHi === null ? '<div class="msg warn">논문·특허 컬럼이 없어 계산하지 않았습니다.</div>' :
      '<p class="sub">투입 상위 ' + F.pct(R.thresholds.flagInputTop, 0) + '(≥ ' + N(R.cut.inputHi) + u + ')이면서 복합 밀도 하위 ' + F.pct(R.thresholds.flagDensityBottom, 0) + '(≤ ' + N(R.cut.densityLo) + '). 부실 판정이 아니라 사업 성격과 성과 시차를 먼저 확인할 대상입니다. 점검 유지는 투입·밀도 기준을 각각 ±5%p, ±10%p씩 옮긴 ' + R.stability.cells + '가지 중 후보로 잡힌 횟수이며, 같은 ' + R.stability.cells + '가지에서 후보 수는 ' + R.stability.flag.min + '~' + R.stability.flag.max + '행입니다.</p>' +
      (R.flagged.length ? table(cols(R, true, true, 'flag'), R.flagged) : '<div class="msg ok">조건에 맞는 행이 없습니다.</div>'));

    // 6-2. 확대 검토 후보
    $('sec-expand').innerHTML = '<h2>7. 확대 검토 후보</h2>' + (R.cut.expandInputLo === null ? '<div class="msg warn">논문·특허 컬럼이 없어 계산하지 않았습니다.</div>' :
      '<p class="sub">투입 하위 ' + F.pct(R.thresholds.expandInputBottom, 0) + '(≤ ' + N(R.cut.expandInputLo) + u + ')이면서 복합 밀도 상위 ' + F.pct(R.thresholds.expandDensityTop, 0) + '(≥ ' + N(R.cut.expandDensityHi) + '). 확대를 권하는 것이 아니라 더 확인할 대상입니다. 확대 유지는 같은 방식으로 기준을 옮긴 ' + R.stability.cells + '가지 중 잡힌 횟수이며 후보 수는 ' + R.stability.expand.min + '~' + R.stability.expand.max + '행입니다. 분모 작음(투입 하위 ' + F.pct(R.thresholds.smallInputBottom, 0) + ', ≤ ' + N(R.cut.smallLo) + u + ') 행은 밀도가 우연히 높게 나왔을 수 있어 뒤에 두었습니다.</p>' +
      (R.expandList.length ? table(cols(R, true, true, 'expand'), R.expandList) : '<div class="msg ok">조건에 맞는 행이 없습니다.</div>'));

    // 6. 집계표
    var gs = R.groups;
    if (gs) {
      var show = S.groupsAll ? gs : gs.slice(0, 15);
      var gc = [{ h: '그룹', f: function (r) { return esc(r.group); }, l: true }, { h: '행 수', n: 1, f: function (r) { return N(r.rows); } }];
      if (f.hasCount) gc.push({ h: '과제수', n: 1, f: function (r) { return N(r.count); } });
      gc.push({ h: '투입(' + u + ')', n: 1, f: function (r) { return N(r.input); } });
      if (f.hasPaper) gc.push({ h: '논문', n: 1, f: function (r) { return N(r.paper); } });
      if (f.hasPatent) gc.push({ h: '특허', n: 1, f: function (r) { return N(r.patent); } });
      if (R.flags.hasPaper || R.flags.hasPatent) gc.push({ h: '복합 밀도', n: 1, f: function (r) { return r.comp === null ? '-' : N(r.comp); } });
      $('sec-groups').innerHTML = '<h2>8. 집계표 (' + esc(R.cols.group) + '별)</h2><p class="sub">제외 행도 합계에는 포함한 집계입니다. 투입 순으로 정렬했고 합계는 검산 표의 "집계표" 열과 같습니다.</p>' +
        table(gc, show) + (gs.length > 15 ? '<div style="margin-top:10px"><button type="button" id="g-more">' + (S.groupsAll ? '상위 15개만 보기' : '전체 ' + gs.length + '개 보기') + '</button></div>' : '');
      var gm = $('g-more'); if (gm) gm.onclick = function () { S.groupsAll = !S.groupsAll; render(R); };
    } else $('sec-groups').innerHTML = '<h2>8. 집계표</h2><div class="msg warn">그룹 컬럼이 지정되지 않아 집계표를 만들지 않았습니다.</div>';

    // 7. 연도
    var ys = $('sec-years');
    if (R.years) {
      ys.classList.remove('hidden');
      ys.innerHTML = '<h2>연도 추이</h2><p class="sub">연도 값이 둘 이상일 때만 나타납니다.</p><div class="grid2"><div class="chart" id="ch-y1"></div><div class="chart" id="ch-y2"></div></div>';
      Charts.vbars($('ch-y1'), R.years.map(function (y) { return { k: y.year, v: y.input }; }), '투입 합계(' + u + ')', 0);
      Charts.vbars($('ch-y2'), R.years.map(function (y) { return { k: y.year, v: y.comp || 0 }; }), '복합 밀도', 2);
    } else ys.classList.add('hidden');

    // 8. 전체 지표표
    renderAll(R);

    // 9. 제외 행
    $('sec-excl').innerHTML = '<h2>10. 제외 행 (투입 0·빈 칸)</h2><p class="sub">밀도를 계산할 수 없어 지표에서 뺀 행입니다. 성과가 있는 행은 사업 간 비교 전에 별도로 해석해야 합니다.</p>' +
      (R.excluded.length ? table(cols(R, false).filter(function (c) { return c.key !== 'year' || true; }), S.showExcl ? R.excluded : R.excluded.slice(0, 20)) +
        (R.excluded.length > 20 ? '<div style="margin-top:10px"><button type="button" id="e-more">' + (S.showExcl ? '20행만 보기' : '전체 ' + R.excluded.length + '행 보기') + '</button></div>' : '') : '<div class="msg ok">제외된 행이 없습니다.</div>');
    var em = $('e-more'); if (em) em.onclick = function () { S.showExcl = !S.showExcl; render(R); };

    // 10. 저장
    var names = Object.keys(S.files);
    $('sec-save').innerHTML = '<h2>11. 저장</h2><p class="sub">결과는 이 페이지에서 파일로 내려받습니다. 정적 페이지는 컴퓨터의 폴더에 직접 쓸 수 없으므로 압축 파일(out 폴더 구성)이나 폴더 선택 저장을 제공합니다.</p>' +
      '<div class="row"><button type="button" class="primary" id="s-zip">모두 받기 (out.zip)</button>' +
      (window.showDirectoryPicker ? '<button type="button" id="s-dir">폴더에 저장 (out/)</button>' : '') +
      '<button type="button" id="s-copy">요약(마크다운) 복사</button></div>' +
      '<div class="row" style="margin-top:12px">' + names.map(function (n) { return '<button type="button" data-f="' + esc(n) + '">' + esc(n) + '</button>'; }).join('') + '</div><div id="s-msg" class="note" style="margin-top:10px"></div>';
    $('s-zip').onclick = function () { downloadBlob('out.zip', zip(S.files), 'application/zip'); };
    var sd = $('s-dir'); if (sd) sd.onclick = saveDir;
    $('s-copy').onclick = function () {
      var done = function () { $('s-msg').textContent = '요약을 복사했습니다.'; };
      if (navigator.clipboard) navigator.clipboard.writeText(S.files['summary.md']).then(done, function () { $('s-msg').textContent = '복사가 막혀 있습니다. summary.md를 내려받아 사용하세요.'; });
      else $('s-msg').textContent = '이 브라우저는 복사를 지원하지 않습니다. summary.md를 내려받아 사용하세요.';
    };
    Array.prototype.forEach.call($('sec-save').querySelectorAll('button[data-f]'), function (b) {
      b.onclick = function () { var n = b.getAttribute('data-f'); download(n, S.files[n], /json$/.test(n) ? 'application/json' : /md$/.test(n) ? 'text/markdown' : 'text/csv'); };
    });

    // 11. 한계
    $('sec-limits').innerHTML = '<h2>해석상 한계</h2><ul class="limits">' +
      '<li>성과는 투입 이후 시차를 두고 나타나므로 같은 해 투입과 성과를 바로 대응시키면 왜곡될 수 있습니다.</li>' +
      '<li>투입이 작거나 과제 수가 적은 행은 논문·특허 몇 건만 달라도 밀도가 크게 달라집니다. 확대 검토 후보는 분모 작음·과제 수 적음 표시를 함께 읽어야 합니다.</li>' +
      '<li>후보 기준(상위·하위 %)은 정해진 값이 아니라서, 기준을 옮기면 후보가 달라집니다. 유지 횟수가 낮은 행은 기준에 따라 잡히거나 빠지는 행입니다.</li>' +
      '<li>사업 목적(원천·사업화·인프라 등)이 달라 논문·특허 밀도를 사업 간 우열로 읽을 수 없습니다.</li>' +
      '<li>집계 자료이므로 개별 과제의 성과를 추정할 수 없습니다.</li>' +
      '<li>입력 자료가 다루는 범위(기관·사업·연도)에만 해당하며 국가 R&amp;D 전체를 대표하지 않습니다.</li></ul>';
    bindSort();
  }

  function renderAll(R) {
    var cs = cols(R, true, true, 'both'), rows = R.analyzable.slice();
    if (S.sortKey) {
      var k = S.sortKey, d = S.sortDir;
      rows.sort(function (a, b) {
        var x = a[k], y = b[k];
        if (x === null || x === undefined) x = -Infinity; if (y === null || y === undefined) y = -Infinity;
        return (x < y ? -1 : x > y ? 1 : 0) * d;
      });
    }
    var shown = S.showAll ? rows : rows.slice(0, 30);
    rows.forEach(function (r) { r.flag = r.flag; });
    $('sec-all').innerHTML = '<h2>9. 전체 지표표</h2><p class="sub">머리글을 누르면 정렬됩니다. 왼쪽 주황색 막대는 점검 후보, 청록색 막대는 확대 검토 후보입니다. 분모 작음은 투입이 작아, 과제 수 적음은 과제 수가 적어 밀도가 흔들릴 수 있는 행입니다. 점검 유지·확대 유지는 기준을 옮긴 25가지 중 후보로 잡힌 횟수입니다.</p>' +
      table(cs, shown, { sortKey: S.sortKey, sortDir: S.sortDir }) +
      (rows.length > 30 ? '<div style="margin-top:10px"><button type="button" id="a-more">' + (S.showAll ? '30행만 보기' : '전체 ' + rows.length + '행 보기') + '</button></div>' : '');
    var am = $('a-more'); if (am) am.onclick = function () { S.showAll = !S.showAll; renderAll(R); bindSort(); };
  }
  function bindSort() {
    Array.prototype.forEach.call(document.querySelectorAll('#sec-all th.sort'), function (th) {
      var go = function () {
        var k = th.getAttribute('data-k');
        if (S.sortKey === k) S.sortDir = -S.sortDir; else { S.sortKey = k; S.sortDir = (k === 'label' || k === 'group' || k === 'type' || k === 'year') ? 1 : -1; }
        renderAll(S.R); bindSort();
      };
      th.onclick = go; th.onkeydown = function (e) { if (e.key === 'Enter') go(); };
    });
  }

  /* ---------- 저장 ---------- */

  function downloadBlob(name, blob) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function download(name, text, type) { downloadBlob(name, new Blob([text], { type: type + ';charset=utf-8' })); }

  function saveDir() {
    window.showDirectoryPicker({ mode: 'readwrite' }).then(function (dir) {
      return dir.getDirectoryHandle('out', { create: true });
    }).then(function (out) {
      var p = Promise.resolve();
      Object.keys(S.files).forEach(function (n) {
        p = p.then(function () { return out.getFileHandle(n, { create: true }); }).then(function (fh) { return fh.createWritable(); })
          .then(function (w) { return w.write(S.files[n]).then(function () { return w.close(); }); });
      });
      return p;
    }).then(function () { $('s-msg').textContent = '선택한 폴더 아래 out/ 에 ' + Object.keys(S.files).length + '개 파일을 저장했습니다.'; })
      .catch(function (e) { $('s-msg').textContent = e && e.name === 'AbortError' ? '저장을 취소했습니다.' : '폴더 저장에 실패했습니다. 압축 파일로 받아 주세요.'; });
  }

  // 압축 없이 담는(store) 최소 zip 작성기
  var CRC = (function () { var t = []; for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { var c = 0xffffffff; for (var i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  function zip(files) {
    var enc = new TextEncoder(), parts = [], central = [], off = 0, d = new Date();
    var dt = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)), dd = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate());
    function u16(v) { return [v & 255, (v >> 8) & 255]; } function u32(v) { return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; }
    Object.keys(files).forEach(function (n) {
      var name = enc.encode('out/' + n), data = enc.encode(files[n]), crc = crc32(data);
      var head = [].concat(u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(dt), u16(dd), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0));
      parts.push(new Uint8Array(head), name, data);
      central.push({ name: name, crc: crc, size: data.length, off: off });
      off += head.length + name.length + data.length;
    });
    var cstart = off, csize = 0;
    central.forEach(function (c) {
      var h = [].concat(u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(dt), u16(dd), u32(c.crc), u32(c.size), u32(c.size), u16(c.name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(c.off));
      parts.push(new Uint8Array(h), c.name); csize += h.length + c.name.length;
    });
    parts.push(new Uint8Array([].concat(u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length), u32(csize), u32(cstart), u16(0))));
    return new Blob(parts, { type: 'application/zip' });
  }

  /* ---------- 이벤트 ---------- */

  function readFile(file, cb) {
    var fr = new FileReader();
    fr.onload = function () { cb(file.name, Core.decodeBuffer(fr.result)); };
    fr.readAsArrayBuffer(file);
  }

  function init() {
    $('ver').textContent = 'v' + Core.VERSION + ' · 변경 기록은 CHANGELOG.md';
    fillProfileSelect();
    $('profile').addEventListener('change', function () {
      resetThresholdInputs();
      if (S.table) { showMatch(Core.suggestProfiles(S.table[0], S.profiles)); if (S.R) run(); }
    });
    $('file').addEventListener('change', function (e) {
      var f = e.target.files[0]; if (!f) return;
      readFile(f, function (name, text) { $('paste').value = ''; if (loadText(text, name)) run(); });
    });
    $('pfile').addEventListener('change', function (e) {
      var f = e.target.files[0]; if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var p = JSON.parse(fr.result);
          if (!p.id || !p.columns || !p.columns.input) throw new Error('id, columns.input 이 필요합니다.');
          S.profiles = S.profiles.filter(function (x) { return x.id !== p.id; }); S.profiles.push(p);
          fillProfileSelect(); $('profile').value = p.id; resetThresholdInputs();
          if (S.table) { showMatch(Core.suggestProfiles(S.table[0], S.profiles)); run(); } else setMsg('ok', '프로필 "' + esc(p.name || p.id) + '"을 추가했습니다.');
        } catch (err) { setMsg('err', '프로필 JSON을 읽지 못했습니다: ' + esc(err.message)); }
      };
      fr.readAsText(f, 'utf-8');
    });
    $('run').addEventListener('click', function () {
      var txt = $('paste').value;
      if (txt.trim()) { if (!loadText(txt, '붙여넣은 자료')) return; }
      run();
    });
    $('th-reset').addEventListener('click', function () { resetThresholdInputs(); if (S.R) run(); });
    function example(id) {
      var ex = B.examples.filter(function (e) { return e.id === id; })[0];
      if (!ex) { setMsg('err', '예시 자료를 찾지 못했습니다.'); return; }
      $('paste').value = ''; loadText(ex.text, ex.file); $('profile').value = ex.profile; resetThresholdInputs();
      showMatch(Core.suggestProfiles(S.table[0], S.profiles)); run();
    }
    $('ex-keit').addEventListener('click', function () { example('keit_2024'); });
    $('ex-other').addEventListener('click', function () { example('other_org'); });
  }

  init();
})();
