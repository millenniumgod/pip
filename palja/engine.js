/* 자본주의 팔자 리포트 - 계산 엔진
 *
 * 입력 8개 → (1) 현재 궤적 A를 시뮬레이션하고
 *            (2) 수만 개의 레버 조합을 같은 엔진으로 돌려 "B(해야 할 일)"를 하나 고른다.
 * 모든 금액 단위는 만 원, 현재 가치(실질) 기준. 네트워크·저장소는 사용하지 않는다.
 */
(function (root, factory) {
  var D = (typeof module === 'object' && module.exports) ? require('./data.js') : root.PaljaData;
  var api = factory(D);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PaljaEngine = api;
})(this, function (D) {
  'use strict';

  var MAX_DIFFICULTY = 8;   // "현실 범위" 상한
  var MAX_EXTRA_SAVE = 0.35; // 추가 저축 상한(세후 소득 대비)
  var MAX_ACTIVE = 3;       // 사용자에게 제시하는 행동 수 상한
  var PART_TIME_PAY = 1100; // 은퇴 후 파트타임 연 수입(월 100만 원 가정, 세후)

  function clamp(x, a, b) { return Math.min(b, Math.max(a, x)); }

  function interp(pts, x) {
    if (x <= pts[0][0]) return pts[0][1];
    for (var i = 1; i < pts.length; i++) {
      if (x <= pts[i][0]) {
        var p = pts[i - 1], q = pts[i];
        return p[1] + (q[1] - p[1]) * (x - p[0]) / (q[0] - p[0]);
      }
    }
    return pts[pts.length - 1][1];
  }

  function netOf(gross) { return gross * (1 - interp(D.taxPoints, gross)); }

  function macroAt(y) {
    return D.macro[clamp(y, D.minYear, D.maxYear)];
  }

  function cumInflation(fromYear, toYear) {
    var f = 1;
    for (var y = fromYear + 1; y <= toYear; y++) f *= 1 + macroAt(y).cpi / 100;
    return f;
  }

  /* ---------- 레버(= B 후보 행동) 정의 ---------- */
  var OPT = {
    add: [0, 10, 20, 30, 40, 50, 70, 100, 150, 200],
    career: [
      { inc: 1,    wd: 0, diff: 0,   label: '' },
      { inc: 1.10, wd: 0, diff: 1.5, label: '이직·연봉 협상으로 연봉 +10%', detail: '시장 연봉 조회 후 이직 또는 협상. 2년에 한 번은 시장가를 확인하세요.' },
      { inc: 1.20, wd: 0, diff: 2.5, label: '이직·연봉 협상으로 연봉 +20%', detail: '직무 경력을 정리해 한 단계 높은 포지션으로 이동.' },
      { inc: 1.30, wd: 0, diff: 4,   label: '이직·연봉 협상으로 연봉 +30%', detail: '업계 상위 보상 구간의 회사·포지션으로 이동.' },
      { inc: 1.08, wd: 1, diff: 2.5, label: '자격증·대학원 등 직무 고도화 (연봉 +8%, 노동 수명 +1년)', detail: '직무와 직결되는 자격·학위·포트폴리오를 1~2년 안에 확보.' },
      { inc: 1.10, wd: 3, diff: 3.5, label: '관리직·전문직 트랙으로 전환 (연봉 +10%, 노동 수명 +3년)', detail: '실무 → 관리·기획·전문 컨설팅 쪽으로 역할 이동.' },
      { inc: 1.25, wd: 0, diff: 5,   label: '고성장 업종·직무로 전환 (연봉 +25%)', detail: '수요가 늘고 보상이 높은 업종·직무로 커리어를 옮김.' },
      { inc: 1.15, wd: 5, diff: 4.5, label: '프리랜서·컨설턴트로 독립 (수입 +15%, 노동 수명 +5년)', detail: '조직 밖에서도 팔리는 전문성을 만들고 고객 기반을 확보.' }
    ],
    side:  [0, 30, 50, 100, 150],
    sideD: [0, 1.5, 2.5, 4.5, 6.5],
    ret:   [0, 0.005, 0.01],
    retD:  [0, 1.2, 2.5],
    work:  [0, 2, 3, 5, 8],
    workD: [0, 1, 1.5, 2.5, 4],
    pt:    [0, 5, 10, 15],
    ptD:   [0, 1, 2, 3],
    house: [0, 1]
  };

  function leverSet(P, idx, delay) {
    var c = OPT.career[idx.career];
    return {
      add: OPT.add[idx.add],
      incMult: c.inc,
      workDelta: c.wd + OPT.work[idx.work],
      side: OPT.side[idx.side],
      retAdd: OPT.ret[idx.ret],
      houseCut: idx.house ? 0.08 : 0,
      ptYears: OPT.pt[idx.pt],
      delay: delay || 0
    };
  }

  function difficultyOf(P, idx) {
    return OPT.add[idx.add] / (P.net0 / 12) * 20
      + OPT.career[idx.career].diff
      + OPT.sideD[idx.side]
      + OPT.retD[idx.ret]
      + OPT.workD[idx.work]
      + OPT.ptD[idx.pt]
      + (idx.house ? 2.5 : 0);
  }

  function activeCount(idx) {
    return (idx.add ? 1 : 0) + (idx.career ? 1 : 0) + (idx.side ? 1 : 0) + (idx.ret ? 1 : 0)
      + (idx.work ? 1 : 0) + (idx.pt ? 1 : 0) + (idx.house ? 1 : 0);
  }

  var NO_LEVER = { add: 0, incMult: 1, workDelta: 0, side: 0, retAdd: 0, houseCut: 0, ptYears: 0, delay: 0 };

  /* ---------- 프로필(입력 → 모델 파라미터) ---------- */
  function buildProfile(input) {
    var now = D.nowYear;
    var tier = D.tiers[input.tier];
    var role = D.roles[input.role];
    var age = now - input.birth;
    var yearsPast = Math.max(1, now - input.entry);

    var cagr = Math.pow(input.curPay / input.startPay, 1 / yearsPast) - 1;
    var infl = cumInflation(input.entry, now);
    var avgInfl = now - input.entry < 1 ? D.pi : Math.pow(infl, 1 / yearsPast) - 1;
    var realCagr = (1 + cagr) / (1 + avgInfl) - 1;

    var g0 = clamp(0.5 * cagr + 0.5 * tier.raise, 0, 0.09);

    var net0 = netOf(input.curPay);
    var srModel = D.saveBase[input.housing] + Math.min(0.12, Math.max(0, (input.curPay - 4000) / 1000 * 0.02));
    var avgNet = netOf((input.startPay + input.curPay) / 2);
    var srObs = input.netWorth > 0 ? clamp(input.netWorth / yearsPast / avgNet, 0, 0.6) : 0;
    var sr = clamp(0.6 * srModel + 0.4 * srObs, 0.03, 0.55);

    return {
      input: input, tier: tier, role: role,
      age: age, yearsPast: yearsPast,
      cagr: cagr, avgInfl: avgInfl, realCagr: realCagr,
      g0: g0, I0: input.curPay, net0: net0, saveRate: sr,
      S0: net0 * (1 - sr), A0: input.netWorth,
      W0: Math.max(age + 1, role.workEnd + tier.endAdj),
      housing: input.housing
    };
  }

  /* ---------- 한 번의 시뮬레이션 ---------- */
  function simulate(P, L, retAdj) {
    var a0 = P.age;
    var W = Math.max(a0 + 1, P.W0 + L.workDelta);
    var d = L.delay;
    var rBase = D.rReal + (retAdj || 0);
    var A = P.A0, I = P.I0, S = P.S0, sumI = 0, n = 0, freedom = null;
    var a, t, net, on, r;

    for (a = a0, t = 0; a < W; a++, t++) {
      if (t > 0 && a < 50) I *= (1 + Math.max(D.pi, P.g0 - 0.0035 * t)) / (1 + D.pi);
      if (t === d) I *= L.incMult;
      net = netOf(I);
      on = t >= d;
      S = P.S0 * Math.sqrt(net / P.net0) * (on ? 1 - L.houseCut : 1);
      r = rBase + (on ? L.retAdd : 0);
      A = A * (1 + r) + net - S + (on ? L.side * 10.2 + L.add * 12 : 0);
      sumI += I; n++;
      if (freedom === null && A >= D.retireSpend * S / D.swr) freedom = a + 1;
    }

    var assetsW = A, Slast = S, Ilast = I;

    // 노동 수명 이후에도 계속 일한다고 가정했을 때의 경제적 자유 시점(80세까지만 탐색)
    if (freedom === null) {
      var A2 = A;
      for (a = W; a < 80; a++) {
        t = a - a0;
        net = netOf(Ilast);
        on = t >= d;
        S = P.S0 * Math.sqrt(net / P.net0) * (on ? 1 - L.houseCut : 1);
        r = rBase + (on ? L.retAdd : 0);
        A2 = A2 * (1 + r) + net - S + (on ? L.side * 10.2 + L.add * 12 : 0);
        if (A2 >= D.retireSpend * S / D.swr) { freedom = a + 1; break; }
      }
    }

    // 은퇴 후 자산 지속 나이
    var careerYears = P.yearsPast + n;
    var avgGross = (0.8 * P.I0 * P.yearsPast + sumI) / careerYears;
    var pension = D.pensionRate * Math.min(avgGross, D.pensionCap) * Math.min(1, careerYears / 30);
    var R = D.retireSpend * Slast;
    var B = assetsW, dep = 100;
    var rr = rBase + D.rRetireAdj + L.retAdd;
    if (B < 0) dep = W;
    else {
      for (a = W; a < 100; a++) {
        B = B * (1 + rr) - R + (a - W < L.ptYears ? PART_TIME_PAY : 0) + (a >= D.pensionAge ? pension : 0);
        if (B < 0) { dep = a; break; }
      }
    }

    return { W: W, assetsW: assetsW, dep: dep, freedom: freedom, pension: pension, R: R };
  }

  function range(P, L) {
    var lo = simulate(P, L, -0.01), mid = simulate(P, L, 0), hi = simulate(P, L, 0.01);
    return { low: lo, mid: mid, high: hi };
  }

  // 목표: 은퇴 후 자산이 계획 나이(90세)까지 유지된다. 수익률이 0.5%p 낮아도 성립해야 인정한다.
  function goalMet(P, L, res) {
    return res.dep >= D.planAge && simulate(P, L, -0.005).dep >= D.planAge;
  }

  /* ---------- 경우의 수 전수 탐색 ---------- */
  function search(P, base) {
    var idx = { add: 0, career: 0, side: 0, ret: 0, work: 0, pt: 0, house: 0 };
    var houseMax = P.housing === 'rent' ? 1 : 0;
    var total = 0, realistic = 0, goalCount = 0;
    var close = null, partial = null, early = null;
    var baseMet = goalMet(P, NO_LEVER, base);

    for (idx.add = 0; idx.add < OPT.add.length; idx.add++)
    for (idx.career = 0; idx.career < OPT.career.length; idx.career++)
    for (idx.side = 0; idx.side < OPT.side.length; idx.side++)
    for (idx.ret = 0; idx.ret < OPT.ret.length; idx.ret++)
    for (idx.work = 0; idx.work < OPT.work.length; idx.work++)
    for (idx.pt = 0; idx.pt < OPT.pt.length; idx.pt++)
    for (idx.house = 0; idx.house <= houseMax; idx.house++) {
      total++;
      var diff = difficultyOf(P, idx);
      var L = leverSet(P, idx, 0);
      var res = simulate(P, L, 0);
      // 추가 저축이 세후 소득의 35%를 넘는 조합은 현실 범위에서 제외
      if (diff > MAX_DIFFICULTY || OPT.add[idx.add] * 12 > MAX_EXTRA_SAVE * P.net0) continue;
      realistic++;
      var met = goalMet(P, L, res);
      if (met) goalCount++;
      if (activeCount(idx) > MAX_ACTIVE || activeCount(idx) === 0) continue;

      var cand = null;
      if (met && (!close || diff < close.diff || (diff === close.diff && res.assetsW > close.res.assetsW))) {
        cand = cand || { idx: copy(idx), diff: diff, res: res };
        close = cand;
      }
      var dep = Math.min(res.dep, D.planAge);
      if (!partial || dep > partial.dep || (dep === partial.dep && diff < partial.diff)) {
        cand = cand || { idx: copy(idx), diff: diff, res: res };
        partial = { idx: cand.idx, diff: diff, res: res, dep: dep };
      }
      if (baseMet && diff <= 4.5 && res.freedom !== null && (base.freedom === null || res.freedom < base.freedom)) {
        var f = res.freedom;
        if (!early || f < early.res.freedom || (f === early.res.freedom && diff < early.diff)) {
          cand = cand || { idx: copy(idx), diff: diff, res: res };
          early = cand;
        }
      }
    }

    var mode, pick;
    if (baseMet && early) { mode = 'already'; pick = early; }
    else if (baseMet) { mode = 'settled'; pick = { idx: idx0(), diff: 0, res: base }; }
    else if (close) { mode = 'close'; pick = close; }
    else { mode = 'partial'; pick = partial; }
    return { mode: mode, pick: pick, total: total, realistic: realistic, goalCount: goalCount };
  }

  function idx0() { return { add: 0, career: 0, side: 0, ret: 0, work: 0, pt: 0, house: 0 }; }
  function copy(o) { var c = {}; for (var k in o) c[k] = o[k]; return c; }

  /* ---------- 행동 설명(레버별 단독 효과) ---------- */
  function describe(P, idx, base) {
    var items = [];
    function single(key, val) {
      var s = { add: 0, career: 0, side: 0, ret: 0, work: 0, pt: 0, house: 0 };
      s[key] = val;
      var r = simulate(P, leverSet(P, s, 0), 0);
      return { dAsset: r.assetsW - base.assetsW, dDep: Math.min(r.dep, 100) - Math.min(base.dep, 100), diff: difficultyOf(P, s) };
    }
    function push(key, v, label, detail, timing, order) {
      var e = single(key, v);
      items.push({ kind: key, label: label, detail: detail, timing: timing, order: order,
        dAsset: e.dAsset, dDep: e.dDep, diff: e.diff });
    }
    if (idx.add)    push('add', idx.add, '월 저축 ' + OPT.add[idx.add] + '만 원 늘리기',
      '고정비·구독을 점검하고, 급여일에 자동이체로 먼저 떼어 두기', '이번 달', 0);
    if (idx.ret)    push('ret', idx.ret, '자산 운용 수익률 +' + (OPT.ret[idx.ret] * 100).toFixed(1) + '%p',
      '예·적금 위주라면 분산투자 비중을 점검 (원금 손실 위험이 있으며, 특정 상품 추천이 아님)', '이번 분기', 1);
    if (idx.house)  push('house', 1, '주거비 구조 개선 (월세 → 공공임대·전세 전환)',
      '청년·신혼 등 자격 요건에 맞는 공공임대·전세대출 상품 검토', '1~2년 안', 2);
    if (idx.side)   push('side', idx.side, '부업·N잡으로 월 ' + OPT.side[idx.side] + '만 원 더 벌기',
      '본업 전문성을 외부에 파는 형태(강의·외주·컨설팅)가 가장 지속 가능', '1년 안', 3);
    if (idx.career) push('career', idx.career, OPT.career[idx.career].label,
      OPT.career[idx.career].detail, '1~3년 안', 4);
    if (idx.work)   push('work', idx.work, '건강·직무 관리로 노동 수명 +' + OPT.work[idx.work] + '년',
      '체력과 최신 기술을 유지하고, 정년 이후 재고용·계약직 경로를 미리 확보', '3~10년', 5);
    if (idx.pt)     push('pt', idx.pt, '은퇴 후 파트타임(월 100만 원) ' + OPT.pt[idx.pt] + '년',
      '은퇴 5년 전부터 가볍게 이어갈 일을 준비', '은퇴 5년 전', 6);
    items.sort(function (a, b) { return a.order - b.order; });
    return items;
  }

  /* ---------- 4개 축 진단 ---------- */
  function diagnose(P) {
    var inp = P.input;
    var m = macroAt(inp.entry);
    var crisis = D.crises[inp.entry] || null;
    var era = clamp(85 - m.unemp * 6 + m.gdp * 1.5 - (crisis ? crisis.penalty : 0), 5, 95);
    var eraLabel = era >= 70 ? '수월' : era >= 55 ? '보통' : era >= 40 ? '험난' : '혹한기';

    var job = clamp(0.6 * P.tier.stab + 0.4 * clamp((P.role.workEnd - 48) / 12 * 100, 0, 100), 0, 100);

    var income = clamp(50 + P.realCagr * 100 * 7, 0, 100);

    var target0 = D.retireSpend * P.S0 / D.swr;
    var progress = P.A0 / target0;
    var expected = clamp((P.age - 25) / 40, 0.05, 1);
    var asset = clamp(progress / expected * 100, 0, 100);

    return {
      era:    { score: Math.round(era), label: eraLabel, year: inp.entry, unemp: m.unemp, gdp: m.gdp, crisis: crisis ? crisis.name : null },
      job:    { score: Math.round(job), tier: P.tier.label, role: P.role.label, workEnd: P.W0 },
      income: { score: Math.round(income), cagr: P.cagr, avgInfl: P.avgInfl, realCagr: P.realCagr },
      asset:  { score: Math.round(asset), progress: progress, target: target0, saveRate: P.saveRate }
    };
  }

  /* ---------- 진입점 ---------- */
  function analyze(input) {
    var P = buildProfile(input);
    var A = range(P, NO_LEVER);
    var s = search(P, A.mid);
    var Lb = leverSet(P, s.pick.idx, 0);
    var B = range(P, Lb);
    var Bdelay = simulate(P, leverSet(P, s.pick.idx, 3), 0);
    return {
      profile: P,
      diag: diagnose(P),
      A: A,
      B: B,
      mode: s.mode,
      actions: describe(P, s.pick.idx, A.mid),
      difficulty: s.pick.diff,
      delay: { years: 3, dFreedom: nz(Bdelay.freedom) - nz(B.mid.freedom), dAsset: Bdelay.assetsW - B.mid.assetsW, dDep: Math.min(Bdelay.dep, 100) - Math.min(B.mid.dep, 100) },
      counts: { total: s.total, realistic: s.realistic, goal: s.goalCount },
      planAge: D.planAge
    };
  }

  function nz(x) { return x === null ? 80 : x; }

  return {
    analyze: analyze, buildProfile: buildProfile, simulate: simulate, netOf: netOf,
    NO_LEVER: NO_LEVER, MAX_DIFFICULTY: MAX_DIFFICULTY
  };
});
