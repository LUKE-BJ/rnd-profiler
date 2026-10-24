/* core.js - 계산 코어. 브라우저와 Node(테스트)에서 동일하게 사용한다.
 * 서버·외부 API·AI 없음. 모든 계산은 규칙 기반이며 프로필(JSON)이 기준을 정한다. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- 입력 해석 ---------- */

  // ArrayBuffer -> 문자열. UTF-8 우선, 깨지면 CP949(EUC-KR)로 다시 읽는다.
  function decodeBuffer(buf) {
    var bytes = new Uint8Array(buf);
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e) {
      return new TextDecoder('euc-kr').decode(bytes);
    }
  }

  // 따옴표·쉼표·줄바꿈을 처리하는 CSV 파서. 반환: 2차원 문자열 배열.
  function parseCSV(text) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    var rows = [], row = [], cell = '', q = false, i = 0, n = text.length;
    while (i < n) {
      var c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
          q = false; i++; continue;
        }
        cell += c; i++; continue;
      }
      if (c === '"') { q = true; i++; continue; }
      if (c === ',') { row.push(cell); cell = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
      cell += c; i++;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return !(r.length === 1 && r[0].trim() === ''); });
  }

  // 탭 구분(엑셀에서 복사·붙여넣기)도 허용한다.
  function parseTable(text) {
    var firstLine = text.split('\n')[0] || '';
    if (firstLine.indexOf('\t') >= 0 && firstLine.indexOf(',') < 0) {
      return text.split(/\r?\n/).filter(function (l) { return l.trim() !== ''; })
        .map(function (l) { return l.split('\t'); });
    }
    return parseCSV(text);
  }

  // "1,182" -> 1182. 빈 칸은 null, 숫자가 아니면 NaN.
  function toNum(s) {
    if (s === undefined || s === null) return null;
    var t = String(s).replace(/[,\s]/g, '');
    if (t === '' || t === '-') return null;
    var v = Number(t);
    return isFinite(v) ? v : NaN;
  }

  /* ---------- 통계 보조 ---------- */

  // 선형보간 분위수(exclusive 방식: 위치 = p*(n+1)). 파이썬 statistics.quantiles 기본값과 같다.
  function quantile(values, p) {
    var s = values.slice().sort(function (a, b) { return a - b; });
    var n = s.length;
    if (!n) return NaN;
    var pos = p * (n + 1);
    if (pos <= 1) return s[0];
    if (pos >= n) return s[n - 1];
    var lo = Math.floor(pos), f = pos - lo;
    return s[lo - 1] + f * (s[lo] - s[lo - 1]);
  }

  function gini(values) {
    var v = values.slice().sort(function (a, b) { return a - b; });
    var n = v.length, sum = 0, c = 0;
    for (var i = 0; i < n; i++) { sum += v[i]; c += (i + 1) * v[i]; }
    if (!n || sum === 0) return null;
    return 2 * c / (n * sum) - (n + 1) / n;
  }

  function sum(arr) { var t = 0; for (var i = 0; i < arr.length; i++) t += arr[i]; return t; }

  /* ---------- 프로필 ---------- */

  function asArray(x) { return x == null ? [] : Array.isArray(x) ? x : [x]; }

  function profileColumns(profile) {
    var c = profile.columns;
    var all = [].concat(asArray(c.year), asArray(c.group), asArray(c.label), asArray(c.count),
      asArray(c.input), asArray(c.paper), asArray(c.patent), asArray(c.aux));
    return all.filter(function (x, i) { return x && all.indexOf(x) === i; });
  }

  // 헤더와 가장 잘 맞는 프로필을 고른다. 반환: [{profile, matched, total, score}] 점수 내림차순.
  function suggestProfiles(headers, profiles) {
    var h = headers.map(function (x) { return x.trim(); });
    return profiles.map(function (p) {
      var cols = profileColumns(p);
      var matched = cols.filter(function (c) { return h.indexOf(c) >= 0; }).length;
      return { profile: p, matched: matched, total: cols.length, score: cols.length ? matched / cols.length : 0 };
    }).sort(function (a, b) { return b.score - a.score; });
  }

  var DEFAULT_TH = { typePaper: 0.65, typePatent: 0.35, flagInputTop: 0.25, flagDensityBottom: 0.40, concentrationTop: 0.10 };

  /* ---------- 본 계산 ---------- */

  // table: parseTable 결과(첫 행=헤더). 반환: {ok:false, errors} 또는 {ok:true, ...결과}
  function analyze(table, profile, opts) {
    opts = opts || {};
    var th = Object.assign({}, DEFAULT_TH, profile.thresholds || {}, opts.thresholds || {});
    var units = Object.assign({ input: '', densityPer: 10, densityLabel: '투입 단위당' }, profile.units || {});
    var C = profile.columns;
    var header = table[0].map(function (x) { return x.trim(); });
    var idx = {};
    header.forEach(function (h, i) { idx[h] = i; });

    var needed = [].concat(asArray(C.count), asArray(C.input), asArray(C.paper), asArray(C.patent), asArray(C.label));
    var missing = needed.filter(function (c) { return c && !(c in idx); });
    if (!asArray(C.input).length) return { ok: false, errors: ['프로필에 투입(input) 컬럼이 지정되어 있지 않습니다.'] };
    if (missing.length) {
      return { ok: false, errors: ['입력 자료에 없는 컬럼: ' + missing.join(', ')], missing: missing, header: header };
    }
    var optional = [].concat(asArray(C.year), asArray(C.group), asArray(C.aux)).filter(function (c) { return c && (c in idx); });

    var inputCol = asArray(C.input)[0];
    var paperCols = asArray(C.paper), patentCols = asArray(C.patent);
    var countCol = asArray(C.count)[0] || null;
    var labelCols = asArray(C.label);
    var groupCol = C.group && (C.group in idx) ? C.group : null;
    var yearCol = C.year && (C.year in idx) ? C.year : null;
    var auxCols = asArray(C.aux).filter(function (c) { return c in idx; });
    var numCols = [].concat(countCol ? [countCol] : [], [inputCol], paperCols, patentCols, auxCols);

    var badCells = 0;
    var rows = table.slice(1).map(function (r, k) {
      var o = { _no: k + 1, label: labelCols.map(function (c) { return (r[idx[c]] || '').trim(); }).join(' / '),
        group: groupCol ? (r[idx[groupCol]] || '').trim() : '', year: yearCol ? (r[idx[yearCol]] || '').trim() : '', v: {} };
      numCols.forEach(function (c) {
        var x = toNum(r[idx[c]]);
        if (x !== null && isNaN(x)) { badCells++; x = null; }
        o.v[c] = x;
      });
      o.input = o.v[inputCol] || 0;
      o.count = countCol ? (o.v[countCol] || 0) : 0;
      o.paper = sum(paperCols.map(function (c) { return o.v[c] || 0; }));
      o.patent = sum(patentCols.map(function (c) { return o.v[c] || 0; }));
      return o;
    });

    var hasPaper = paperCols.length > 0, hasPatent = patentCols.length > 0, hasBoth = hasPaper && hasPatent;
    var per = units.densityPer;

    var analyzable = rows.filter(function (r) { return r.input > 0; });
    var excluded = rows.filter(function (r) { return !(r.input > 0); });

    analyzable.forEach(function (r) {
      r.avgInput = countCol && r.count > 0 ? r.input / r.count : null;
      r.paperDensity = hasPaper ? r.paper / r.input * per : null;
      r.patentDensity = hasPatent ? r.patent / r.input * per : null;
      r.comp = (hasPaper || hasPatent) ? (r.paper + r.patent) / r.input * per : null;
      r.paperShare = null; r.type = null;
      if (hasBoth) {
        var t = r.paper + r.patent;
        if (t === 0) r.type = '성과 없음';
        else {
          r.paperShare = r.paper / t;
          r.type = r.paperShare >= th.typePaper ? '논문형' : r.paperShare <= th.typePatent ? '특허형' : '균형형';
        }
      }
      r.flag = false;
    });

    // 점검 후보: 투입 상위 N% 이면서 복합 밀도 하위 M% (유형과 독립)
    var cut = { inputHi: null, densityLo: null };
    if (analyzable.length && (hasPaper || hasPatent)) {
      cut.inputHi = quantile(analyzable.map(function (r) { return r.input; }), 1 - th.flagInputTop);
      cut.densityLo = quantile(analyzable.map(function (r) { return r.comp; }), th.flagDensityBottom);
      analyzable.forEach(function (r) { r.flag = r.input >= cut.inputHi && r.comp <= cut.densityLo; });
    }
    var flagged = analyzable.filter(function (r) { return r.flag; }).sort(function (a, b) { return b.input - a.input; });

    // 유형 분포
    var typeNames = ['논문형', '균형형', '특허형', '성과 없음'];
    var typeCount = null;
    if (hasBoth) {
      typeCount = {};
      typeNames.forEach(function (t) { typeCount[t] = 0; });
      analyzable.forEach(function (r) { typeCount[r.type]++; });
    }

    // 집중도
    var conc = null;
    if (analyzable.length) {
      var sorted = analyzable.slice().sort(function (a, b) { return b.input - a.input; });
      var k = Math.max(1, Math.round(analyzable.length * th.concentrationTop));
      var top = sorted.slice(0, k);
      var totIn = sum(sorted.map(function (r) { return r.input; }));
      var curve = [], acc = 0;
      sorted.forEach(function (r, i) { acc += r.input; curve.push([(i + 1) / sorted.length, acc / totIn]); });
      conc = {
        k: k, topShareInput: sum(top.map(function (r) { return r.input; })) / totIn,
        topSharePaper: hasPaper && sum(sorted.map(function (r) { return r.paper; })) > 0 ? sum(top.map(function (r) { return r.paper; })) / sum(sorted.map(function (r) { return r.paper; })) : null,
        topSharePatent: hasPatent && sum(sorted.map(function (r) { return r.patent; })) > 0 ? sum(top.map(function (r) { return r.patent; })) / sum(sorted.map(function (r) { return r.patent; })) : null,
        giniInput: gini(sorted.map(function (r) { return r.input; })),
        giniPatent: hasPatent ? gini(sorted.map(function (r) { return r.patent; })) : null,
        curve: curve
      };
    }

    // 집계표(그룹별)
    var groups = null;
    if (groupCol) {
      var gm = {}, order = [];
      rows.forEach(function (r) {
        var g = r.group || '(미지정)';
        if (!gm[g]) { gm[g] = { group: g, rows: 0, count: 0, input: 0, paper: 0, patent: 0 }; order.push(g); }
        var o = gm[g]; o.rows++; o.count += r.count; o.input += r.input; o.paper += r.paper; o.patent += r.patent;
      });
      groups = order.map(function (g) {
        var o = gm[g];
        o.paperDensity = hasPaper && o.input > 0 ? o.paper / o.input * per : null;
        o.patentDensity = hasPatent && o.input > 0 ? o.patent / o.input * per : null;
        o.comp = (hasPaper || hasPatent) && o.input > 0 ? (o.paper + o.patent) / o.input * per : null;
        return o;
      }).sort(function (a, b) { return b.input - a.input || (a.group < b.group ? -1 : 1); });
    }

    // 연도 추이: 연도가 2개 이상일 때만
    var years = null;
    if (yearCol) {
      var ys = {};
      rows.forEach(function (r) {
        if (!ys[r.year]) ys[r.year] = { year: r.year, rows: 0, input: 0, paper: 0, patent: 0 };
        var o = ys[r.year]; o.rows++; o.input += r.input; o.paper += r.paper; o.patent += r.patent;
      });
      var keys = Object.keys(ys).sort();
      if (keys.length >= 2) {
        years = keys.map(function (y) {
          var o = ys[y];
          o.comp = (hasPaper || hasPatent) && o.input > 0 ? (o.paper + o.patent) / o.input * per : null;
          return o;
        });
      }
    }

    // 검산: 원본 합계 = 분석 대상 + 제외, 집계표 합계 = 원본 합계
    var checks = [];
    function addCheck(name, col, key) {
      var src = sum(rows.map(function (r) { return r.v[col] || 0; }));
      var a = sum(analyzable.map(function (r) { return r.v[col] || 0; }));
      var e = sum(excluded.map(function (r) { return r.v[col] || 0; }));
      var g = groups && key ? sum(groups.map(function (o) { return o[key]; })) : null;
      checks.push({ item: name, source: src, analyzable: a, excluded: e, groupTotal: key ? g : null,
        ok: Math.abs(src - (a + e)) < 1e-9 && (g === null || Math.abs(g - src) < 1e-9) });
    }
    if (countCol) addCheck(countCol, countCol, 'count');
    addCheck(inputCol, inputCol, 'input');
    paperCols.forEach(function (c) { addCheck(c, c, null); });
    patentCols.forEach(function (c) { addCheck(c, c, null); });
    if (groups && hasPaper) {
      var s = sum(rows.map(function (r) { return r.paper; }));
      checks.push({ item: '논문 합계(' + paperCols.length + '개 컬럼)', source: s, analyzable: sum(analyzable.map(function (r) { return r.paper; })),
        excluded: sum(excluded.map(function (r) { return r.paper; })), groupTotal: sum(groups.map(function (o) { return o.paper; })),
        ok: Math.abs(s - sum(groups.map(function (o) { return o.paper; }))) < 1e-9 });
    }
    if (groups && hasPatent) {
      var s2 = sum(rows.map(function (r) { return r.patent; }));
      checks.push({ item: '특허 합계(' + patentCols.length + '개 컬럼)', source: s2, analyzable: sum(analyzable.map(function (r) { return r.patent; })),
        excluded: sum(excluded.map(function (r) { return r.patent; })), groupTotal: sum(groups.map(function (o) { return o.patent; })),
        ok: Math.abs(s2 - sum(groups.map(function (o) { return o.patent; }))) < 1e-9 });
    }

    // 이중 집계 경고: 같은 (연도, 그룹, 라벨) 조합이 두 번 이상 나오면 합계가 부풀 수 있다.
    var seen = {}, dups = 0;
    rows.forEach(function (r) {
      var key = r.year + '|' + r.group + '|' + r.label;
      if (seen[key]) dups++; else seen[key] = 1;
    });

    var excludedWithOutput = excluded.filter(function (r) { return r.paper + r.patent > 0; });
    var tot = {
      rows: rows.length, analyzable: analyzable.length, excluded: excluded.length,
      excludedWithOutput: excludedWithOutput.length,
      count: sum(rows.map(function (r) { return r.count; })),
      input: sum(rows.map(function (r) { return r.input; })),
      paper: sum(rows.map(function (r) { return r.paper; })),
      patent: sum(rows.map(function (r) { return r.patent; })),
      excludedPaper: sum(excluded.map(function (r) { return r.paper; })),
      excludedPatent: sum(excluded.map(function (r) { return r.patent; })),
      excludedCount: sum(excluded.map(function (r) { return r.count; })),
      analyzableCount: sum(analyzable.map(function (r) { return r.count; })),
      analyzableInput: sum(analyzable.map(function (r) { return r.input; })),
      analyzablePaper: sum(analyzable.map(function (r) { return r.paper; })),
      analyzablePatent: sum(analyzable.map(function (r) { return r.patent; }))
    };
    tot.avgInput = countCol && tot.analyzableCount > 0 ? tot.analyzableInput / tot.analyzableCount : null;
    tot.comp = (hasPaper || hasPatent) && tot.analyzableInput > 0 ? (tot.analyzablePaper + tot.analyzablePatent) / tot.analyzableInput * per : null;

    return {
      ok: true, profile: profile, thresholds: th, units: units,
      flags: { hasPaper: hasPaper, hasPatent: hasPatent, hasBoth: hasBoth, hasCount: !!countCol, hasGroup: !!groupCol },
      cols: { input: inputCol, count: countCol, paper: paperCols, patent: patentCols, aux: auxCols, group: groupCol, year: yearCol },
      rows: rows, analyzable: analyzable, excluded: excluded, excludedWithOutput: excludedWithOutput,
      cut: cut, flagged: flagged, typeCount: typeCount, conc: conc, groups: groups, years: years,
      checks: checks, dups: dups, badCells: badCells, totals: tot,
      allOk: checks.every(function (c) { return c.ok; }) && badCells === 0,
      disabled: [].concat(
        hasPaper ? [] : ['논문 지표(논문 컬럼 없음)'],
        hasPatent ? [] : ['특허 지표(특허 컬럼 없음)'],
        hasBoth ? [] : ['성과 유형 분류(논문·특허 컬럼이 모두 필요)'],
        countCol ? [] : ['과제당 평균 투입(과제 수 컬럼 없음)'],
        groupCol ? [] : ['그룹별 집계표(그룹 컬럼 없음)'],
        years ? [] : ['연도 추이(연도 값이 2개 미만)'])
    };
  }

  /* ---------- 내보내기 ---------- */

  function r4(x) { return x === null || x === undefined ? '' : String(Math.round(x * 1e4) / 1e4); }
  function pct(x, d) { return x === null || x === undefined ? '-' : (x * 100).toFixed(d === undefined ? 1 : d) + '%'; }
  function num(x) { return x === null || x === undefined ? '-' : Number(x).toLocaleString('en-US', { maximumFractionDigits: 2 }); }
  function csvCell(v) {
    var s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV(header, lines) {
    return '﻿' + [header].concat(lines).map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n';
  }
  function mdCell(s) { return String(s).replace(/\|/g, '\\|'); }

  function buildOutputs(R, meta) {
    meta = meta || {};
    var f = R.flags, cols = R.cols, per = R.units.densityLabel;
    var files = {};

    // metrics.csv
    var mh = ['연도', '그룹', '항목', '과제수', '투입(' + R.units.input + ')'];
    if (f.hasPaper) mh.push('논문');
    if (f.hasPatent) mh.push('특허');
    mh.push('과제당 평균 투입');
    if (f.hasPaper) mh.push('논문 밀도');
    if (f.hasPatent) mh.push('특허 밀도');
    if (f.hasPaper || f.hasPatent) mh.push('복합 밀도');
    if (f.hasBoth) { mh.push('논문 비중'); mh.push('유형'); }
    mh.push('점검 후보');
    files['metrics.csv'] = toCSV(mh, R.analyzable.map(function (r) {
      var x = [r.year, r.group, r.label, r.count, r.input];
      if (f.hasPaper) x.push(r.paper);
      if (f.hasPatent) x.push(r.patent);
      x.push(r4(r.avgInput));
      if (f.hasPaper) x.push(r4(r.paperDensity));
      if (f.hasPatent) x.push(r4(r.patentDensity));
      if (f.hasPaper || f.hasPatent) x.push(r4(r.comp));
      if (f.hasBoth) { x.push(r4(r.paperShare)); x.push(r.type); }
      x.push(r.flag ? 'Y' : '');
      return x;
    }));

    // flags.csv
    var fh = ['연도', '그룹', '항목', '과제수', '투입(' + R.units.input + ')'];
    if (f.hasPaper) fh.push('논문');
    if (f.hasPatent) fh.push('특허');
    fh.push('복합 밀도');
    files['flags.csv'] = toCSV(fh, R.flagged.map(function (r) {
      var x = [r.year, r.group, r.label, r.count, r.input];
      if (f.hasPaper) x.push(r.paper);
      if (f.hasPatent) x.push(r.patent);
      x.push(r4(r.comp));
      return x;
    }));

    // excluded
    var eh = ['연도', '그룹', '항목', '과제수', '투입(' + R.units.input + ')'];
    if (f.hasPaper) eh.push('논문');
    if (f.hasPatent) eh.push('특허');
    files['excluded_zero_funding.csv'] = toCSV(eh, R.excluded.map(function (r) {
      var x = [r.year, r.group, r.label, r.count, r.input];
      if (f.hasPaper) x.push(r.paper);
      if (f.hasPatent) x.push(r.patent);
      return x;
    }));

    // groups.csv
    if (R.groups) {
      var gh = ['그룹', '행 수', '과제수', '투입(' + R.units.input + ')'];
      if (f.hasPaper) gh.push('논문');
      if (f.hasPatent) gh.push('특허');
      if (f.hasPaper) gh.push('논문 밀도');
      if (f.hasPatent) gh.push('특허 밀도');
      if (f.hasPaper || f.hasPatent) gh.push('복합 밀도');
      files['groups.csv'] = toCSV(gh, R.groups.map(function (o) {
        var x = [o.group, o.rows, o.count, o.input];
        if (f.hasPaper) x.push(o.paper);
        if (f.hasPatent) x.push(o.patent);
        if (f.hasPaper) x.push(r4(o.paperDensity));
        if (f.hasPatent) x.push(r4(o.patentDensity));
        if (f.hasPaper || f.hasPatent) x.push(r4(o.comp));
        return x;
      }));
    }

    // check.csv
    files['check.csv'] = toCSV(['검산 항목', '원본 합계', '분석 대상 합계', '제외 합계', '집계표 합계', '결과'],
      R.checks.map(function (c) { return [c.item, c.source, c.analyzable, c.excluded, c.groupTotal === null ? '' : c.groupTotal, c.ok ? '일치' : '불일치']; }));

    // run_meta.json (결정적 출력을 위해 시각은 meta로 받을 때만 기록)
    var rm = {
      tool: 'rnd-profiler', profile: R.profile.id, profile_name: R.profile.name,
      input_file: meta.inputName || null, rows: R.totals.rows, analyzable_rows: R.totals.analyzable, excluded_rows: R.totals.excluded,
      thresholds: R.thresholds, cutoffs: { input_ge: R.cut.inputHi, density_le: R.cut.densityLo },
      all_checks_ok: R.allOk, disabled_features: R.disabled
    };
    if (meta.generatedAt) rm.generated_at = meta.generatedAt;
    files['run_meta.json'] = JSON.stringify(rm, null, 2) + '\n';

    files['summary.md'] = buildSummary(R, meta);
    return files;
  }

  function buildSummary(R, meta) {
    var f = R.flags, t = R.totals, u = R.units.input, L = [];
    L.push('# R&D 성과구조 진단 요약');
    L.push('');
    L.push('- 프로필: ' + R.profile.name + ' (`' + R.profile.id + '`)');
    if (meta.inputName) L.push('- 입력 파일: ' + meta.inputName);
    L.push('- 성격: 탐색적 선별 자료이며 순위·평가가 아닙니다. 아래 한계 항목을 함께 읽어야 합니다.');
    L.push('');
    L.push('## 1. 검산');
    L.push('');
    L.push('| 항목 | 원본 합계 | 분석 대상 | 제외 | 집계표 | 결과 |');
    L.push('|---|---:|---:|---:|---:|---|');
    R.checks.forEach(function (c) {
      L.push('| ' + mdCell(c.item) + ' | ' + num(c.source) + ' | ' + num(c.analyzable) + ' | ' + num(c.excluded) + ' | ' + (c.groupTotal === null ? '-' : num(c.groupTotal)) + ' | ' + (c.ok ? '일치' : '**불일치**') + ' |');
    });
    L.push('');
    L.push('- 전체 ' + t.rows + '행 중 분석 대상 ' + t.analyzable + '행, 투입 0 또는 빈 칸으로 제외 ' + t.excluded + '행(이 중 성과가 있는 행 ' + t.excludedWithOutput + '행).');
    L.push('- 이중 집계 의심(같은 연도·그룹·항목 중복): ' + R.dups + '건. 숫자로 읽히지 않은 칸: ' + R.badCells + '개.');
    L.push('');
    L.push('## 2. 규모');
    L.push('');
    L.push('- 분석 대상 투입 합계: ' + num(t.analyzableInput) + u + (f.hasCount ? ', 과제 ' + num(t.analyzableCount) + '건, 과제당 평균 ' + num(t.avgInput) + u : ''));
    if (f.hasPaper) L.push('- 논문 합계(분석 대상): ' + num(t.analyzablePaper) + '건');
    if (f.hasPatent) L.push('- 특허 합계(분석 대상): ' + num(t.analyzablePatent) + '건');
    if (t.comp !== null) L.push('- 전체 복합 밀도: ' + R.units.densityLabel + ' ' + num(t.comp) + '건');
    L.push('');
    if (R.typeCount) {
      L.push('## 3. 성과 유형 분포');
      L.push('');
      L.push('논문 비중 ≥ ' + pct(R.thresholds.typePaper, 0) + ' 논문형, ≤ ' + pct(R.thresholds.typePatent, 0) + ' 특허형, 그 사이 균형형.');
      L.push('');
      L.push('| 유형 | 행 수 | 비율 |');
      L.push('|---|---:|---:|');
      Object.keys(R.typeCount).forEach(function (k) {
        L.push('| ' + k + ' | ' + R.typeCount[k] + ' | ' + pct(R.typeCount[k] / t.analyzable) + ' |');
      });
      L.push('');
    }
    if (R.conc) {
      L.push('## 4. 집중도');
      L.push('');
      L.push('- 투입 상위 ' + pct(R.thresholds.concentrationTop, 0) + '(' + R.conc.k + '행)의 투입 비중: ' + pct(R.conc.topShareInput));
      if (R.conc.topSharePaper !== null) L.push('- 같은 행들의 논문 비중: ' + pct(R.conc.topSharePaper));
      if (R.conc.topSharePatent !== null) L.push('- 같은 행들의 특허 비중: ' + pct(R.conc.topSharePatent));
      L.push('- 지니계수(투입): ' + (R.conc.giniInput === null ? '-' : R.conc.giniInput.toFixed(3)) + (R.conc.giniPatent !== null ? ', (특허): ' + R.conc.giniPatent.toFixed(3) : ''));
      L.push('');
    }
    if (R.cut.inputHi !== null) {
      L.push('## 5. 점검 후보');
      L.push('');
      L.push('기준: 투입 상위 ' + pct(R.thresholds.flagInputTop, 0) + '(≥ ' + num(R.cut.inputHi) + u + ') 이면서 복합 밀도 하위 ' + pct(R.thresholds.flagDensityBottom, 0) + '(≤ ' + num(R.cut.densityLo) + '). 부실 판정이 아니라 추가 확인 대상입니다.');
      L.push('');
      if (R.flagged.length) {
        L.push('| 그룹 | 항목 | 투입(' + u + ') | 논문 | 특허 | 복합 밀도 |');
        L.push('|---|---|---:|---:|---:|---:|');
        R.flagged.forEach(function (r) {
          L.push('| ' + mdCell(r.group) + ' | ' + mdCell(r.label) + ' | ' + num(r.input) + ' | ' + num(r.paper) + ' | ' + num(r.patent) + ' | ' + num(r.comp) + ' |');
        });
      } else L.push('해당 행 없음.');
      L.push('');
    }
    if (R.years) {
      L.push('## 6. 연도 추이');
      L.push('');
      L.push('| 연도 | 행 수 | 투입(' + u + ') | 논문 | 특허 | 복합 밀도 |');
      L.push('|---|---:|---:|---:|---:|---:|');
      R.years.forEach(function (y) { L.push('| ' + y.year + ' | ' + y.rows + ' | ' + num(y.input) + ' | ' + num(y.paper) + ' | ' + num(y.patent) + ' | ' + num(y.comp) + ' |'); });
      L.push('');
    }
    if (R.disabled.length) { L.push('## 자동으로 꺼진 기능'); L.push(''); R.disabled.forEach(function (d) { L.push('- ' + d); }); L.push(''); }
    L.push('## 해석상 한계');
    L.push('');
    L.push('- 성과는 투입 이후 시차를 두고 나타나므로 같은 해 투입과 성과를 곧바로 대응시키면 왜곡될 수 있습니다.');
    L.push('- 사업 목적(원천·사업화·인프라 등)이 달라 논문·특허 밀도를 사업 간 우열로 읽을 수 없습니다.');
    L.push('- 집계 자료이므로 개별 과제의 성과를 추정할 수 없습니다. 투입 0 행은 지표 계산에서 제외했습니다.');
    L.push('- 입력 자료가 다루는 범위(기관·사업·연도)만 해당하며 국가 R&D 전체를 대표하지 않습니다.');
    L.push('');
    return L.join('\n');
  }

  return {
    decodeBuffer: decodeBuffer, parseCSV: parseCSV, parseTable: parseTable, toNum: toNum,
    quantile: quantile, gini: gini, profileColumns: profileColumns, suggestProfiles: suggestProfiles,
    analyze: analyze, buildOutputs: buildOutputs, toCSV: toCSV, DEFAULT_TH: DEFAULT_TH,
    fmt: { num: num, pct: pct, r4: r4 }
  };
});
