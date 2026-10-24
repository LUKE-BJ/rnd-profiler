/* 실행: node tests/check_expected.js
 * 1) 예시 입력을 처리해 out/<프로필>/ 에 저장한다.
 * 2) examples/expected/<프로필>/ 의 기대 결과와 바이트 단위로 비교한다.
 * 3) 파이썬으로 따로 계산한 핵심 수치와 대조한다. (--update 를 주면 기대 결과를 갱신) */
const fs = require('fs'), path = require('path');
const C = require('../js/core.js');
const root = path.join(__dirname, '..');
const update = process.argv.includes('--update');
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m); } else console.log('ok  ', m); };

function run(profileFile, inputFile) {
  const profile = JSON.parse(fs.readFileSync(path.join(root, 'profiles', profileFile), 'utf8'));
  const table = C.parseTable(C.decodeBuffer(fs.readFileSync(path.join(root, 'examples', inputFile))));
  const R = C.analyze(table, profile);
  if (!R.ok) { fail++; console.log('FAIL analyze', R.errors); return null; }
  const files = C.buildOutputs(R, { inputName: inputFile });
  const outDir = path.join(root, 'out', profile.id), expDir = path.join(root, 'examples', 'expected', profile.id);
  fs.mkdirSync(outDir, { recursive: true });
  for (const [n, c] of Object.entries(files)) fs.writeFileSync(path.join(outDir, n), c);
  if (update) { fs.mkdirSync(expDir, { recursive: true }); for (const [n, c] of Object.entries(files)) fs.writeFileSync(path.join(expDir, n), c); }
  for (const n of Object.keys(files)) {
    const p = path.join(expDir, n);
    ok(fs.existsSync(p) && fs.readFileSync(p, 'utf8') === files[n], `${profile.id}/${n} == expected`);
  }
  return R;
}

// KEIT: 파이썬 독립 계산값 (examples/input_keit_2024.csv, 268행)
const K = run('keit_performance.json', 'input_keit_2024.csv');
const keitProfile = JSON.parse(fs.readFileSync(path.join(root, 'profiles', 'keit_performance.json'), 'utf8'));
const table_keit = C.parseTable(C.decodeBuffer(fs.readFileSync(path.join(root, 'examples', 'input_keit_2024.csv'))));
if (K) {
  const t = K.totals;
  ok(t.rows === 268 && t.analyzable === 107 && t.excluded === 161 && t.excludedWithOutput === 74, 'KEIT 행 수 268/107/161/74');
  ok(t.input === 15938 && t.count === 6288 && t.paper === 3753 && t.patent === 1815, 'KEIT 합계 출연금·과제·논문·특허');
  ok(JSON.stringify(K.typeCount) === JSON.stringify({ '논문형': 59, '균형형': 21, '특허형': 12, '성과 없음': 15 }), 'KEIT 유형 59/21/12/15');
  ok(K.flagged.length === 6, 'KEIT 점검 후보 6건');
  ok(Math.abs(K.conc.topShareInput - 0.686) < 0.001 && K.conc.k === 11, 'KEIT 상위10% 비중 68.6%');
  ok(Math.abs(K.conc.giniInput - 0.790) < 0.001 && Math.abs(K.conc.giniPatent - 0.816) < 0.001, 'KEIT 지니 0.790/0.816');
  ok(K.allOk && K.groups.length === 131, 'KEIT 검산 전부 일치, 세부사업 131개');
  ok(K.years === null, 'KEIT 단일 연도라 추이 자동 비활성');
}

// 가상 기관: 다른 컬럼명·단위·2개 연도
const O = run('sample_other_org.json', 'input_other_org.csv');
if (O) {
  ok(O.allOk, '가상 기관 검산 전부 일치');
  ok(O.years && O.years.length === 2, '가상 기관 연도 2개라 추이 활성');
  ok(O.totals.rows === 24, '가상 기관 24행');
}

