/* 자본주의 팔자 리포트 - 화면 로직
 * 입력값은 메모리에만 존재한다. 서버 전송·localStorage·쿠키·URL 파라미터 어디에도 저장하지 않는다.
 */
(function () {
  'use strict';

  var D = window.PaljaData;
  var E = window.PaljaEngine;
  var JT = window.PaljaJobs.tree;
  var $ = function (id) { return document.getElementById(id); };

  var form = $('form'), intro = $('intro'), progressEl = $('progress'), resultEl = $('result');
  var lastResult = null;

  /* ---------- 표시 형식 ---------- */
  function asset(m) {
    var neg = m < 0, a = Math.abs(m), s;
    if (a >= 10000) s = (a / 10000).toFixed(1) + '억';
    else s = Math.round(a).toLocaleString('ko-KR') + '만 원';
    return (neg ? '-' : '') + s;
  }
  function plus(m) { return (m >= 0 ? '+' : '') + asset(m); }
  function age(n) { return n >= 100 ? '100세 이상' : n + '세'; }
  function pct(x, d) { return (x * 100).toFixed(d === undefined ? 1 : d); }
  function stars(diff) {
    var n = Math.max(1, Math.min(5, Math.ceil(diff / 1.3)));
    return '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);
  }

  /* ---------- 폼: 연도 ---------- */
  var birthSel = $('birth'), entrySel = $('entry');
  for (var y = 1980; y <= 2004; y++) birthSel.add(new Option(y + '년', y));

  birthSel.addEventListener('change', function () {
    var b = +birthSel.value;
    entrySel.length = 1;
    if (!b) { entrySel.disabled = true; entrySel.options[0].text = '태어난 해를 먼저 선택하세요'; return; }
    entrySel.disabled = false;
    entrySel.options[0].text = '선택';
    for (var e = Math.max(D.minYear, b + 18); e <= D.nowYear; e++) entrySel.add(new Option(e + '년', e));
  });

  /* ---------- 폼: 금액 입력 ---------- */
  ['startPay', 'curPay', 'netWorth', 'houseValue', 'rent'].forEach(function (id) {
    $(id).addEventListener('input', function (ev) {
      var digits = ev.target.value.replace(/\D/g, '').slice(0, 8);
      ev.target.value = digits ? Number(digits).toLocaleString('en-US') : '';
    });
  });
  function num(id) {
    var v = $(id).value.replace(/\D/g, '');
    return v === '' ? NaN : Number(v);
  }
  function radio(name) {
    var el = form.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : '';
  }

  /* ---------- 폼: 주거 ---------- */
  var HOUSE = {
    own:    { label: '집 시세', hint: '지금 팔면 받을 수 있는 금액을 적어주세요. 대출이 있어도 집값 전체를 적고, 대출은 아래 순자산에서 뺍니다.' },
    jeonse: { label: '전세 보증금', hint: '전세대출이 있어도 보증금 전체를 적어주세요. 대출은 아래 순자산에서 뺍니다.' },
    rent:   { label: '월세 보증금', hint: '보증금이 없으면 0을 적어주세요.' }
  };
  function syncHousing() {
    var h = radio('housing');
    $('houseValueBox').hidden = !h;
    $('rentBox').hidden = h !== 'rent';
    if (h) {
      $('houseValueLabel').textContent = HOUSE[h].label;
      $('houseValueHint').textContent = HOUSE[h].hint;
    }
  }

  /* ---------- 폼: 직무 3단계 ---------- */
  var roleSel = { i: null, j: null, k: null };
  var roleBox = $('roleBox');

  function stepHtml(level, title, selIdx, names) {
    if (selIdx === null) {
      return '<div class="step"><div class="step-h">' + title + '</div><div class="chips' + (names.length > 12 ? ' scroll' : '') + '">' +
        names.map(function (n, x) {
          return '<button type="button" class="cb" data-lv="' + level + '" data-x="' + x + '" aria-pressed="false">' + n + '</button>';
        }).join('') + '</div></div>';
    }
    return '<div class="step"><div class="done-row"><div><small>' + title + '</small><b>' + names[selIdx] + '</b></div>' +
      '<button type="button" class="link" data-reset="' + level + '">변경</button></div></div>';
  }

  function renderRole() {
    var h = [];
    h.push(stepHtml(1, '① 큰 분야', roleSel.i, JT.map(function (g) { return g.name; })));
    if (roleSel.i !== null) {
      var mids = JT[roleSel.i].mids;
      h.push(stepHtml(2, '② 세부 분야', roleSel.j, mids.map(function (m) { return m.name; })));
      if (roleSel.j !== null) {
        h.push(stepHtml(3, '③ 직무', roleSel.k, mids[roleSel.j].leaves.map(function (l) { return l.name; })));
      }
    }
    roleBox.innerHTML = h.join('');
    var steps = roleBox.querySelectorAll('.step');
    if (steps.length > 1 && roleSel.k === null) steps[steps.length - 1].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    updateProgress();
  }

  roleBox.addEventListener('click', function (ev) {
    var t = ev.target.closest('button');
    if (!t) return;
    if (t.hasAttribute('data-lv')) {
      var lv = +t.getAttribute('data-lv'), x = +t.getAttribute('data-x');
      if (lv === 1) { roleSel.i = x; roleSel.j = null; roleSel.k = null; }
      else if (lv === 2) { roleSel.j = x; roleSel.k = null; }
      else roleSel.k = x;
      setError('role', '');
    } else if (t.hasAttribute('data-reset')) {
      var rl = +t.getAttribute('data-reset');
      if (rl <= 1) { roleSel.i = null; roleSel.j = null; roleSel.k = null; }
      else if (rl === 2) { roleSel.j = null; roleSel.k = null; }
      else roleSel.k = null;
    } else return;
    renderRole();
  });
  renderRole();

  /* ---------- 폼: 진행률 ---------- */
  function filled(id) { return !isNaN(num(id)); }
  function updateProgress() {
    var h = radio('housing');
    var st = {
      birth: !!birthSel.value,
      entry: !!entrySel.value,
      tier: !!radio('tier'),
      role: roleSel.k !== null,
      startPay: filled('startPay'),
      curPay: filled('curPay'),
      housing: !!h && filled('houseValue') && (h !== 'rent' || filled('rent')),
      netWorth: filled('netWorth')
    };
    var n = 0;
    Object.keys(st).forEach(function (k) {
      if (st[k]) n++;
      var li = form.querySelector('[data-field="' + k + '"]');
      if (li) li.classList.toggle('done', st[k]);
    });
    $('progressBar').style.width = (n / 8 * 100) + '%';
    $('progressText').textContent = n + ' / 8';
  }
  form.addEventListener('input', updateProgress);
  form.addEventListener('change', function (ev) {
    if (ev.target.name === 'housing') syncHousing();
    updateProgress();
  });

  /* ---------- 폼: 검증 ---------- */
  function setError(field, msg) {
    var box = $('err-' + field);
    box.textContent = msg || '';
    box.hidden = !msg;
  }

  function readInput() {
    var errors = {};
    var birth = +birthSel.value, entry = +entrySel.value;
    var tier = radio('tier'), housing = radio('housing');
    var startPay = num('startPay'), curPay = num('curPay'), net = num('netWorth');
    var houseValue = num('houseValue'), rent = num('rent');

    if (!birth) errors.birth = '태어난 해를 선택해 주세요.';
    if (!entry) errors.entry = '첫 진출 연도를 선택해 주세요.';
    if (!tier) errors.tier = '처음 일을 시작한 곳을 선택해 주세요.';
    if (roleSel.k === null) errors.role = '큰 분야 → 세부 분야 → 직무까지 선택해 주세요.';
    if (!(startPay >= 300 && startPay <= 100000)) errors.startPay = '300 ~ 100,000만 원 사이로 입력해 주세요.';
    if (!(curPay >= 300 && curPay <= 100000)) errors.curPay = '300 ~ 100,000만 원 사이로 입력해 주세요.';
    if (!housing) errors.housing = '현재 사는 집을 선택해 주세요.';
    else {
      var lo = housing === 'rent' ? 0 : 500, hi = housing === 'rent' ? 300000 : 1000000;
      if (!(houseValue >= lo && houseValue <= hi)) {
        errors.houseValue = housing === 'rent'
          ? '보증금을 0 ~ 300,000만 원 사이로 입력해 주세요. 없으면 0.'
          : HOUSE[housing].label + '을 ' + lo.toLocaleString('en-US') + ' ~ ' + hi.toLocaleString('en-US') + '만 원 사이로 입력해 주세요.';
      }
      if (housing === 'rent' && !(rent >= 1 && rent <= 1000)) errors.rent = '월세를 1 ~ 1,000만 원 사이로 입력해 주세요.';
    }
    if (isNaN(net)) errors.netWorth = '순자산을 입력해 주세요. 없으면 0을 적어주세요.';

    var order = ['birth', 'entry', 'tier', 'role', 'startPay', 'curPay', 'housing', 'houseValue', 'rent', 'netWorth'];
    order.forEach(function (f) { setError(f, errors[f]); });
    var first = order.filter(function (f) { return errors[f]; })[0];
    if (first) {
      $('err-' + first).scrollIntoView({ behavior: 'smooth', block: 'center' });
      return null;
    }
    var roleInfo = window.PaljaJobs.resolve(roleSel.i, roleSel.j, roleSel.k);
    return {
      birth: birth, entry: entry, tier: tier, roleInfo: roleInfo,
      startPay: startPay, curPay: curPay,
      housing: housing, houseValue: houseValue, rent: housing === 'rent' ? rent : 0,
      netWorth: $('negative').checked ? -net : net
    };
  }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var input = readInput();
    if (!input) return;
    lastResult = E.analyze(input);
    render(lastResult);
    form.hidden = true; intro.hidden = true; progressEl.hidden = true;
    resultEl.hidden = false;
    window.scrollTo(0, 0);
  });

  /* ========== 차트 ========== */
  var NS = 'http://www.w3.org/2000/svg';

  // A(지금대로) / B(해야 할 일) 타임라인: 일하는 기간 → 노후 자산 유지 → 자산 소진
  function timelineSvg(r) {
    var W = 360, L = 8, R = 8, a0 = r.profile.age;
    var x = function (a) { return L + (a - a0) / (100 - a0) * (W - L - R); };
    var rows = [
      { k: 'a', y: 40, res: r.A.mid, name: 'A  지금대로' },
      { k: 'b', y: 104, res: r.B.mid, name: 'B  해야 할 일을 하면' }
    ];
    var s = ['<svg viewBox="0 0 ' + W + ' 184" role="img" aria-label="A와 B의 일하는 기간과 자산이 버티는 기간 비교">'];

    // 눈금과 90세 기준선
    var t0 = Math.ceil(a0 / 10) * 10;
    for (var t = t0; t <= 100; t += 10) {
      s.push('<line class="' + (t === D.planAge ? 'c-plan' : 'c-grid') + '" x1="' + x(t) + '" x2="' + x(t) + '" y1="22" y2="140"/>');
      s.push('<text class="t3" x="' + x(t) + '" y="158" text-anchor="middle">' + t + '세</text>');
    }
    s.push('<line class="c-axis" x1="' + L + '" x2="' + (W - R) + '" y1="140" y2="140"/>');
    s.push('<text class="t3" x="' + x(D.planAge) + '" y="12" text-anchor="middle">계획 기준 90세</text>');

    rows.forEach(function (row) {
      var res = row.res, c = row.k;
      var xw = x(res.W), xd = x(Math.min(res.dep, 100)), x0 = x(a0), x100 = x(100);
      var depTxt = res.dep >= 100 ? '100세 이상 유지' : res.dep + '세에 자산 소진';
      s.push('<text class="t1" x="' + L + '" y="' + (row.y - 9) + '">' + row.name + '</text>');
      s.push('<text class="t2" x="' + (W - R) + '" y="' + (row.y - 9) + '" text-anchor="end">' + depTxt + '</text>');
      s.push('<rect class="c-' + c + '" fill-opacity=".38" x="' + x0 + '" y="' + row.y + '" width="' + Math.max(0, xw - x0 - 1) + '" height="24" rx="4"/>');
      if (xw - x0 > 80) s.push('<text class="t2 in" x="' + (x0 + 8) + '" y="' + (row.y + 16) + '">일하는 기간 ' + (res.W - a0) + '년</text>');
      if (res.dep > res.W) {
        s.push('<rect class="c-' + c + '" x="' + (xw + 1) + '" y="' + row.y + '" width="' + Math.max(0, xd - xw - 2) + '" height="24" rx="4"/>');
        if (xd - xw > 116) s.push('<text class="t-on-' + c + '" font-size="11" x="' + (xw + 9) + '" y="' + (row.y + 16) + '">노후 자산 유지 ' + (Math.min(res.dep, 100) - res.W) + '년</text>');
      }
      if (res.dep < 100) {
        s.push('<rect class="c-track" x="' + (xd + 1) + '" y="' + (row.y + .5) + '" width="' + Math.max(0, x100 - xd - 1) + '" height="23" rx="4"/>');
        if (x100 - xd > 56) s.push('<text class="t3 in" x="' + (xd + 9) + '" y="' + (row.y + 16) + '">자산 소진 후</text>');
      }
    });
    s.push('</svg>');
    return s.join('');
  }

  function valAt(tr, a) {
    if (a < tr[0][0]) return null;
    for (var i = 0; i < tr.length; i++) if (tr[i][0] === a) return tr[i][1];
    return tr[tr.length - 1][1];
  }

  // 쓸 수 있는 자산의 흐름 (A vs B 곡선)
  function trajectory(r) {
    var W = 360, H = 236, ml = 40, mr = 16, mt = 22, mb = 34, a0 = r.profile.age;
    var pw = W - ml - mr, ph = H - mt - mb;
    var trA = r.traces.A, trB = r.traces.B;
    var vmax = 0;
    trA.concat(trB).forEach(function (p) { if (p[1] > vmax) vmax = p[1]; });
    var steps = [2500, 5000, 10000, 20000, 50000, 100000, 200000, 500000];
    var step = steps[steps.length - 1];
    for (var q = 0; q < steps.length; q++) if (vmax / 4 <= steps[q]) { step = steps[q]; break; }
    var ymax = Math.max(step, Math.ceil(vmax / step) * step);
    var x = function (a) { return ml + (a - a0) / (100 - a0) * pw; };
    var yy = function (v) { return mt + ph - Math.max(0, v) / ymax * ph; };
    var fmt = function (v) { return v === 0 ? '0' : (step >= 10000 ? (v / 10000) : (v / 10000).toFixed(1)) + '억'; };

    var s = ['<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="나이에 따른 쓸 수 있는 자산의 변화, A와 B 비교">'];
    for (var v = 0; v <= ymax; v += step) {
      s.push('<line class="' + (v === 0 ? 'c-axis' : 'c-grid') + '" x1="' + ml + '" x2="' + (W - mr) + '" y1="' + yy(v) + '" y2="' + yy(v) + '"/>');
      s.push('<text class="t3" x="' + (ml - 6) + '" y="' + (yy(v) + 3.5) + '" text-anchor="end">' + fmt(v) + '</text>');
    }
    var t0 = Math.ceil(a0 / 10) * 10;
    for (var t = t0; t <= 100; t += 10) s.push('<text class="t3" x="' + x(t) + '" y="' + (H - 12) + '" text-anchor="middle">' + t + '세</text>');
    s.push('<line class="c-plan" x1="' + x(D.planAge) + '" x2="' + x(D.planAge) + '" y1="' + mt + '" y2="' + (mt + ph) + '"/>');
    s.push('<text class="t3" x="' + x(D.planAge) + '" y="' + (mt - 8) + '" text-anchor="middle">90세</text>');

    function line(tr, c) {
      var pts = tr.map(function (p) { return x(p[0]).toFixed(1) + ',' + yy(p[1]).toFixed(1); }).join(' ');
      s.push('<polyline class="c-' + c + '-line line2" points="' + pts + '"/>');
      var e = tr[tr.length - 1];
      s.push('<circle class="c-' + c + '-dot" cx="' + x(e[0]) + '" cy="' + yy(e[1]) + '" r="4"/>');
      return e;
    }
    var eA = line(trA, 'a'), eB = line(trB, 'b');
    function endLabel(e, res, dy) {
      var txt = res.dep >= 100 ? '100세 ' + asset(e[1]) : res.dep + '세 소진';
      var right = x(e[0]) > W - 90;
      s.push('<text class="t2" x="' + (x(e[0]) + (right ? -8 : 8)) + '" y="' + (yy(e[1]) + dy) + '" text-anchor="' + (right ? 'end' : 'start') + '">' + txt + '</text>');
    }
    endLabel(eA, r.A.mid, -9);
    endLabel(eB, r.B.mid, -9);

    // 호버 레이어
    s.push('<line class="c-cross" id="tcLine" x1="0" x2="0" y1="' + mt + '" y2="' + (mt + ph) + '" visibility="hidden"/>');
    s.push('<circle class="c-a-dot" id="tcA" r="4" visibility="hidden"/><circle class="c-b-dot" id="tcB" r="4" visibility="hidden"/>');
    s.push('<rect class="hit" id="tcHit" x="' + ml + '" y="' + mt + '" width="' + pw + '" height="' + ph + '"/>');
    s.push('</svg>');

    return { svg: s.join(''), geo: { W: W, ml: ml, pw: pw, a0: a0, x: x, yy: yy } };
  }

  function bindTrajectory(r, geo) {
    var hit = $('tcHit'), line = $('tcLine'), da = $('tcA'), db = $('tcB'), tip = $('tcTip');
    if (!hit) return;
    var svg = hit.ownerSVGElement;
    function move(ev) {
      var rect = svg.getBoundingClientRect();
      var px = (ev.clientX - rect.left) / rect.width * geo.W;
      var a = Math.round(geo.a0 + (px - geo.ml) / geo.pw * (100 - geo.a0));
      a = Math.max(geo.a0, Math.min(100, a));
      var vA = valAt(r.traces.A, a), vB = valAt(r.traces.B, a);
      var xx = geo.x(a);
      line.setAttribute('x1', xx); line.setAttribute('x2', xx);
      da.setAttribute('cx', xx); da.setAttribute('cy', geo.yy(vA));
      db.setAttribute('cx', xx); db.setAttribute('cy', geo.yy(vB));
      [line, da, db].forEach(function (el) { el.setAttribute('visibility', 'visible'); });
      tip.innerHTML = '<b>' + a + '세</b><span><i class="lg-a"></i>A ' + asset(vA) + '</span><span><i class="lg-b"></i>B ' + asset(vB) + '</span>';
      tip.hidden = false;
      var left = xx / geo.W * rect.width;
      var w = tip.offsetWidth;
      tip.style.left = (left + 12 + w > rect.width ? left - 12 - w : left + 12) + 'px';
      tip.style.top = '8px';
    }
    function leave() {
      [line, da, db].forEach(function (el) { el.setAttribute('visibility', 'hidden'); });
      tip.hidden = true;
    }
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', leave);
  }

  /* ---------- 결과 렌더링 ---------- */
  function render(r) {
    var P = r.profile, A = r.A.mid, B = r.B.mid, diag = r.diag;
    var plan = r.planAge, n = r.actions.length;
    var html = [];

    html.push(
      '<div class="rep-head"><p class="eyebrow">ECONOMIC TRAJECTORY REPORT</p><h2>나의 자본주의 팔자 리포트</h2>',
      '<p>' + P.input.birth + '년생 · ' + P.age + '세 · ' + P.role.l2 + ' › ' + P.role.l3 + '</p></div>'
    );

    /* 히어로: 자산이 버티는 나이 A → B */
    var aBig = A.dep >= 100 ? '100+' : A.dep, bBig = B.dep >= 100 ? '100+' : B.dep;
    var heroLine = r.mode === 'settled'
      ? '지금 궤적이 이미 ' + plan + '세까지 안전합니다. 큰 변화 없이 지금의 저축과 직무를 지키면 됩니다.'
      : '지금대로면 ' + A.W + '세까지 일하고 ' + (A.dep >= plan ? plan + '세 이후까지 버팁니다' : age(A.dep) + '에 자산이 바닥납니다') + '. 이 ' + n + '가지를 하면 ' + age(B.dep) + (B.dep >= 100 ? '' : '까지') + ' 버팁니다.';
    html.push(
      '<section class="hero"><div class="k">자산이 버티는 나이</div>',
      '<div class="big"><span>' + aBig + '<small>세</small></span>' +
      (r.mode === 'settled' ? '' : '<span class="arrow">→</span><span>' + bBig + '<small>세</small></span>') + '</div>',
      '<div class="cap">' + (r.mode === 'settled' ? '지금 궤적 기준' : 'A 지금대로 → B 해야 할 일을 하면 · 계획 기준 ' + plan + '세') + '</div>',
      '<p>' + heroLine + '</p></section>'
    );

    /* 한눈에: 타임라인 */
    html.push(
      '<section class="card"><p class="sec"><i class="in"></i>AT A GLANCE</p><h3>일하는 기간과 자산이 버티는 기간</h3>',
      '<div class="chart">' + timelineSvg(r) + '</div>',
      '<ul class="legend"><li><i class="lg-soft"></i>일하는 기간(연한 색)</li><li><i class="lg-solid"></i>노후 자산 유지(진한 색)</li><li><i class="lg-gap"></i>자산 소진 후</li></ul>',
      '</section>'
    );

    /* A */
    var depLine = A.dep >= plan
      ? '노후 자산은 ' + plan + '세까지 버팁니다.'
      : age(A.dep) + '쯤 자산이 바닥납니다. ' + plan + '세까지 ' + (plan - A.dep) + '년이 모자랍니다.';
    var homeNote = P.own
      ? '집값의 ' + Math.round(D.homeUsable * 100) + '%만 노후에 쓸 수 있다고 가정했습니다(주택연금·다운사이징).'
      : (P.locked > 0 ? '거주 중인 집의 보증금 ' + asset(P.locked) + '은 계속 살아야 하므로 쓸 수 있는 돈에서 뺐습니다.' : '');
    html.push(
      '<section class="card"><p class="sec"><i class="ia"></i>A · 지금 데이터대로 가면</p>',
      '<h3>당신은 ' + A.W + '세까지 일하고, ' + depLine + '</h3>',
      '<div class="stats">',
      stat('노동 수명', (A.W - P.age) + '년 남음', A.W + '세까지'),
      stat('은퇴 시 쓸 수 있는 돈', asset(A.assetsW), '오늘 가치 기준'),
      stat('경제적 자유', A.freedom === null ? '80세 이후' : age(A.freedom), A.freedom !== null && A.freedom > A.W ? '노동 수명보다 ' + (A.freedom - A.W) + '년 늦음' : A.freedom !== null ? '노동 수명 안에 도달' : '일을 계속해도 닿기 어려움'),
      stat('자산이 버티는 나이', age(A.dep), '범위 ' + age(r.A.low.dep) + ' ~ ' + age(r.A.high.dep)),
      '</div>',
      '<p class="note">범위는 투자 수익률이 ±1%p 달라지는 경우입니다.' + (homeNote ? ' ' + homeNote : '') + '</p>',
      '</section>'
    );

    /* 4개 축 */
    var axes = [
      { key: 'era', name: '시대운', d: diag.era, text: diag.era.year + '년 취업 — 실업률 ' + diag.era.unemp + '%, 성장률 ' + diag.era.gdp + '%' + (diag.era.crisis ? ', ' + diag.era.crisis + ' 여파' : '') + '. 진입 난이도는 ' + diag.era.label + '이었습니다.' },
      { key: 'job', name: '직장운', d: diag.job, text: '첫 일터는 ' + diag.job.tier + ', 현재는 ' + diag.job.role + '. 소득을 유지할 수 있는 나이를 ' + diag.job.workEnd + '세로 봅니다.' },
      { key: 'income', name: '소득운', d: diag.income, text: '소득은 연평균 ' + pct(diag.income.cagr) + '% 올랐고 같은 기간 물가는 ' + pct(diag.income.avgInfl) + '% 올랐습니다. 실질로 ' + (diag.income.realCagr >= 0 ? '연 ' + pct(diag.income.realCagr) + '%p 앞섰습니다.' : '연 ' + pct(-diag.income.realCagr) + '%p 뒤처졌습니다.') },
      { key: 'asset', name: '자산운', d: diag.asset, text: '쓸 수 있는 자산은 은퇴 목표(' + asset(diag.asset.target) + ')의 ' + pct(Math.max(0, diag.asset.progress), 0) + '% 수준이고, 추정 저축률은 ' + pct(diag.asset.saveRate, 0) + '%입니다.' }
    ];
    var weakest = axes.slice().sort(function (x, y) { return x.d.score - y.d.score; })[0];
    var weakMsg = {
      era: '시대는 바꿀 수 없습니다. 나머지 세 축으로 만회해야 합니다.',
      job: '소득을 유지할 수 있는 기간이 짧은 편입니다. 노동 수명이 곧 자산입니다.',
      income: '소득 상승이 물가를 겨우 따라가고 있습니다. 소득을 올리는 쪽이 가장 큰 변수입니다.',
      asset: '나이 대비 자산 축적이 느립니다. 저축과 운용 방식이 가장 큰 변수입니다.'
    };
    html.push('<section class="card"><p class="sec"><i class="in"></i>DIAGNOSIS</p><h3>왜 이렇게 나왔나</h3><ul class="axes">');
    axes.forEach(function (a) {
      html.push('<li class="' + (a === weakest ? 'weak' : '') + '"><div class="row"><span>' + a.name + '</span><b>' + a.d.score + '점</b></div>',
        '<div class="bar"><i data-w="' + a.d.score + '"></i></div><p>' + a.text + '</p></li>');
    });
    html.push('</ul><p class="weak-note">' + weakest.name + ' — ' + weakMsg[weakest.key] + '</p></section>');

    /* B */
    var bTitle, bNote = '';
    if (r.mode === 'close') bTitle = plan + '세까지 안전하게 가려면, 이 ' + n + '가지를 하세요.';
    else if (r.mode === 'partial') {
      bTitle = '현실적인 범위에서 최대로 끌어올리면 ' + age(B.dep) + '까지입니다. 이 ' + n + '가지는 꼭 하세요.';
      if (B.dep < plan) bNote = '그래도 ' + (plan - B.dep) + '년이 모자랍니다. 지출 수준 자체를 낮추거나 소득 구조를 바꾸는 더 큰 결정이 필요합니다.';
    } else if (r.mode === 'already') bTitle = '이미 노후 안전선입니다. 더 일찍 자유로워지려면 이 ' + n + '가지입니다.';
    else bTitle = '지금 궤적이 이미 ' + plan + '세까지 안전합니다. 지금의 저축과 직무를 지키세요.';

    html.push('<section class="card"><p class="sec"><i class="ib"></i>B · 더 잘 살려면</p><h3>' + bTitle + '</h3>');
    if (n) {
      html.push('<ol class="actions">');
      r.actions.forEach(function (a) {
        var eff = '은퇴 자산 ' + plus(a.dAsset) + (a.dDep > 0 ? ' · 버티는 나이 +' + a.dDep + '년' : '');
        html.push('<li><div class="t">' + a.label + '</div><p class="d">' + a.detail + '</p>',
          '<div class="m"><span class="eff">단독 효과 ' + eff + '</span><span>시기 ' + a.timing + '</span><span>난이도 ' + stars(a.diff) + '</span></div></li>');
      });
      html.push('</ol>');
    }
    html.push(
      '<table class="cmp"><thead><tr><th></th><th><i class="lg-a"></i>A 지금대로</th><th><i class="lg-b"></i>B 실행하면</th></tr></thead><tbody>',
      row('노동 수명', A.W + '세까지', B.W + '세까지'),
      row('은퇴 시 쓸 수 있는 돈', asset(A.assetsW), asset(B.assetsW)),
      row('경제적 자유', A.freedom === null ? '80세 이후' : age(A.freedom), B.freedom === null ? '80세 이후' : age(B.freedom)),
      row('자산이 버티는 나이', age(A.dep), age(B.dep)),
      '</tbody></table>'
    );
    if (bNote) html.push('<p class="note">' + bNote + '</p>');
    if (n) {
      html.push('<p class="note">수익률이 1%p 낮은 경우에도 B는 ' + age(r.B.low.dep) + (r.B.low.dep >= 100 ? ' 유지됩니다.' : '까지 유지됩니다.') + '</p>');
      var dl = r.delay, parts = [];
      if (dl.dAsset < -1) parts.push('은퇴 자산이 ' + asset(-dl.dAsset) + ' 줄고');
      if (dl.dFreedom > 0) parts.push('경제적 자유가 ' + dl.dFreedom + '년 늦어지고');
      if (dl.dDep < 0) parts.push('자산이 버티는 나이가 ' + (-dl.dDep) + '년 짧아집니다');
      if (parts.length) {
        var tail = parts.join(', ');
        html.push('<p class="note">이 계획을 ' + dl.years + '년 미루면 ' + tail + (/집니다$/.test(tail) ? '.' : ' 합니다.') + '</p>');
      }
    }
    html.push('</section>');

    /* 자산 곡선 */
    var tj = trajectory(r);
    var tAges = [P.age];
    for (var ta = Math.floor(P.age / 5) * 5 + 5; ta <= 100; ta += 5) tAges.push(ta);
    var tableRows = tAges.map(function (a) {
      return '<tr><td>' + a + '세</td><td>' + asset(valAt(r.traces.A, a)) + '</td><td>' + asset(valAt(r.traces.B, a)) + '</td></tr>';
    });
    html.push(
      '<section class="card"><p class="sec"><i class="in"></i>ASSET PATH</p><h3>쓸 수 있는 자산의 흐름</h3>',
      '<ul class="legend"><li><i class="ln lg-a"></i>A 지금대로</li><li><i class="ln lg-b"></i>B 해야 할 일을 하면</li></ul>',
      '<div class="chart">' + tj.svg + '<div class="tip" id="tcTip" hidden></div></div>',
      '<details><summary>표로 보기</summary><table><thead><tr><th>나이</th><th>A 지금대로</th><th>B 실행하면</th></tr></thead><tbody>' + tableRows.join('') + '</tbody></table></details>',
      '<p class="note">오늘 가치 기준이며, 집(보증금)에 묶인 자산은 제외하고 자가의 경우 일부만 포함합니다.</p>',
      '</section>'
    );

    /* 계산 방식 */
    html.push(
      '<details><summary>계산 방식과 가정 보기</summary>',
      '<p>입력값으로 현재 궤적(A)을 시뮬레이션하고, 저축·소득·수익률·주거·노동 수명·부업 등을 조합한 <b>' + r.counts.total.toLocaleString('ko-KR') + '가지 경우의 수</b>를 같은 방식으로 계산했습니다. 그중 현실 범위(난이도 ' + E.MAX_DIFFICULTY + ' 이하)는 ' + r.counts.realistic.toLocaleString('ko-KR') + '가지, 90세까지 안전한 조합은 ' + r.counts.goal.toLocaleString('ko-KR') + '가지였고, 그중 가장 부담이 적은 조합을 B로 골랐습니다.</p>',
      '<ul>' + D.assumptions.map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ul>',
      '</details>'
    );

    html.push(
      '<div class="btns"><button class="ghost" id="saveImg" type="button">이미지로 저장</button><button class="ghost" id="share" type="button">공유하기</button></div>',
      '<div class="btns"><button class="ghost" id="again" type="button">다시 해보기</button></div>',
      '<p class="foot">입력하신 정보는 서버로 전송되거나 저장되지 않으며, 이 화면을 닫으면 사라집니다.</p>'
    );

    resultEl.innerHTML = html.join('');
    Array.prototype.forEach.call(resultEl.querySelectorAll('.bar i'), function (el) {
      el.style.width = el.getAttribute('data-w') + '%';
    });
    bindTrajectory(r, tj.geo);
    $('again').addEventListener('click', function () {
      resultEl.hidden = true; resultEl.innerHTML = '';
      form.hidden = false; intro.hidden = false; progressEl.hidden = false;
      window.scrollTo(0, 0);
    });
    $('saveImg').addEventListener('click', saveImage);
    $('share').addEventListener('click', share);
  }

  function stat(k, v, s) {
    return '<div class="stat"><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="s">' + s + '</div></div>';
  }
  function row(k, a, b) {
    return '<tr><td>' + k + '</td><td>' + a + '</td><td class="vb">' + b + '</td></tr>';
  }

  /* ---------- 공유 ---------- */
  // 공유 문구·이미지에는 소득·자산 같은 원본 수치를 담지 않는다.
  function summaryText(r) {
    var A = r.A.mid, B = r.B.mid;
    if (r.mode === 'settled') return '나의 자본주의 팔자: 지금 궤적으로도 ' + r.planAge + '세까지 안전하대요.';
    return '나의 자본주의 팔자: 지금대로면 ' + age(A.dep) + '에 자산이 바닥, 해야 할 일을 하면 ' + age(B.dep) + (B.dep >= 100 ? '' : '까지') + ' 유지.';
  }

  function share() {
    if (!lastResult) return;
    var text = summaryText(lastResult);
    var url = location.href.split('#')[0];
    if (navigator.share) {
      navigator.share({ title: '자본주의 팔자 리포트', text: text, url: url }).catch(function () {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text + ' ' + url).then(function () { alert('공유 문구를 복사했어요.'); });
    }
  }

  function saveImage() {
    if (!lastResult) return;
    var r = lastResult, A = r.A.mid, B = r.B.mid, a0 = r.profile.age;
    var W = 1080, H = 1350;
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var g = c.getContext('2d');
    var font = 'system-ui,-apple-system,"Apple SD Gothic Neo","Noto Sans KR","Malgun Gothic",sans-serif';

    var bg = g.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#0c1a2e'); bg.addColorStop(1, '#173561');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,255,255,.05)'; g.lineWidth = 1;
    for (var gy = 0; gy < H; gy += 54) { g.beginPath(); g.moveTo(0, gy); g.lineTo(W, gy); g.stroke(); }

    g.fillStyle = '#8fb4ee'; g.font = '700 30px ' + font; g.fillText('자본주의 팔자 리포트', 80, 120);
    g.fillStyle = '#a9b8d1'; g.font = '600 34px ' + font; g.fillText('자산이 버티는 나이', 80, 250);

    var aTxt = A.dep >= 100 ? '100+' : String(A.dep), bTxt = B.dep >= 100 ? '100+' : String(B.dep);
    var bigFont = '800 150px ' + font, arrowFont = '600 90px ' + font;
    g.fillStyle = '#ffffff'; g.font = bigFont;
    g.fillText(aTxt + '세', 80, 420);
    if (r.mode !== 'settled') {
      var wA = g.measureText(aTxt + '세').width;
      g.font = arrowFont; var wArrow = g.measureText('→').width;
      g.fillStyle = '#8fb4ee'; g.fillText('→', 80 + wA + 36, 400);
      g.fillStyle = '#ffffff'; g.font = bigFont; g.fillText(bTxt + '세', 80 + wA + 36 + wArrow + 36, 420);
    }

    // 타임라인(두 줄)
    var bx = 80, bw = W - 160;
    var xs = function (a) { return bx + (a - a0) / (100 - a0) * bw; };
    function bar(y, res, solid, tint, label) {
      g.fillStyle = '#ffffff'; g.font = '700 32px ' + font; g.fillText(label, bx, y - 18);
      g.globalAlpha = 0.4; g.fillStyle = tint; g.fillRect(xs(a0), y, xs(res.W) - xs(a0) - 3, 46);
      g.globalAlpha = 1;
      if (res.dep > res.W) { g.fillStyle = solid; g.fillRect(xs(res.W) + 1, y, xs(Math.min(res.dep, 100)) - xs(res.W) - 3, 46); }
      if (res.dep < 100) { g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 2; g.strokeRect(xs(res.dep) + 1, y + 1, xs(100) - xs(res.dep) - 2, 44); }
    }
    bar(580, A, '#d95926', '#d95926', 'A  지금대로');
    if (r.mode !== 'settled') bar(710, B, '#3987e5', '#3987e5', 'B  해야 할 일을 하면');
    g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(xs(90), 520); g.lineTo(xs(90), 790); g.stroke();
    g.fillStyle = '#a9b8d1'; g.font = '500 26px ' + font; g.textAlign = 'center'; g.fillText('90세', xs(90), 505); g.textAlign = 'left';

    if (r.mode !== 'settled') {
      g.fillStyle = '#ffffff'; g.font = '700 38px ' + font;
      r.actions.slice(0, 3).forEach(function (a, i) {
        var t = a.label.length > 26 ? a.label.slice(0, 25) + '…' : a.label;
        g.fillText((i + 1) + '. ' + t, 80, 920 + i * 78);
      });
    }
    g.fillStyle = '#7f8ea8'; g.font = '500 28px ' + font;
    g.fillText('입력 정보는 서버로 전송되거나 저장되지 않습니다', 80, 1270);

    c.toBlob(function (blob) {
      if (!blob) return;
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'capitalism-palja.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    }, 'image/png');
  }

  updateProgress();
})();
