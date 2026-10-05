// ===== 기본 정보 (여기만 바꾸면 전체 반영) =====
const CONTACT_EMAIL = 'cnlcg@cnlcg.co.kr';

(function(){
  // 예전 초대 링크(주소 뒤 ?code=)로 들어온 경우 PIP 로그인 화면으로 넘김
  if (new URLSearchParams(location.search).get('code')) {
    location.replace('/pip/' + location.search);
    return;
  }

  const mailto = 'mailto:' + CONTACT_EMAIL + '?subject=' + encodeURIComponent('[CNL Works] 교육 문의');
  const cm = document.getElementById('contact-mail'); cm.href = mailto; cm.textContent = CONTACT_EMAIL;
  const fm = document.getElementById('foot-mail'); fm.href = mailto; fm.textContent = CONTACT_EMAIL;
  document.querySelectorAll('.pv-mail').forEach(el => el.textContent = CONTACT_EMAIL);

  // ----- 교육 문의 양식 → /api/inquiry (서버 함수가 메일 발송) -----
  const form = document.getElementById('inq');
  const msg = document.getElementById('inq-msg');
  const sendBtn = document.getElementById('inq-send');
  let formShownAt = Date.now();
  form.addEventListener('input', () => { msg.textContent = ''; });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = form.elements;
    const data = {
      company: f.company.value.trim(), name: f.name.value.trim(), email: f.email.value.trim(),
      phone: f.phone.value.trim(), headcount: f.headcount.value.trim(), message: f.message.value.trim(),
      topics: [...form.querySelectorAll('input[name=topics]:checked')].map(x => x.value),
      consent: f.consent.checked, website: f.website.value, elapsedMs: Date.now() - formShownAt
    };
    const bad = (el, text) => { msg.textContent = text; el.focus(); };
    if (!data.company) return bad(f.company, '회사명을 입력해 주세요.');
    if (!data.name) return bad(f.name, '담당자 성명을 입력해 주세요.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return bad(f.email, '이메일 주소를 확인해 주세요.');
    if (data.message.length < 10) return bad(f.message, '문의 내용을 10자 이상 적어 주세요.');
    if (!data.consent) return bad(f.consent, '개인정보 수집·이용에 동의해 주세요.');
    sendBtn.disabled = true; sendBtn.textContent = '보내는 중…';
    try {
      const r = await fetch('/api/inquiry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.message || '문의를 보내지 못했습니다. 메일로 직접 보내 주세요.');
      form.reset(); form.hidden = true; document.getElementById('inq-done').hidden = false;
    } catch (err) {
      msg.textContent = err.message && !/fetch|network/i.test(err.message) ? err.message : '문의를 보내지 못했습니다. 메일로 직접 보내 주세요.';
    } finally {
      sendBtn.disabled = false; sendBtn.textContent = '문의 보내기';
    }
  });
  function prepContact(sub){
    formShownAt = Date.now();
    form.hidden = false; document.getElementById('inq-done').hidden = true;
    const map = { pip1: 'PIP Package 1(원스톱 과정)', pip2: 'PIP Package 2(맞춤 컨설팅)', harassment: '직장 내 괴롭힘 행위자 교육', 'sexual-harassment': '직장 내 성희롱 행위자 교육', investigator: '직장 내 괴롭힘 조사관 과정', 'sexual-investigator': '직장 내 성희롱 조사관 과정' };
    if (sub && map[sub]) form.querySelectorAll('input[name=topics]').forEach(x => { if (x.value === map[sub]) x.checked = true; });
  }


  // ----- 공용: 홈페이지 API (/api/site) -----
  async function site(action, data){
    const r = await fetch('/api/site', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...data }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.message || '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    return j;
  }
  const escH = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

  // ----- 직장 내 괴롭힘 예방교육 신청 -----
  const ap = document.getElementById('ap'), apMsg = document.getElementById('ap-msg'), apBtn = document.getElementById('ap-send');
  let apShownAt = Date.now(), apProgram = 'harassment';
  const AP_STEPS_EDU = document.getElementById('ap-steps').innerHTML;
  const AP_STEPS_INV = '<li><b>신청서 작성</b><span>교육 정보와 담당자를 알려 주세요.</span></li><li><b>견적 · 계약</b><span>견적서와 계약서를 메일로 보내드립니다.</span></li><li><b>방문 강의</b><span>공인노무사가 사업장에서 직접 강의합니다.</span></li><li><b>시험 · 실습 과제</b><span>시험과 과제를 검토한 뒤 수료증을 발급합니다.</span></li>';
  function prepApply(program){
    apProgram = ['sexual', 'investigator', 'sexual-investigator'].includes(program) ? program : 'harassment';
    const inv = apProgram === 'investigator' || apProgram === 'sexual-investigator';
    const sexual = apProgram === 'sexual' || apProgram === 'sexual-investigator';
    const label = sexual ? '직장 내 성희롱' : '직장 내 괴롭힘';
    const page = (sexual ? '#/sexual-harassment' : '#/harassment') + (inv ? '/investigator' : '/prevention');
    document.getElementById('ap-h1').textContent = label + (inv ? ' 조사관 과정 방문 교육 신청' : ' 예방교육 신청');
    const cr = document.getElementById('ap-crumb'); cr.textContent = inv ? '조사관 과정' : '예방교육'; cr.href = page;
    const bk = document.getElementById('ap-back'); bk.textContent = (inv ? '조사관 과정' : '예방교육') + ' 안내로'; bk.href = page;
    document.getElementById('ap-steps').innerHTML = inv ? AP_STEPS_INV : AP_STEPS_EDU;
    document.getElementById('ap-mode').classList.toggle('hidden', inv);
    document.getElementById('ap-mail-hint').textContent = inv ? '견적서와 계약서, 교육 일정 안내를 이 이메일로 보내드립니다.' : '담당자 이메일은 계약 후 담당자 화면(직원별 수료 현황, 수료증 출력)의 로그인 주소로 쓰입니다.';
    if (inv) { const off = ap.querySelector('input[name=mode][value=offline]'); if (off) off.checked = true; }
    apShownAt = Date.now(); ap.hidden = false; document.getElementById('ap-done').hidden = true; togglePlace();
  }
  function togglePlace(){ const m = (ap.querySelector('input[name=mode]:checked') || {}).value; document.getElementById('ap-place-l').classList.toggle('hidden', m === 'online'); }
  ap.querySelectorAll('input[name=mode]').forEach(x => x.addEventListener('change', togglePlace));
  ap.addEventListener('input', () => { apMsg.textContent = ''; });
  ap.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = ap.elements, v = (n) => f[n].value.trim();
    const d = { program: apProgram, company: v('company'), bizNo: v('bizNo'), name: v('name'), title: v('title'), phone: v('phone'),
      email: v('email'), billEmail: v('billEmail'), headcount: v('headcount'), when: v('when'), place: v('place'), question: v('question'),
      mode: (ap.querySelector('input[name=mode]:checked') || {}).value, consent: f.consent.checked, agreeTerms: f.agreeTerms.checked,
      website: f.website.value, elapsedMs: Date.now() - apShownAt };
    const bad = (el, t) => { apMsg.textContent = t; el.focus(); };
    if (!d.company) return bad(f.company, '회사명을 입력해 주세요.');
    if (d.name.length < 2) return bad(f.name, '담당자 성명을 입력해 주세요.');
    if (!/^[0-9+\-() ]{7,30}$/.test(d.phone)) return bad(f.phone, '연락처를 확인해 주세요.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) return bad(f.email, '담당자 이메일을 확인해 주세요.');
    if (!(+d.headcount > 0)) return bad(f.headcount, '교육 대상 인원을 입력해 주세요.');
    if (d.mode !== 'online' && !d.place) return bad(f.place, '집합교육 장소를 입력해 주세요.');
    if (!d.consent) return bad(f.consent, '개인정보 수집·이용에 동의해 주세요.');
    if (!d.agreeTerms) return bad(f.agreeTerms, '확인 항목에 체크해 주세요.');
    apBtn.disabled = true; apBtn.textContent = '보내는 중…';
    try {
      const r = await site('contract', d);
      ap.reset(); ap.hidden = true; document.getElementById('ap-done').hidden = false;
      document.getElementById('ap-no').textContent = '접수 번호: ' + r.id;
      window.scrollTo(0, 0);
    } catch (err) { apMsg.textContent = err.message; }
    finally { apBtn.disabled = false; apBtn.textContent = '교육 신청하기'; }
  });


  // ----- 강의 목록 · 샘플 강의 -----
  const fmtMin = (sec) => { sec = Math.max(0, Math.round(sec || 0)); const m = Math.floor(sec / 60), s = sec % 60;
    return m ? m + '분' + (s ? ' ' + s + '초' : '') : s + '초'; };
  function lectureRows(videos, sampleKey){
    return '<div class="vlist">' + videos.map((v, i) => '<div class="vrow"><span class="vno">' + (i + 1) + '강</span>' +
      '<span class="vtitle">' + escH(v.title) + '</span>' +
      (i === 0 && sampleKey ? '<button class="vsample" data-sample="' + escH(sampleKey) + '">샘플 보기</button>'
        : '<span class="vdur">' + (v.durationSec ? escH(fmtMin(v.durationSec)) : '') + '</span>') +
      '</div>').join('') + '</div>';
  }
  const totalSec = (vs) => vs.reduce((a, v) => a + (v.durationSec || 0), 0);

  // 샘플 재생
  const sampleModal = document.getElementById('sample-modal');
  document.getElementById('sample-close').onclick = closeSample;
  sampleModal.addEventListener('click', e => { if (e.target === sampleModal) closeSample(); });
  function closeSample(){ document.getElementById('sample-frame').src = 'about:blank'; sampleModal.classList.add('hidden'); }
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-sample]'); if (!b) return;
    b.disabled = true; const old = b.textContent; b.textContent = '여는 중…';
    try {
      const r = await site('sample', { key: b.dataset.sample });
      if (!r.libraryId) throw new Error('영상 설정이 아직 준비되지 않았습니다.');
      document.getElementById('sample-title').textContent = r.title || '샘플 강의';
      document.getElementById('sample-frame').src =
        'https://iframe.mediadelivery.net/embed/' + r.libraryId + '/' + r.videoId +
        '?token=' + r.token + '&expires=' + r.expires + '&autoplay=true&preload=true';
      sampleModal.classList.remove('hidden');
    } catch (err) { alert(err.message); }
    finally { b.disabled = false; b.textContent = old; }
  });

  // PIP 강의 구성 (8주 기준)
  let pipCurriLoaded = false;
  async function loadPipCurriculum(){
    if (pipCurriLoaded) return;
    pipCurriLoaded = true;
    try {
      const r = await site('pipCurriculum', {});
      if (!r.available) return;
      const box = document.getElementById('pip-curri');
      box.innerHTML = r.weeks.map(w => '<div class="wk"><h3>' + w.week + '주차</h3>' +
        lectureRows(w.items, w.week === r.weeks[0].week && r.sampleFree ? 'pip' : null) + '</div>').join('') +
        '<p class="vlist-sum">전체 ' + r.lectureCount + '강</p>';
      document.getElementById('pip-curri-sec').hidden = false;
    } catch (e) { pipCurriLoaded = false; }
  }

  // ----- 개인 수강 신청 · 결제 (토스페이먼츠) -----
  const ORDER_INFO = {
    'harassment-offender': { label: '직장 내 괴롭힘', page: '#/harassment/offender', kind: '재발방지 교육',
      title: '직장 내 괴롭힘 재발방지 교육', reasons: ['징계 절차 진행 중(개선 노력 자료)', '징계 후 회사의 교육 지시', '기타'] },
    'sexual-offender': { label: '직장 내 성희롱', page: '#/sexual-harassment/offender', kind: '재발방지 교육',
      title: '직장 내 성희롱 재발방지 교육', reasons: ['징계 절차 진행 중(개선 노력 자료)', '징계 후 회사의 교육 지시', '기타'] },
    'harassment-investigator': { label: '직장 내 괴롭힘', page: '#/harassment/investigator', kind: '조사관 과정 · Package 1 온라인',
      title: '직장 내 괴롭힘 조사관 과정', reasons: ['사내 조사 업무 담당', '고충처리 담당', '관리자 역량 강화', '기타'] },
    'sexual-investigator': { label: '직장 내 성희롱', page: '#/sexual-harassment/investigator', kind: '조사관 과정 · Package 1 온라인',
      title: '직장 내 성희롱 조사관 과정', reasons: ['사내 조사 업무 담당', '고충처리 담당', '관리자 역량 강화', '기타'] }
  };
  const od = document.getElementById('od'), odMsg = document.getElementById('od-msg'), odBtn = document.getElementById('od-pay');
  let odKey = null, odInfo = null, odShownAt = Date.now(), odCourse = null;
  const won = (n) => Number(n).toLocaleString('ko-KR') + '원';

  async function prepOrder(key){
    odKey = ORDER_INFO[key] ? key : 'harassment-investigator';
    odInfo = ORDER_INFO[odKey]; odShownAt = Date.now(); odCourse = null;
    odMsg.textContent = ''; odBtn.disabled = false; odBtn.textContent = '결제하고 수강 시작';
    document.getElementById('od-curri').hidden = true; document.getElementById('od-videos').innerHTML = '';
    document.getElementById('od-h1').textContent = odInfo.title;
    const cr = document.getElementById('od-crumb'); cr.textContent = odInfo.label; cr.href = odInfo.page;
    document.getElementById('od-kind').textContent = odInfo.kind;
    document.getElementById('od-title').textContent = odInfo.title;
    document.getElementById('od-price').textContent = '-';
    document.getElementById('od-sum').innerHTML = '';
    document.getElementById('od-note').textContent = '';
    od.elements.reason.innerHTML = '<option value="">선택하세요</option>' + odInfo.reasons.map(r => '<option>' + escH(r) + '</option>').join('');
    try {
      const c = await site('courseInfo', { key: odKey });
      odCourse = c;
      if (!c.available) {
        document.getElementById('od-title').textContent = odInfo.title;
        document.getElementById('od-note').textContent = '아직 수강 신청을 받지 않는 과정입니다. 교육 문의를 이용해 주세요.';
        odBtn.disabled = true; return;
      }
      document.getElementById('od-title').textContent = c.title || odInfo.title;
      const rows = [];
      if (c.hoursLabel) rows.push(['교육 시간', c.hoursLabel]);
      if (c.videoCount) rows.push(['강의', c.videoCount + '개']);
      rows.push(['수강 방식', '온라인']);
      rows.push(['수강 기간', '결제일부터 90일']);
      document.getElementById('od-sum').innerHTML = rows.map(r => '<dt>' + escH(r[0]) + '</dt><dd>' + escH(r[1]) + '</dd>').join('');
      const vids = c.videos || [];
      if (vids.length) {
        document.getElementById('od-videos').innerHTML = lectureRows(vids, c.sampleFree ? odKey : null) +
          '<p class="vlist-sum">전체 ' + vids.length + '강' + (totalSec(vids) ? ' · 총 ' + fmtMin(totalSec(vids)) : '') +
          (c.sampleFree ? ' · 1강은 신청 전에도 볼 수 있습니다.' : '') + '</p>';
        document.getElementById('od-curri').hidden = false;
      }
      if (c.price) {
        document.getElementById('od-price').textContent = won(c.price);
        document.getElementById('od-note').textContent = '부가세 포함 금액입니다. 결제 후 교육센터에서 바로 수강할 수 있습니다.';
      } else {
        document.getElementById('od-price').textContent = '준비 중';
        document.getElementById('od-note').textContent = '가격을 준비하고 있습니다. 교육 문의를 이용해 주세요.';
        odBtn.disabled = true;
      }
    } catch (e) {
      document.getElementById('od-note').textContent = e.message;
      odBtn.disabled = true;
    }
  }
  od.addEventListener('input', () => { odMsg.textContent = ''; });
  od.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = od.elements, v = (n) => f[n].value.trim();
    const d = { key: odKey, name: v('name'), phone: v('phone'), email: v('email'), orgText: v('orgText'), reason: v('reason'),
      consent: f.consent.checked, agreeTerms: f.agreeTerms.checked, website: f.website.value, elapsedMs: Date.now() - odShownAt };
    const bad = (el, t) => { odMsg.textContent = t; el.focus(); };
    if (d.name.length < 2) return bad(f.name, '성명을 정확히 입력해 주세요.');
    if (!/^[0-9+\-() ]{7,30}$/.test(d.phone)) return bad(f.phone, '연락처를 확인해 주세요.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) return bad(f.email, '이메일을 확인해 주세요.');
    if (!d.consent) return bad(f.consent, '개인정보 수집·이용에 동의해 주세요.');
    if (!d.agreeTerms) return bad(f.agreeTerms, '환불 규정과 수강 안내를 확인해 주세요.');
    odBtn.disabled = true; odBtn.textContent = '결제창을 여는 중…';
    try {
      const r = await site('orderCreate', d);
      await loadToss();
      const tp = TossPayments(r.clientKey);
      // 구매자 식별값: 유추할 수 없는 무작위 문자열 (토스 규격: 2~50자, 영문·숫자·-_=.@)
      const ck = 'cnlw_' + Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');
      const payment = tp.payment({ customerKey: ck });
      await payment.requestPayment({
        method: 'CARD', amount: { currency: 'KRW', value: r.amount },
        orderId: r.orderId, orderName: r.orderName,
        customerName: d.name, customerEmail: d.email,
        successUrl: location.origin + '/pay/',
        failUrl: location.origin + '/pay/',
        card: { useEscrow: false, flowMode: 'DEFAULT', useAppCardOnly: false }
      });
    } catch (err) {
      const code = err && err.code ? ' (' + err.code + ')' : '';
      odMsg.textContent = ((err && err.message) || '결제를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.') + code;
      console.error('payment error', err);
      odBtn.disabled = false; odBtn.textContent = '결제하고 수강 시작';
    }
  });
  let tossP = null;
  function loadToss(){
    if (window.TossPayments) return Promise.resolve();
    if (tossP) return tossP;
    tossP = new Promise((res, rej) => {
      const sc = document.createElement('script'); sc.src = 'https://js.tosspayments.com/v2/standard';
      sc.onload = res; sc.onerror = () => rej(new Error('결제 모듈을 불러오지 못했습니다.'));
      document.head.appendChild(sc);
    });
    return tossP;
  }

  // 결제 창에서 돌아왔을 때 (주소 뒤에 결제 결과가 붙어 옵니다)
  let confirming = false;
  async function confirmOrder(){
    if (confirming) return;
    const h = location.hash, qi = h.indexOf('?');
    const q = new URLSearchParams(qi >= 0 ? h.slice(qi + 1) : location.search);
    const h1 = document.getElementById('os-h1'), lead = document.getElementById('os-lead');
    const body = document.getElementById('os-body'), acts = document.getElementById('os-acts');
    const show = (title, sub, html, buttons) => {
      h1.textContent = title; lead.textContent = sub; body.innerHTML = html;
      acts.innerHTML = buttons.map(b => '<a class="btn ' + b[2] + '" href="' + b[1] + '">' + escH(b[0]) + '</a>').join('');
    };
    if (q.get('code') || (!q.get('paymentKey') && !q.get('orderId'))) {
      const msg = q.get('message') || '결제가 완료되지 않았습니다. 다시 시도해 주세요.';
      return show('결제가 취소되었습니다', '결제 금액은 청구되지 않습니다.', '<p>' + escH(msg) + '</p>',
        [['다시 신청하기', '#/' , 'line'], ['교육 문의', '#/contact', 'line']]);
    }
    confirming = true;
    try {
      const r = await site('orderConfirm', { paymentKey: q.get('paymentKey'), orderId: q.get('orderId'), amount: q.get('amount') });
      show('결제가 완료되었습니다', '수강 코드를 이메일로 보내드렸습니다.',
        '<p><b>' + escH(r.email || '') + '</b>로 수강 코드와 수강 방법을 보내드렸습니다. 메일이 보이지 않으면 스팸함도 확인해 주세요.</p>' +
        '<ol class="howto"><li>교육센터에 접속합니다.</li>' +
        '<li>가입하거나 로그인합니다. 이메일·Google·카카오·네이버 모두 쓸 수 있습니다.</li>' +
        '<li>\'교육 코드 입력\'을 눌러 메일로 받은 수강 코드를 넣으면 바로 수강이 시작됩니다.</li></ol>' +
        '<p>수강 코드는 한 번만 쓸 수 있습니다. 메일이 오지 않으면 <a href="#/contact">교육 문의</a>로 알려 주세요.</p>',
        [['교육센터 열기', '/edu/', 'solid'], ['처음으로', '#/', 'line']]);
    } catch (e) {
      show('결제를 확인하지 못했습니다', '금액이 청구되었다면 자동으로 취소됩니다.',
        '<p>' + escH(e.message) + '</p><p>같은 문제가 반복되면 <a href="#/contact">교육 문의</a>로 알려 주세요.</p>',
        [['교육 문의', '#/contact', 'line'], ['처음으로', '#/', 'line']]);
    } finally { confirming = false; }
  }

  // ----- Q&A -----
  async function loadQna(){
    const box = document.getElementById('qna-list');
    box.innerHTML = '<p class="muted-p">불러오는 중…</p>';
    try {
      const { items, notices } = await site('qnaList', {});
      box.innerHTML = '<table><thead><tr><th>상태</th><th class="c-cat">분류</th><th>제목</th><th class="c-who">작성자</th><th class="c-date">날짜</th></tr></thead><tbody>' +
        (notices || []).map(n => '<tr class="q n" data-q="notice-' + escH(n.id) + '"><td><span class="st n">공지</span></td><td class="c-cat">안내</td><td class="t">' + escH(n.title) + '</td><td class="c-who">CNL Works</td><td class="c-date">' + escH(n.date) + '</td></tr>').join('') +
        items.map(q => '<tr class="q" data-q="' + escH(q.id) + '"><td><span class="st ' + (q.answered ? 'ok' : '') + '">' + (q.answered ? '답변 완료' : '답변 대기') + '</span></td><td class="c-cat">' + escH(q.category) + '</td><td class="t">' + (q.isPrivate ? '<span class="lock">비공개</span>' : '') + escH(q.title) + '</td><td class="c-who">' + escH(q.author) + '</td><td class="c-date">' + escH(q.date) + '</td></tr>').join('') +
        '</tbody></table>';
    } catch (e) { box.innerHTML = '<p class="muted-p">' + escH(e.message) + '</p>'; }
  }
  document.getElementById('qna-list').addEventListener('click', e => { const r = e.target.closest('[data-q]'); if (r) location.hash = '#/qna/' + r.dataset.q; });

  const qw = document.getElementById('qw'), qwMsg = document.getElementById('qw-msg'), qwBtn = document.getElementById('qw-send');
  let qwShownAt = Date.now();
  function prepQnaWrite(){ qwShownAt = Date.now(); qwMsg.textContent = ''; }
  qw.addEventListener('input', () => { qwMsg.textContent = ''; });
  qw.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = qw.elements;
    const d = { category: f.category.value, isPrivate: f.isPrivate.checked, title: f.title.value.trim(), body: f.body.value.trim(),
      name: f.name.value.trim(), email: f.email.value.trim(), password: f.password.value, consent: f.consent.checked,
      website: f.website.value, elapsedMs: Date.now() - qwShownAt };
    const bad = (el, t) => { qwMsg.textContent = t; el.focus(); };
    if (d.title.length < 2) return bad(f.title, '제목을 입력해 주세요.');
    if (d.body.length < 5) return bad(f.body, '내용을 입력해 주세요.');
    if (!d.name) return bad(f.name, '이름을 입력해 주세요.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) return bad(f.email, '이메일을 확인해 주세요.');
    if (d.password.length < 4) return bad(f.password, '비밀번호는 4자 이상으로 정해 주세요.');
    if (!d.consent) return bad(f.consent, '개인정보 수집·이용에 동의해 주세요.');
    qwBtn.disabled = true;
    try {
      const r = await site('qnaPost', d);
      qnaPwCache[r.id] = d.password;
      qw.reset(); location.hash = '#/qna/' + r.id;
    } catch (err) { qwMsg.textContent = err.message; }
    finally { qwBtn.disabled = false; }
  });

  const qnaPwCache = {};
  let qnaCurrent = null;
  // 공지 본문: 빈 줄로 문단, "## "로 시작하는 줄은 소제목
  function noticeHtml(text){
    return String(text || '').split(/\n\s*\n/).map(b => b.split('\n').map(l => l.startsWith('## ') ? '<h3>' + escH(l.slice(3)) + '</h3>' : escH(l)).join('<br>'))
      .map(b => b.startsWith('<h3>') ? b.replace(/^(<h3>.*?<\/h3>)(<br>)?/, '$1<p>') + '</p>' : '<p>' + b + '</p>').join('').replace(/<p><\/p>/g, '');
  }
  async function openNotice(id){
    const lock = document.getElementById('qv-lock'), body = document.getElementById('qv-body'), q = document.getElementById('qv-q');
    lock.hidden = true; body.hidden = true;
    document.getElementById('qv-title').textContent = '공지'; document.getElementById('qv-meta').textContent = '불러오는 중…';
    try {
      const { item } = await site('noticeView', { id });
      document.getElementById('qv-title').textContent = item.title;
      document.getElementById('qv-meta').textContent = '공지 · CNL Works · ' + item.date;
      document.getElementById('qv-qlabel').textContent = '공지';
      document.getElementById('qv-abox').hidden = true;
      q.classList.add('rich'); q.innerHTML = noticeHtml(item.body);
      body.hidden = false;
    } catch (e) { document.getElementById('qv-meta').textContent = e.message; }
  }
  async function openQna(id, pw){
    if (String(id || '').startsWith('notice-')) return openNotice(id.slice(7));
    qnaCurrent = id;
    const lock = document.getElementById('qv-lock'), body = document.getElementById('qv-body'), msg = document.getElementById('qv-msg');
    msg.textContent = ''; body.hidden = true; lock.hidden = true;
    document.getElementById('qv-qlabel').textContent = '질문'; document.getElementById('qv-abox').hidden = false;
    document.getElementById('qv-q').classList.remove('rich');
    document.getElementById('qv-title').textContent = 'Q&A'; document.getElementById('qv-meta').textContent = '불러오는 중…';
    try {
      const r = await site('qnaView', { id, password: pw || qnaPwCache[id] || '' });
      if (r.needPassword) {
        document.getElementById('qv-title').textContent = '비공개 문의';
        document.getElementById('qv-meta').textContent = r.category + ' · ' + r.date;
        lock.hidden = false; document.getElementById('qv-pw').value = ''; return;
      }
      const q = r.item; if (pw) qnaPwCache[id] = pw;
      document.getElementById('qv-title').textContent = q.title;
      document.getElementById('qv-meta').textContent = q.category + ' · ' + q.author + ' · ' + q.date + (q.isPrivate ? ' · 비공개' : '');
      document.getElementById('qv-q').textContent = q.body;
      document.getElementById('qv-a').textContent = q.answer ? q.answer + (q.answeredAt ? '\n\n— ' + q.answeredAt + ' 답변' : '') : '아직 답변이 등록되지 않았습니다. 답변이 등록되면 이메일로 알려드립니다.';
      body.hidden = false;
    } catch (e) {
      if (pw) { lock.hidden = false; msg.textContent = e.message; }
      else document.getElementById('qv-meta').textContent = e.message;
    }
  }
  document.getElementById('qv-open').onclick = () => { const pw = document.getElementById('qv-pw').value; if (pw) openQna(qnaCurrent, pw); };
  document.getElementById('qv-pw').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('qv-open').click(); });

  document.addEventListener('click', e => {
    const a = e.target.closest('[data-scroll]'); if (!a) return;
    const el = document.getElementById(a.dataset.scroll); if (!el) return;
    e.preventDefault(); el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  const pages = [...document.querySelectorAll('[data-page]')];
  const menu = document.getElementById('menu');
  const burger = document.getElementById('burger');
  const titles = { home: 'CNL Works', pip: 'CNL Works PIP', harassment: '직장 내 괴롭힘 교육 | CNL Works',
                   'sexual-harassment': '직장 내 성희롱 교육 | CNL Works', contact: '교육 문의 | CNL Works',
                   privacy: '개인정보처리방침 | CNL Works', 'edu-apply': '예방교육 신청 | CNL Works',
                   investigator: '직장 내 괴롭힘 조사관 과정 | CNL Works',
                   'harassment/prevention': '직장 내 괴롭힘 예방교육 | CNL Works', 'harassment/offender': '직장 내 괴롭힘 재발방지 교육 | CNL Works',
                   'sexual-harassment/prevention': '직장 내 성희롱 예방교육 | CNL Works', 'sexual-harassment/offender': '직장 내 성희롱 재발방지 교육 | CNL Works',
                   'sexual-harassment/investigator': '직장 내 성희롱 조사관 과정 | CNL Works',
                   order: '개인 수강 신청 | CNL Works', 'order/success': '결제 | CNL Works', refund: '환불 규정 | CNL Works',
                   qna: 'Q&A | CNL Works', 'qna/write': '질문하기 | CNL Works', 'qna/view': 'Q&A | CNL Works' };

  function route(){
    const h = location.hash;
    if (h && !h.startsWith('#/')) {                  // 페이지 안의 이동(#programs 등)
      if (!pages.some(p => p.classList.contains('show'))) pages.forEach(p => p.classList.toggle('show', p.dataset.page === 'home'));
      return;
    }
    // 결제창에서 돌아올 때 주소 뒤에 ?paymentKey=... 가 붙으므로 먼저 떼어냅니다
    const [key, sub, sub2] = (h.replace(/^#\/?/, '').split('?')[0] || 'home').split('/');
    let name = titles[key] ? key : 'home';
    let applyProgram = null;
    if ((key === 'harassment' || key === 'sexual-harassment' || key === 'investigator') && sub === 'apply') { name = 'edu-apply'; applyProgram = { 'sexual-harassment': 'sexual', investigator: 'investigator' }[key] || 'harassment'; }
    if ((key === 'harassment' || key === 'sexual-harassment') && ['prevention', 'offender', 'investigator'].includes(sub)) {
      if (sub === 'investigator' && sub2 === 'apply') { name = 'edu-apply'; applyProgram = key === 'harassment' ? 'investigator' : 'sexual-investigator'; }
      else name = key === 'harassment' && sub === 'investigator' ? 'investigator' : key + '/' + sub;
    }
    if (key === 'qna') name = !sub ? 'qna' : (sub === 'write' ? 'qna/write' : 'qna/view');
    if (key === 'order') name = sub === 'success' ? 'order/success' : 'order';
    if (name === 'contact') prepContact(sub);
    if (name === 'edu-apply') prepApply(applyProgram);
    if (name === 'qna') loadQna();
    if (name === 'qna/write') prepQnaWrite();
    if (name === 'qna/view') openQna(sub);
    if (name === 'pip') loadPipCurriculum();
    if (name === 'order') prepOrder(sub);
    if (name === 'order/success') confirmOrder();
    pages.forEach(p => p.classList.toggle('show', p.dataset.page === name));
    document.title = name === 'edu-apply' ? ((/^sexual/.test(applyProgram) ? '직장 내 성희롱' : '직장 내 괴롭힘') + (/investigator/.test(applyProgram) ? ' 조사관 과정 방문 교육 신청' : ' 예방교육 신청')) + ' | CNL Works' : titles[name];
    const grp = name === 'investigator' ? 'harassment' : (name === 'edu-apply' ? (/^sexual/.test(applyProgram) ? 'sexual-harassment' : 'harassment') : name.split('/')[0]);
    document.querySelectorAll('nav.menu [data-link]').forEach(a => a.classList.toggle('on', a.dataset.link === grp));
    document.querySelectorAll('.has-sub[data-group]').forEach(g => g.classList.toggle('on', g.dataset.group === grp));
    const curHash = name === 'investigator' ? '#/harassment/investigator' : '#/' + name;
    document.querySelectorAll('.sub a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === curHash));
    closeAll();
    window.scrollTo(0, 0);
  }
  function closeAll(){
    document.querySelectorAll('.has-sub.open').forEach(g => { g.classList.remove('open'); g.querySelector('button').setAttribute('aria-expanded', 'false'); });
    menu.classList.remove('open'); burger.setAttribute('aria-expanded', 'false');
  }
  // 마우스를 쓰는 화면에서는 올려두면 열리고 비키면 닫힙니다 (CSS가 처리).
  // 터치 화면에서는 눌러서 열고 닫습니다.
  const hoverMenu = () => window.matchMedia('(hover: hover) and (min-width: 901px)').matches;
  document.querySelectorAll('.has-sub > button').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    // 마우스 화면에서는 눌러도 상태를 바꾸지 않습니다. 다만 눌린 뒤 초점이 남아 있으면
    // 메뉴가 계속 열려 보이므로 초점을 거둡니다.
    if (hoverMenu()) { b.blur(); return; }
    const g = b.parentElement, open = !g.classList.contains('open');
    document.querySelectorAll('.has-sub.open').forEach(x => x.classList.remove('open'));
    g.classList.toggle('open', open); b.setAttribute('aria-expanded', String(open));
  }));
  // 눌러서 연 뒤 마우스를 비키면 닫습니다
  document.querySelectorAll('.has-sub').forEach(g => g.addEventListener('mouseleave', () => {
    if (!hoverMenu()) return;
    g.classList.remove('open');
    const b = g.querySelector('button'); if (b) b.setAttribute('aria-expanded', 'false');
  }));
  burger.addEventListener('click', e => {
    e.stopPropagation();
    const open = !menu.classList.contains('open');
    menu.classList.toggle('open', open); burger.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', e => { if (!e.target.closest('.top')) closeAll(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAll(); });
  window.addEventListener('hashchange', route);
  route();
})();
