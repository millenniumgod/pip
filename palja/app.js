/* 자본주의 팔자 리포트 - 화면 로직
 * 입력값은 메모리에만 존재한다. 서버 전송·localStorage·쿠키·URL 파라미터 어디에도 저장하지 않는다.
 */
(function () {
  'use strict';

  var D = window.PaljaData;
  var E = window.PaljaEngine;
  var $ = function (id) { return document.getElementById(id); };

  var form = $('form'), intro = $('intro'), resultEl = $('result');
  var lastResult = null;

  /* ---------- 폼 초기화 ---------- */
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

  ['startPay', 'curPay', 'netWorth'].forEach(function (id) {
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

  function setError(field, msg) {
    var box = form.querySelector('[data-field="' + field + '"] .err');
    box.textContent = msg || '';
    box.hidden = !msg;
  }

  function readInput() {
    var errors = {};
    var birth = +birthSel.value, entry = +entrySel.value;
    var tier = radio('tier'), role = radio('role'), housing = radio('housing');
    var startPay = num('startPay'), curPay = num('curPay'), net = num('netWorth');

    if (!birth) errors.birth = '태어난 해를 선택해 주세요.';
    if (!entry) errors.entry = '첫 진출 연도를 선택해 주세요.';
    if (!tier) errors.tier = '첫 직장을 선택해 주세요.';
    if (!role) errors.role = '현재 직무를 선택해 주세요.';
    if (!(startPay >= 300 && startPay <= 100000)) errors.startPay = '300 ~ 100,000만 원 사이로 입력해 주세요.';
    if (!(curPay >= 300 && curPay <= 100000)) errors.curPay = '300 ~ 100,000만 원 사이로 입력해 주세요.';
    if (!housing) errors.housing = '현재 사는 집을 선택해 주세요.';
    if (isNaN(net)) errors.netWorth = '순자산을 입력해 주세요. 없으면 0을 적어주세요.';

    ['birth', 'entry', 'tier', 'role', 'startPay', 'curPay', 'housing', 'netWorth'].forEach(function (f) {
      setError(f, errors[f]);
    });
    var first = Object.keys(errors)[0];
    if (first) {
      form.querySelector('[data-field="' + first + '"]').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return null;
    }
    return {
      birth: birth, entry: entry, tier: tier, role: role,
      startPay: startPay, curPay: curPay, housing: housing,
      netWorth: $('negative').checked ? -net : net
    };
  }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var input = readInput();
    if (!input) return;
    lastResult = E.analyze(input);
    render(lastResult);
    form.hidden = true;
    intro.hidden = true;
    resultEl.hidden = false;
    window.scrollTo(0, 0);
  });

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

  /* ---------- 결과 렌더링 ---------- */
  function render(r) {
    var P = r.profile, A = r.A.mid, B = r.B.mid, diag = r.diag;
    var plan = r.planAge;
    var html = [];

    /* A: 지금 궤적 */
    var depLine = A.dep >= plan
      ? '노후 자산은 ' + plan + '세까지 버팁니다.'
      : age(A.dep) + '쯤 자산이 바닥납니다. ' + plan + '세까지 ' + (plan - A.dep) + '년이 모자랍니다.';
    html.push(
      '<section class="card a">',
      '<p class="kicker">A · 지금 데이터대로 가면</p>',
      '<h2>당신은 ' + A.W + '세까지 일하고, ' + depLine + '</h2>',
      '<div class="stats">',
      stat('노동 수명', (A.W - P.age) + '년 남음', A.W + '세까지'),
      stat('은퇴 시 자산', asset(A.assetsW), '오늘 가치 기준'),
      stat('경제적 자유', A.freedom === null ? '80세 이후' : age(A.freedom), A.freedom !== null && A.freedom > A.W ? '노동 수명보다 ' + (A.freedom - A.W) + '년 늦음' : A.freedom !== null ? '노동 수명 안에 도달' : '일을 계속해도 닿기 어려움'),
      stat('자산이 버티는 나이', age(A.dep), '범위 ' + age(r.A.low.dep) + ' ~ ' + age(r.A.high.dep)),
      '</div>',
      '<p class="note">범위는 투자 수익률이 ±1%p 달라지는 경우입니다.</p>',
      '</section>'
    );

    /* 4개 축 */
    var axes = [
      { key: 'era', name: '시대운', d: diag.era, text: diag.era.year + '년 취업 — 실업률 ' + diag.era.unemp + '%, 성장률 ' + diag.era.gdp + '%' + (diag.era.crisis ? ', ' + diag.era.crisis + ' 여파' : '') + '. 진입 난이도는 ' + diag.era.label + '이었습니다.' },
      { key: 'job', name: '직장운', d: diag.job, text: '첫 직장 ' + diag.job.tier + ', 현재 ' + diag.job.role + '. 소득을 유지할 수 있는 나이를 ' + diag.job.workEnd + '세로 봅니다.' },
      { key: 'income', name: '소득운', d: diag.income, text: '연봉은 연평균 ' + pct(diag.income.cagr) + '% 올랐고 같은 기간 물가는 ' + pct(diag.income.avgInfl) + '% 올랐습니다. 실질로 ' + (diag.income.realCagr >= 0 ? '연 ' + pct(diag.income.realCagr) + '%p 앞섰습니다.' : '연 ' + pct(-diag.income.realCagr) + '%p 뒤처졌습니다.') },
      { key: 'asset', name: '자산운', d: diag.asset, text: '순자산은 은퇴 목표(' + asset(diag.asset.target) + ')의 ' + pct(Math.max(0, diag.asset.progress), 0) + '% 수준이고, 추정 저축률은 ' + pct(diag.asset.saveRate, 0) + '%입니다.' }
    ];
    var weakest = axes.slice().sort(function (x, y) { return x.d.score - y.d.score; })[0];
    var weakMsg = {
      era: '시대는 바꿀 수 없습니다. 나머지 세 축으로 만회해야 합니다.',
      job: '소득을 유지할 수 있는 기간이 짧은 편입니다. 노동 수명이 곧 자산입니다.',
      income: '연봉 상승이 물가를 겨우 따라가고 있습니다. 소득을 올리는 쪽이 가장 큰 변수입니다.',
      asset: '나이 대비 자산 축적이 느립니다. 저축과 운용 방식이 가장 큰 변수입니다.'
    };
    html.push('<section class="card"><p class="kicker">왜 이렇게 나왔나</p><h2>4개 축 진단</h2><ul class="axes">');
    axes.forEach(function (a) {
      html.push('<li class="' + (a === weakest ? 'weak' : '') + '"><div class="row"><span>' + a.name + '</span><b>' + a.d.score + '점</b></div>',
        '<div class="bar"><i data-w="' + a.d.score + '"></i></div><p>' + a.text + '</p></li>');
    });
    html.push('</ul><p class="weak-note">가장 약한 고리: ' + weakest.name + ' — ' + weakMsg[weakest.key] + '</p></section>');

    /* B: 해야 할 일 */
    var n = r.actions.length;
    var bTitle, bNote = '';
    if (r.mode === 'close') bTitle = plan + '세까지 안전하게 가려면, 이 ' + n + '가지를 하세요.';
    else if (r.mode === 'partial') {
      bTitle = '현실적인 범위에서 최대로 끌어올리면 ' + age(B.dep) + '까지입니다. 이 ' + n + '가지는 꼭 하세요.';
      if (B.dep < plan) bNote = '그래도 ' + (plan - B.dep) + '년이 모자랍니다. 지출 수준 자체를 낮추거나 소득 구조를 바꾸는 더 큰 결정이 필요합니다.';
    } else if (r.mode === 'already') bTitle = '이미 노후 안전선입니다. 더 일찍 자유로워지려면 이 ' + n + '가지입니다.';
    else bTitle = '지금 궤적이 이미 ' + plan + '세까지 안전합니다. 지금의 저축과 직무를 지키세요.';

    html.push('<section class="card b"><p class="kicker">B · 더 잘 살려면</p><h2>' + bTitle + '</h2>');
    if (n) {
      html.push('<ol class="actions">');
      r.actions.forEach(function (a) {
        var eff = '은퇴 자산 ' + plus(a.dAsset) + (a.dDep > 0 ? ' · 버티는 나이 +' + a.dDep + '년' : '');
        html.push('<li><div class="t">' + a.label + '</div><p class="d">' + a.detail + '</p>',
          '<div class="m"><span class="eff">단독 효과: ' + eff + '</span><span>시기: ' + a.timing + '</span><span>난이도 ' + stars(a.diff) + '</span></div></li>');
      });
      html.push('</ol>');
    }
    html.push(
      '<table class="cmp"><thead><tr><th></th><th>A 지금대로</th><th>B 실행하면</th></tr></thead><tbody>',
      row('노동 수명', A.W + '세까지', B.W + '세까지'),
      row('은퇴 시 자산', asset(A.assetsW), asset(B.assetsW)),
      row('경제적 자유', A.freedom === null ? '80세 이후' : age(A.freedom), B.freedom === null ? '80세 이후' : age(B.freedom)),
      row('자산이 버티는 나이', age(A.dep), age(B.dep)),
      '</tbody></table>'
    );
    if (bNote) html.push('<p class="note">' + bNote + '</p>');
    if (n) {
      html.push('<p class="note">수익률이 1%p 낮은 경우에도 B는 ' + age(r.B.low.dep) + '까지 유지됩니다.</p>');
      var dl = r.delay, parts = [];
      if (dl.dAsset < -1) parts.push('은퇴 자산이 ' + asset(-dl.dAsset) + ' 줄고');
      if (dl.dFreedom > 0) parts.push('경제적 자유가 ' + dl.dFreedom + '년 늦어지고');
      if (dl.dDep < 0) parts.push('자산이 버티는 나이가 ' + (-dl.dDep) + '년 짧아집니다');
      if (parts.length) {
        var tail = parts.join(', ');
        html.push('<p class="note">⏳ 이 계획을 ' + dl.years + '년 미루면 ' + tail + (/집니다$/.test(tail) ? '.' : ' 합니다.') + '</p>');
      }
    }
    html.push('</section>');

    /* 계산 방식·한계 */
    html.push(
      '<details><summary>계산 방식과 가정 보기</summary>',
      '<p>입력값으로 현재 궤적(A)을 시뮬레이션하고, 저축·소득·수익률·주거·노동 수명·부업 등을 조합한 <b>' + r.counts.total.toLocaleString('ko-KR') + '가지 경우의 수</b>를 같은 방식으로 계산했습니다. 그중 현실 범위(난이도 ' + E.MAX_DIFFICULTY + ' 이하)는 ' + r.counts.realistic.toLocaleString('ko-KR') + '가지, 90세까지 안전한 조합은 ' + r.counts.goal.toLocaleString('ko-KR') + '가지였고, 그중 가장 부담이 적은 조합을 B로 골랐습니다.</p>',
      '<ul>' + D.assumptions.map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ul>',
      '</details>'
    );

    html.push(
      '<div class="btns"><button class="ghost" id="saveImg" type="button">이미지로 저장</button><button class="ghost" id="share" type="button">공유하기</button></div>',
      '<div class="btns"><button class="ghost" id="again" type="button">다시 해보기</button></div>',
      '<p class="foot">🔒 입력하신 정보는 서버로 전송되거나 저장되지 않으며, 이 화면을 닫으면 사라집니다.<br>공개 통계 기반의 추정 모델입니다. 투자 권유나 개인 맞춤 재무 상담이 아닙니다.</p>'
    );

    resultEl.innerHTML = html.join('');
    Array.prototype.forEach.call(resultEl.querySelectorAll('.bar i'), function (el) {
      el.style.width = el.getAttribute('data-w') + '%';
    });
    $('again').addEventListener('click', function () {
      resultEl.hidden = true; resultEl.innerHTML = '';
      form.hidden = false; intro.hidden = false;
      window.scrollTo(0, 0);
    });
    $('saveImg').addEventListener('click', saveImage);
    $('share').addEventListener('click', share);
  }

  function stat(k, v, s) {
    return '<div class="stat"><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="s">' + s + '</div></div>';
  }
  function row(k, a, b) {
    return '<tr><td>' + k + '</td><td class="va">' + a + '</td><td class="vb">' + b + '</td></tr>';
  }

  /* ---------- 공유 ---------- */
  // 공유 문구·이미지에는 연봉·자산 같은 원본 수치를 담지 않는다.
  function summaryText(r) {
    var A = r.A.mid, B = r.B.mid;
    if (r.mode === 'settled') return '나의 자본주의 팔자: 지금 궤적으로도 ' + r.planAge + '세까지 안전하대요.';
    return '나의 자본주의 팔자: 지금대로면 ' + age(A.dep) + '에 자산이 바닥, 해야 할 일을 하면 ' + age(B.dep) + '까지 유지.';
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
    var r = lastResult, A = r.A.mid, B = r.B.mid;
    var W = 1080, H = 1350;
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var g = c.getContext('2d');
    var font = '"Apple SD Gothic Neo","Noto Sans KR","Malgun Gothic",sans-serif';

    g.fillStyle = '#14161a'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#6c93ff'; g.font = '700 38px ' + font; g.fillText('자본주의 팔자 리포트', 80, 120);

    function block(y, color, tag, big, small) {
      g.fillStyle = color; g.font = '800 34px ' + font; g.fillText(tag, 80, y);
      g.fillStyle = '#eceef2'; g.font = '800 76px ' + font; g.fillText(big, 80, y + 100);
      g.fillStyle = '#a0a7b2'; g.font = '500 36px ' + font; g.fillText(small, 80, y + 165);
    }
    var aBig = A.dep >= r.planAge ? r.planAge + '세까지 안전' : age(A.dep) + '에 자산 소진';
    block(280, '#ff8d77', 'A · 지금대로 가면', aBig, A.W + '세까지 일하고, 은퇴 시 자산 ' + asset(A.assetsW));
    if (r.mode !== 'settled') {
      var bBig = B.dep >= r.planAge ? r.planAge + '세 이상 유지' : age(B.dep) + '까지 유지';
      block(640, '#5fd39c', 'B · 해야 할 일을 하면', bBig, '경제적 자유 ' + (B.freedom === null ? '80세 이후' : age(B.freedom)));
      g.fillStyle = '#eceef2'; g.font = '600 34px ' + font;
      r.actions.slice(0, 3).forEach(function (a, i) {
        var t = a.label.length > 24 ? a.label.slice(0, 23) + '…' : a.label;
        g.fillText((i + 1) + '. ' + t, 80, 930 + i * 64);
      });
    }
    g.fillStyle = '#6b7280'; g.font = '500 28px ' + font;
    g.fillText('공개 통계 기반의 추정 모델 · 입력 정보는 저장되지 않습니다', 80, 1270);

    c.toBlob(function (blob) {
      if (!blob) return;
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'capitalism-palja.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    }, 'image/png');
  }
})();
