const assert = require('node:assert');
const E = require('../engine.js');

const persona = { birth: 1992, entry: 2018, tier: 'mid', role: 'dev', startPay: 3500, curPay: 5500, housing: 'rent', netWorth: 4000 };

let t0 = Date.now();
const r = E.analyze(persona);
const ms = Date.now() - t0;
const f = (x) => (x.assetsW / 10000).toFixed(1) + '억';
console.log('time', ms, 'ms', r.counts);
console.log('age', r.profile.age, 'saveRate', r.profile.saveRate.toFixed(3), 'cagr', (r.profile.cagr*100).toFixed(2), 'real', (r.profile.realCagr*100).toFixed(2));
console.log('A mid', r.A.mid.W, f(r.A.mid), 'dep', r.A.mid.dep, 'free', r.A.mid.freedom, '| low dep', r.A.low.dep, 'high dep', r.A.high.dep);
console.log('mode', r.mode, 'diff', r.difficulty.toFixed(1));
r.actions.forEach(a => console.log(' -', a.label, 'dAsset', Math.round(a.dAsset), 'dDep', a.dDep, 'diff', a.diff.toFixed(1)));
console.log('B mid', r.B.mid.W, f(r.B.mid), 'dep', r.B.mid.dep, 'free', r.B.mid.freedom, '| low dep', r.B.low.dep, 'high dep', r.B.high.dep);
console.log('delay', r.delay);
console.log('diag', JSON.stringify(r.diag));

assert(ms < 3000, 'too slow');
assert(r.B.mid.dep >= r.A.mid.dep);

// 다양한 입력에서 깨지지 않는지
const cases = [
  { birth: 1980, entry: 2005, tier: 'big', role: 'sales', startPay: 3000, curPay: 9000, housing: 'own', netWorth: 90000 },
  { birth: 2002, entry: 2026, tier: 'etc', role: 'service', startPay: 2800, curPay: 2800, housing: 'rent', netWorth: 0 },
  { birth: 1985, entry: 2009, tier: 'small', role: 'field', startPay: 2200, curPay: 3600, housing: 'jeonse', netWorth: -3000 },
  { birth: 1998, entry: 2024, tier: 'big', role: 'research', startPay: 6000, curPay: 7000, housing: 'rent', netWorth: 15000 },
];
for (const c of cases) {
  const x = E.analyze(c);
  console.log(c.birth, c.entry, c.housing, '=> mode', x.mode, x.actions.map(a=>a.label.slice(0,14)).join('/'), 'A dep', x.A.mid.dep, 'free', x.A.mid.freedom, 'B dep', x.B.mid.dep, 'free', x.B.mid.freedom, 'acts', x.actions.length, x.counts.total);
  assert(x.mode === 'settled' ? x.actions.length === 0 : (x.actions.length >= 1 && x.actions.length <= 3));
  for (const k of ['W','assetsW','dep']) assert(Number.isFinite(x.A.mid[k]) && Number.isFinite(x.B.mid[k]), k);
}
console.log('OK');