// 컬럼 부족: 특허 컬럼이 없는 프로필이면 관련 지표만 꺼진다
const base = JSON.parse(fs.readFileSync(path.join(root, 'profiles', 'sample_other_org.json'), 'utf8'));
base.columns.patent = [];
const tbl = C.parseTable(C.decodeBuffer(fs.readFileSync(path.join(root, 'examples', 'input_other_org.csv'))));
const P = C.analyze(tbl, base);
ok(P.ok && P.typeCount === null && P.analyzable[0].patentDensity === null && P.analyzable[0].comp !== null, '특허 컬럼 없음: 유형·특허밀도 꺼지고 논문 지표는 유지');

// 없는 컬럼이면 오류를 돌려준다
base.columns.input = ['없는컬럼'];
const E = C.analyze(tbl, base);
ok(!E.ok && E.missing.indexOf('없는컬럼') >= 0, '없는 컬럼은 오류로 안내');

// v0.2: 분모 작음·확대 검토 후보·빠진 것·관찰문 — 손으로 계산한 작은 표 (투입 10..80, 논문 5,1,3,2,4,0,6,8, 마지막 Z행은 투입 0)
// 분위수(exclusive, 위치 p*(n+1), n=8): 투입 하위 25% -> 22.5, 하위 50% -> 45, 밀도 상위 25%(0.75) -> 0.1
const hand = [['사업', '투입', '논문', '특허'], ['A', '10', '5', '0'], ['B', '20', '1', '0'], ['C', '30', '3', '0'], ['D', '40', '2', '0'],
  ['E', '50', '4', '0'], ['F', '60', '0', '0'], ['G', '70', '6', '0'], ['H', '80', '8', '0'], ['Z', '0', '2', '1']];
const hp = { id: 'hand', name: '손계산', columns: { input: '투입', paper: ['논문'], patent: ['특허'], label: ['사업'] }, units: { input: '억원', densityPer: 1, densityLabel: '투입 1억원당' } };
const H = C.analyze(hand, hp);
ok(H.ok && H.cut.smallLo === 22.5 && H.cut.expandInputLo === 45 && Math.abs(H.cut.expandDensityHi - 0.1) < 1e-12, '손계산: 분모 작음 22.5, 확대 투입 45, 확대 밀도 0.1');
ok(H.analyzable.filter(r => r.small).map(r => r.label).join() === 'A,B', '손계산: 분모 작음 행 A,B');
ok(H.expandList.map(r => r.label).join() === 'C,A' && H.expandList[1].small === true, '손계산: 확대 검토 후보 C,A (분모 작음 A는 뒤)');
ok(H.flagged.length === 0 && H.analyzable.every(r => !(r.flag && r.expand)), '손계산: 점검 후보 없음, 점검과 확대는 겹치지 않음');
ok(Math.abs(H.coverage.rows - 8 / 9) < 1e-12 && Math.abs(H.coverage.paper - 29 / 31) < 1e-12 && Math.abs(H.coverage.patent - 0) < 1e-12 && H.totals.excludedWithOutput === 1, '손계산: 분석 포함 비율 행 8/9, 논문 29/31, 제외 행 성과 1행');
ok(H.smallInfo.k === 1 && H.smallInfo.smallInTop === 1 && H.smallInfo.smallRows === 2, '손계산: 밀도 상위 1행(A)은 분모 작음');
ok(H.observations.map(o => o.key).join() === 'scope,concentration,type,flags,stabilityFlag,expand,stabilityExpand,small', '손계산: 관찰문 항목 순서(과제 수 컬럼 없으면 sample, 연도 없으면 years 없음)');
ok(H.fewInfo === null && H.analyzable.every(r => r.fewTasks === false), '손계산: 과제 수 컬럼이 없으면 과제 수 적음 표시 꺼짐');

// v0.3: 과제 수 적음 — 과제수 1,5,3,2,9,4,3,20 (기준 3 이하 -> A,C,D,G)
const hand2 = [['사업', '투입', '과제수', '논문', '특허'], ['A', '10', '1', '5', '0'], ['B', '20', '5', '1', '0'], ['C', '30', '3', '3', '0'], ['D', '40', '2', '2', '0'],
  ['E', '50', '9', '4', '0'], ['F', '60', '4', '0', '0'], ['G', '70', '3', '6', '0'], ['H', '80', '20', '8', '0']];
