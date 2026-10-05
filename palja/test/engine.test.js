const assert = require('node:assert');
const E = require('../engine.js');
const J = require('../jobs.js');

function job(l1, l2, l3) {
  const i = J.tree.findIndex(g => g.name === l1);
  const j = J.tree[i].mids.findIndex(m => m.name === l2);
  const k = J.tree[i].mids[j].leaves.findIndex(l => l.name === l3);
  assert(i >= 0 && j >= 0 && k >= 0, 'job not found: ' + [l1, l2, l3]);
  return J.resolve(i, j, k);
}

const dev = job('IT·소프트웨어', '개발', '백엔드·서버');
const persona = { birth: 1992, entry: 2018, tier: 'mid', roleInfo: dev, startPay: 3500, curPay: 5500,
  housing: 'rent', houseValue: 1000, rent: 60, netWorth: 4000 };

let t0 = Date.now();
const r = E.analyze(persona);
const ms = Date.now() - t0;
const eok = (m) => (m / 10000).toFixed(1) + '억';
console.log('time', ms, 'ms', r.counts);
console.log('age', r.profile.age, 'saveRate', r.profile.saveRate.toFixed(3), 'locked', r.profile.locked, 'F0', r.profile.F0);
console.log('A', r.A.mid.W, eok(r.A.mid.assetsW), 'dep', r.A.mid.dep, 'free', r.A.mid.freedom, '| range', r.A.low.dep, r.A.high.dep);
console.log('mode', r.mode, 'diff', r.difficulty.toFixed(1));
r.actions.forEach(a => console.log(' -', a.label, '|', Math.round(a.dAsset), a.dDep, a.diff.toFixed(1)));
console.log('B', r.B.mid.W, eok(r.B.mid.assetsW), 'dep', r.B.mid.dep, 'free', r.B.mid.freedom, '| low', r.B.low.dep);
console.log('traces', r.traces.A.length, r.traces.B.length, r.traces.A[0], r.traces.A.at(-1), r.traces.B.at(-1));
assert(ms < 3000, 'too slow');
assert(r.B.mid.dep >= r.A.mid.dep);
// 곡선: 시작은 나이/현재 자산, 끝은 100세 이하
assert.strictEqual(r.traces.A[0][0], r.profile.age);
assert(r.traces.A.every((p, i, a) => i === 0 || p[0] >= a[i - 1][0]), 'trace ages monotonic');

const cases = [
  { name: '자가 대기업 고소득', birth: 1980, entry: 2005, tier: 'big', roleInfo: job('영업·마케팅·판매', '기업영업(B2B)', '법인영업'), startPay: 3000, curPay: 9000, housing: 'own', houseValue: 120000, netWorth: 90000 },
  { name: '사회초년 월세', birth: 2002, entry: 2026, tier: 'parttime', roleInfo: job('서비스·자영업', '음식·외식', '홀 서빙·매니저'), startPay: 2800, curPay: 2800, housing: 'rent', houseValue: 500, rent: 45, netWorth: 0 },
  { name: '전세 대출 많음', birth: 1985, entry: 2009, tier: 'shop', roleInfo: job('서비스·자영업', '음식·외식', '식당 운영'), startPay: 2200, curPay: 3600, housing: 'jeonse', houseValue: 30000, netWorth: -3000 },
  { name: '전문직', birth: 1998, entry: 2024, tier: 'pro', roleInfo: job('전문직·자격사', '의료', '의사'), startPay: 6000, curPay: 7000, housing: 'rent', houseValue: 5000, rent: 90, netWorth: 15000 },
  { name: '월세 0원(관리비만)', birth: 1990, entry: 2016, tier: 'civil', roleInfo: job('공공·행정·안전', '공무원', '일반행정직'), startPay: 2800, curPay: 4800, housing: 'rent', houseValue: 0, rent: 0, netWorth: 2000 },
];
for (const c of cases) {
  const x = E.analyze(c);
  console.log(c.name.padEnd(14), 'mode', x.mode.padEnd(8), 'A dep', x.A.mid.dep, 'B dep', x.B.mid.dep, 'free', x.B.mid.freedom, 'acts', x.actions.map(a => a.kind).join('/'), x.counts.total);
  assert(x.mode === 'settled' ? x.actions.length === 0 : (x.actions.length >= 1 && x.actions.length <= 3));
  for (const k of ['W', 'assetsW', 'dep']) assert(Number.isFinite(x.A.mid[k]) && Number.isFinite(x.B.mid[k]), k);
  assert(x.traces.A.every(p => Number.isFinite(p[1])) && x.traces.B.every(p => Number.isFinite(p[1])));
  if (c.rent === 0) assert(!x.actions.some(a => a.kind === 'house'), '월세 0이면 주거 레버 없음');
}

// 직무 분류 무결성
let leaves = 0;
J.tree.forEach(g => g.mids.forEach(m => { assert(m.leaves.length >= 1); m.leaves.forEach(l => { leaves++; assert(l.workEnd >= 35 && l.workEnd <= 70, l.name); }); }));
console.log('job leaves', leaves);
console.log('OK');