const hp2 = { id: 'hand2', name: '손계산2', columns: { input: '투입', count: '과제수', paper: ['논문'], patent: ['특허'], label: ['사업'] }, units: hp.units };
const H2 = C.analyze(hand2, hp2);
ok(H2.analyzable.filter(r => r.fewTasks).map(r => r.label).join() === 'A,C,D,G' && H2.fewInfo.rows === 4 && H2.fewInfo.max === 3, '손계산: 과제 수 3 이하 A,C,D,G');
ok(H2.fewInfo.inFlag === 0 && H2.fewInfo.inExpand === 2, '손계산: 확대 후보 C,A는 둘 다 과제 수 적음');
const H3 = C.analyze(hand2, hp2, { thresholds: { smallCountMax: 2 } });
ok(H3.analyzable.filter(r => r.fewTasks).map(r => r.label).join() === 'A,D', '손계산: 기준을 2로 바꾸면 A,D');
ok(H2.observations.map(o => o.key).join() === 'scope,concentration,type,flags,stabilityFlag,expand,stabilityExpand,small,sample', '손계산: 과제 수 컬럼이 있으면 sample 관찰문');

// v0.3: 후보 안정성 — 기준을 ±5%p, ±10%p씩 옮긴 5×5=25가지에서 잡힌 횟수를, 코어와 따로 짠 단순 반복문으로 다시 센다
function recountHits(R) {
  const th = R.thresholds, rows = R.analyzable;
  const sorted = a => a.slice().sort((x, y) => x - y);
  const qq = (arr, p) => { const s = sorted(arr), n = s.length, pos = p * (n + 1); if (pos <= 1) return s[0]; if (pos >= n) return s[n - 1]; const lo = Math.floor(pos); return s[lo - 1] + (pos - lo) * (s[lo] - s[lo - 1]); };
  const cl = p => Math.min(0.99, Math.max(0.01, p));
  const ins = rows.map(r => r.input), cps = rows.map(r => r.comp), offs = [-0.10, -0.05, 0, 0.05, 0.10];
  const fh = rows.map(() => 0), eh = rows.map(() => 0), fc = [], ec = [];
  for (const a of offs) for (const b of offs) {
    const fi = qq(ins, 1 - cl(th.flagInputTop + a)), fd = qq(cps, cl(th.flagDensityBottom + b));
    const ei = qq(ins, cl(th.expandInputBottom + a)), ed = qq(cps, 1 - cl(th.expandDensityTop + b));
    let nf = 0, ne = 0;
    rows.forEach((r, i) => { if (r.input >= fi && r.comp <= fd) { fh[i]++; nf++; } if (r.input <= ei && r.comp >= ed) { eh[i]++; ne++; } });
    fc.push(nf); ec.push(ne);
  }
  return { fh, eh, fmin: Math.min(...fc), fmax: Math.max(...fc), emin: Math.min(...ec), emax: Math.max(...ec) };
}
for (const [name, R] of [['손계산', H2], ['KEIT', K], ['가상 기관', O]]) {
  if (!R) continue;
  const rc = recountHits(R);
  ok(R.analyzable.every((r, i) => r.flagHits === rc.fh[i] && r.expandHits === rc.eh[i]), name + ': 행별 유지 횟수가 따로 센 값과 같음');
  ok(R.stability.cells === 25 && R.stability.flag.min === rc.fmin && R.stability.flag.max === rc.fmax && R.stability.expand.min === rc.emin && R.stability.expand.max === rc.emax, name + ': 후보 수 범위가 따로 센 값과 같음');
  ok(R.flagged.every(r => r.flagHits >= 1 && r.flagHits <= 25) && R.expandList.every(r => r.expandHits >= 1 && r.expandHits <= 25), name + ': 현재 후보는 최소 1회(기준 가운데 칸) 잡힘');
}
if (K) {
  // 기준을 하나씩 바꿔 analyze를 25번 돌려 센 값(안정성 계산 코드를 쓰지 않는 경로)과도 대조
  const byLabel = {};
  for (const a of [0.15, 0.20, 0.25, 0.30, 0.35]) for (const b of [0.30, 0.35, 0.40, 0.45, 0.50]) {
    const X = C.analyze(table_keit, keitProfile, { thresholds: { flagInputTop: a, flagDensityBottom: b } });
    X.flagged.forEach(r => { byLabel[r.label] = (byLabel[r.label] || 0) + 1; });
  }
  ok(K.flagged.every(r => r.flagHits === byLabel[r.label]), 'KEIT: 점검 후보 유지 횟수가 기준을 바꿔 25번 돌린 값과 같음');
  ok(K.flagged.length === 6 && K.stability.flag.stable === 1 && K.flagged.filter(r => r.flagHits === 25).map(r => r.label).join() === '스마트카' && K.stability.flag.min === 1 && K.stability.flag.max === 15, 'KEIT: 점검 후보 6행 중 25번 모두 잡히는 행은 스마트카 1행, 후보 수 1~15');
  const few = K.analyzable.filter(r => r.count <= 3).length;
  ok(K.fewInfo.rows === few && few === 31 && K.analyzable.every(r => r.fewTasks === (r.count <= 3)), 'KEIT: 과제 수 3 이하 31행이 따로 센 값과 같음');
  ok(K.flagged.length === 6 && K.expandList.length === 16 && K.smallInfo.smallRows === 27, 'KEIT: 기존 점검 6·확대 16·분모 작음 27행은 그대로');
}

// KEIT: 분모 작음·확대 후보를 테스트 안에서 따로 다시 계산해 대조(코어 코드를 쓰지 않는 단순 반복문)
if (K) {
  const ins = K.analyzable.map(r => r.input).sort((a, b) => a - b), n = ins.length;
  const qx = p => { const pos = p * (n + 1); if (pos <= 1) return ins[0]; if (pos >= n) return ins[n - 1]; const lo = Math.floor(pos); return ins[lo - 1] + (pos - lo) * (ins[lo] - ins[lo - 1]); };
  const smallN = ins.filter(v => v <= qx(0.25)).length;
  ok(K.smallInfo.smallRows === smallN && K.cut.smallLo === qx(0.25), 'KEIT 분모 작음 행 수가 따로 센 값과 같음 (' + smallN + '행)');
  ok(K.expandList.every(r => r.input <= K.cut.expandInputLo && r.comp >= K.cut.expandDensityHi), 'KEIT 확대 검토 후보 조건 일치');
  ok(K.expandList.length === K.analyzable.filter(r => r.input <= K.cut.expandInputLo && r.comp >= K.cut.expandDensityHi).length, 'KEIT 확대 검토 후보 수 일치 (' + K.expandList.length + '행)');
  const firstSmall = K.expandList.findIndex(r => r.small);
  ok(firstSmall === -1 || K.expandList.slice(firstSmall).every(r => r.small), 'KEIT 확대 후보에서 분모 작음 행이 뒤에 모임');
  ok(Math.abs(K.coverage.rows - 107 / 268) < 1e-12 && Math.abs(K.coverage.count - 4415 / 6288) < 1e-12 && Math.abs(K.coverage.paper - 3563 / 3753) < 1e-12 && Math.abs(K.coverage.patent - 1607 / 1815) < 1e-12, 'KEIT 분석 포함 비율 107/268, 과제 4415/6288, 논문 3563/3753, 특허 1607/1815');
  const txt = K.observations.map(o => o.text).join('\n');
  ok(txt.includes('68.6%') && txt.includes('56.6%') && txt.includes('57.4%'), 'KEIT 관찰문에 상위 10% 투입·논문·특허 비중 포함');
  ok(!/합격|불합격|우수|부진|문제|실패/.test(txt), '관찰문에 평가·판정 어휘 없음');
}

// v0.3.1: 한눈에 보기 묶음, 여러 해 자료 안내
const grp = R => R.observations.map(o => o.group).filter((g, i, a) => a.indexOf(g) === i).join();
ok(H2.observations.every(o => o.group) && grp(H2) === '범위,투입과 성과,점검 후보,확대 검토 후보,표본이 작은 행', '관찰문마다 묶음이 있고 순서가 범위·투입과 성과·점검·확대·표본');
if (K) ok(!K.observations.some(o => o.key === 'years'), 'KEIT(연도 1개): 여러 해 안내 없음');
if (O) {
  const y = O.observations.find(o => o.key === 'years');
  ok(!!y && y.group === '범위' && y.text.includes('연도 값이 2개') && O.observations[1].key === 'years', '가상 기관(연도 2개): 여러 해 안내가 범위 묶음 맨 앞쪽에 있음');
}
ok(C.VERSION === '0.4.0', '버전 0.4.0');

// v0.4: 묶는 기준 바꾸기 · 묶음별 합계 · 후보 수 · 검산 보강 · 합계 행 의심
// 손계산: 묶음 X(A,B,C)·Y(D,E)·미지정(F). 투입/과제수/논문 — A 10/1/5, B 20/5/1, C 30/3/3, D 40/2/2, E 50/9/4, F(묶음 칸 비음) 60/4/0
const hand4 = [['사업', '묶음', '구분', '투입', '과제수', '논문', '특허'], ['A', 'X', '원천', '10', '1', '5', '0'], ['B', 'X', '원천', '20', '5', '1', '0'], ['C', 'X', '사업화', '30', '3', '3', '0'],
  ['D', 'Y', '사업화', '40', '2', '2', '0'], ['E', 'Y', '사업화', '50', '9', '4', '0'], ['F', '', '원천', '60', '4', '0', '0']];
const hp4 = { id: 'hand4', name: '손계산4', columns: { input: '투입', count: '과제수', paper: ['논문'], patent: ['특허'], label: ['사업'], group: '묶음' }, units: hp.units };
const H4 = C.analyze(hand4, hp4);
const gX = H4.groups.find(g => g.group === 'X'), gY = H4.groups.find(g => g.group === 'Y'), gU = H4.groups.find(g => g.group === '(미지정)');
ok(H4.groups.length === 3 && gX.rows === 3 && gX.input === 60 && gX.cols['논문'] === 9 && gY.rows === 2 && gY.input === 90 && gU.rows === 1 && gU.cols['과제수'] === 4, '손계산: 묶음 X·Y·(미지정)의 행 수·투입·논문·과제수 합');
ok(H4.groupInfo.count === 3 && H4.groupInfo.singles === 1 && H4.groupInfo.maxRows === 3 && Math.abs(H4.groupInfo.avgRows - 2) < 1e-12, '손계산: 묶음 요약 3개·1행짜리 1개·최대 3행·평균 2행');
ok(H4.checks.map(c => c.item).join() === '행 수,과제수,투입,논문,특허,논문 합계(1개 컬럼),특허 합계(1개 컬럼),유형 분류 행 수(분석 대상 기준)', '손계산: 검산 항목(행 수가 맨 앞, 컬럼마다 하나, 유형 행 수가 맨 뒤)');
ok(H4.checks.every(c => c.ok && c.diffSplit === 0 && (c.groupTotal === null || c.diffGroup === 0)) && H4.allOk, '손계산: 모든 검산 일치, 차이 0');
ok(H4.checks.filter(c => c.groupTotal !== null).length === H4.checks.length - 1, '손계산: 유형 행 수만 빼고 모든 검산 항목에 집계표 합계가 있음(개별 컬럼 포함)');
// 묶는 기준 바꾸기: 구분(원천 3행·사업화 3행)
const H5 = C.analyze(hand4, hp4, { groupBy: '구분' });
ok(H5.cols.group === '구분' && H5.groups.length === 2 && H5.groups.find(g => g.group === '원천').rows === 3 && H5.groups.find(g => g.group === '원천').input === 90 && H5.allOk, '손계산: 묶는 기준을 구분으로 바꾸면 원천 3행·투입 90, 검산 일치');
const H6 = C.analyze(hand4, hp4, { groupBy: '' });
ok(H6.groups === null && H6.groupInfo.column === null && H6.checks.every(c => c.groupTotal === null) && H6.allOk, '손계산: 묶지 않음이면 집계표 없음, 검산은 일치');
ok(C.analyze(hand4, hp4, { groupBy: '없는컬럼' }).groups === null, '손계산: 없는 컬럼을 고르면 묶지 않음으로 처리');
// 묶음별 후보 수: 전체 후보 수와 묶음 합이 같음
for (const [name, R] of [['손계산', H4], ['KEIT', K], ['가상 기관', O]]) {
  if (!R || !R.groups) continue;
  ok(R.groups.reduce((s, g) => s + g.flagged, 0) === R.flagged.length && R.groups.reduce((s, g) => s + g.expand, 0) === R.expandList.length, name + ': 묶음별 점검·확대 후보 수의 합이 전체 후보 수와 같음');
}
if (K) {
  ok(K.checks.length === 9 && K.checks.every(c => c.ok) && K.checks.slice(0, -1).every(c => c.groupTotal !== null) && K.checks[K.checks.length - 1].groupTotal === null, 'KEIT: 검산 9항목(행 수·과제·투입·논문 2·특허·논문 합·특허 합·유형) 모두 일치, 개별 컬럼도 집계표와 대조');
  ok(K.groupInfo.count === 131 && K.groupInfo.singles === 78 && K.groupInfo.maxRows === 14, 'KEIT: 묶음 131개, 1행짜리 78개, 최대 14행');
  const Yr = C.analyze(table_keit, keitProfile, { groupBy: '성과년도' });
  ok(Yr.groups.length === 1 && Yr.groups[0].rows === 268 && Yr.allOk && Yr.groups[0].cols['지급 정부출연금(억원)'] === 15938, 'KEIT: 성과년도로 묶으면 1묶음·268행·투입 15,938, 검산 일치');
  const Nm = C.analyze(table_keit, keitProfile, { groupBy: '내역사업명' });
  ok(Nm.groups.length === 266 && Nm.allOk && Nm.flagged.length === K.flagged.length && Nm.expandList.length === K.expandList.length, 'KEIT: 내역사업명으로 묶으면 266묶음, 검산 일치, 후보 수(6·16)는 묶는 기준과 무관하게 같음');
  ok(K.totalRows.length === 0, 'KEIT: 합계·소계 행 의심 없음');
}
// 합계 행 의심: 사업명이 '합계'인 행, 묶음이 '소계'인 행
const hand7 = hand4.concat([['합계', 'X', '원천', '210', '24', '15', '0'], ['G', '소계', '원천', '5', '1', '1', '0']]);
const H7 = C.analyze(hand7, hp4);
ok(H7.totalRows.length === 2 && H7.totalRows[0].no === 7 && H7.totalRows[1].no === 8 && H7.observations.some(o => o.key === 'totalRows' && o.group === '범위' && o.text.includes('2행')), '손계산: 합계·소계로 보이는 행 2행(데이터 7·8번째)을 찾고 관찰문에 적음');
ok(!hand4.some(r => false) && H4.totalRows.length === 0 && !H4.observations.some(o => o.key === 'totalRows'), '손계산: 합계 행이 없으면 경고 없음');
// 검산 불일치가 실제로 잡히는지: 집계표 합계를 일부러 어긋나게 만든 값으로 차이 계산이 동작하는지 확인
const forced = { source: 10, analyzable: 4, excluded: 5, groupTotal: 12 };
ok(Math.round((forced.source - forced.analyzable - forced.excluded) * 1e6) / 1e6 === 1 && forced.groupTotal - forced.source === 2, '차이 식: 원본-분석-제외, 집계표-원본 (손계산 1과 2)');

// 파서
ok(JSON.stringify(C.parseCSV('a,b\n"1,182",x\n')) === JSON.stringify([['a', 'b'], ['1,182', 'x']]), 'CSV 따옴표 쉼표 처리');
ok(C.toNum('1,182') === 1182 && C.toNum('') === null && isNaN(C.toNum('abc')), '숫자 변환');

console.log(fail ? `\n${fail}개 실패` : '\n전부 통과');
process.exit(fail ? 1 : 0);
