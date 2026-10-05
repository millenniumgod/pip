// ===== CNL Works 교육센터 =====
const firebaseConfig = {
  apiKey: "AIzaSyCDRIl6YcV8vAmZ6UMmGuXuWnQ89Gce2ZQ",
  authDomain: "pip-growth-program.firebaseapp.com",
  projectId: "pip-growth-program",
  storageBucket: "pip-growth-program.firebasestorage.app",
  messagingSenderId: "385712593094",
  appId: "1:385712593094:web:0434767f58485462081fc7"
};
const OPERATOR = '노무법인 C&L';
const CONTACT_EMAIL = 'cnlcg@cnlcg.co.kr';
const PRIVACY_OFFICER = '성명: 이상호 · 채형석 (직책: 대표) / 문의: ' + CONTACT_EMAIL;
const LEGAL_DATE = '2026-10-04';
const STAMP = '../assets/seal.png';
const MARK = '../assets/logo-symbol.png';

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const fx = firebase.functions();
const TS = () => firebase.firestore.FieldValue.serverTimestamp();

// ---------- 공통 ----------
const $ = (id) => document.getElementById(id);
function esc(v){ return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function errText(e){
  const m = { 'auth/invalid-email':'이메일 주소를 확인해 주세요.', 'auth/missing-password':'비밀번호를 입력해 주세요.',
    'auth/invalid-credential':'이메일 또는 비밀번호가 맞지 않습니다.', 'auth/wrong-password':'이메일 또는 비밀번호가 맞지 않습니다.',
    'auth/user-not-found':'이메일 또는 비밀번호가 맞지 않습니다.', 'auth/email-already-in-use':'이미 가입된 이메일입니다. 로그인해 주세요.',
    'auth/weak-password':'비밀번호는 8자 이상이며 영문과 숫자를 모두 포함해야 합니다.', 'auth/too-many-requests':'시도가 너무 많습니다. 잠시 후 다시 해 주세요.',
    'permission-denied':'권한이 없습니다.' };
  return m[e && e.code] || (e && e.message) || '오류가 발생했습니다.';
}
function fmtCode(c){ c = String(c || ''); return c.length === 8 ? c.slice(0,4) + '-' + c.slice(4) : c; }
function genCode(){
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const r = new Uint32Array(8); crypto.getRandomValues(r);
  return Array.from(r, x => A[x % A.length]).join('');
}
function tsDate(t){ return t && t.toDate ? t.toDate() : (t instanceof Date ? t : null); }
function kDate(d){ if(!d) return '-'; const k = new Date(d.getTime() + 9*3600*1000); return k.toISOString().slice(0,10); }
function kDateLong(s){ const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? `${m[1]}년 ${+m[2]}월 ${+m[3]}일` : ''; }
function fmtDur(sec){ sec = Math.max(0, Math.floor(sec || 0)); const m = Math.floor(sec/60), s = sec%60; return m + ':' + String(s).padStart(2,'0'); }
const TRACK = { general: '일반 사내교육', offender: '재발방지 교육', investigator: '조사관 과정' };
const INV_REASONS = ['회사에서 조사 업무를 맡고 있음(또는 맡을 예정)', '인사·노무 실무 역량 강화', '기타'];
const OFF_REASONS = ['징계 절차 진행 중(개선 노력 자료)', '징계 후 회사의 교육 지시', '기타'];
// 조사관 과정의 진행 단계 (담당자·관리자 화면 공용)
function invStage(e){
  if(e.track !== 'investigator' || e.status !== 'active') return '';
  if(e.reportStatus === 'submitted') return '보고서 검토 중';
  if(e.reportStatus === 'revision') return '보고서 보완 중';
  if(e.quizPassed) return '보고서 작성 중';
  return '강의 수강 중';
}
const PROGRAM = { harassment: '직장 내 괴롭힘', sexual: '직장 내 성희롱' };
const STATUS = { pending: ['승인 대기','warn'], active: ['수강 중','in'], done: ['수료','ok'], rejected: ['반려',''] };
// 진도 막대
function pctCell(e){
  const pct = e.status === 'done' ? 100 : Math.max(0, Math.min(100, e.progressPct || 0));
  const seen = tsDate(e.lastSeenAt);
  return `<div class="pct"><div class="pct-bar"><div style="width:${pct}%"></div></div><span>${pct}%</span></div>` +
    (seen && e.status !== 'done' ? `<div class="small-t muted">${kDate(seen)}</div>` : '');
}
function badge(st){ const s = STATUS[st] || [st,'']; return `<span class="badge ${s[1]}">${esc(s[0])}</span>`; }

let me = null, isAdmin = false, hrOrgs = [], learner = null, mode = 'learner';
let courses = [];
const VIEWS = ['v-verify','v-auth','v-start','v-join','v-apply','v-home','v-course','v-cert','v-hr','v-admin'];
let prevView = 'v-home';
function show(id){
  if(id !== 'v-cert' && id !== 'v-verify') prevView = id;
  VIEWS.forEach(v => $(v).classList.toggle('hidden', v !== id));
  window.scrollTo(0, 0);
}

// ---------- 약관 · 처리방침 ----------
const LEGAL = {
  terms: ['이용약관', `제1조(목적) 이 약관은 ${OPERATOR}(이하 "운영자")가 CNL Works 교육센터에서 제공하는 온라인·대면 교육 서비스의 이용 조건을 정합니다.

제2조(이용) ① 회사 교육 코드 또는 개인별 수강 코드를 받은 사람, 운영자가 개인 신청을 승인한 사람이 수강할 수 있습니다. ② 이용자는 본인의 계정으로만 수강해야 하며, 다른 사람이 대신 수강하게 해서는 안 됩니다.

제3조(수료) ① 온라인 과정은 과정의 모든 영상을 각 95% 이상 시청하면 수료증이 발급됩니다. 배속 재생이나 건너뛴 구간은 시청 시간으로 인정되지 않습니다. ② 대면·집합 과정은 교육 참석을 확인한 뒤 운영자가 수료 처리합니다. ③ 조사관 과정은 모든 영상 시청, 평가 합격, 조사보고서 제출과 운영자의 검토 승인을 모두 마쳐야 수료증이 발급됩니다. 이 수료증은 과정 이수 사실을 증명하며, 자격을 부여하지 않습니다. ④ 수료증은 수료 사실을 확인하는 문서이며, 징계 등 인사 절차의 결과를 보장하지 않습니다.

제4조(부정 수강) 대리 수강 등 부정한 방법이 확인되면 운영자는 수료를 취소할 수 있습니다.

제5조(저작권) 강의 영상, 평가 문항, 모의사건 자료의 저작권은 운영자에게 있으며, 녹화·복제·배포와 외부 유출을 금지합니다.

제6조(문의) ${CONTACT_EMAIL}

이 약관은 ${LEGAL_DATE}부터 적용됩니다.`],
  policy: ['개인정보처리방침', `${OPERATOR}(이하 "운영자")는 CNL Works 교육센터에서 다음과 같이 개인정보를 처리합니다.

1. 처리 목적 및 항목
 - 회원 관리: 이메일, 비밀번호(일방향 암호화)
 - 수강 관리와 수료증 발급: 성명, 사번·부서(선택), 소속, 시청 기록, 수료 정보
 - 개인 신청 확인: 연락처, 신청 사유, 소속(선택)
 - 조사관 과정 평가: 평가 응시 결과, 작성한 조사보고서, 검토 의견

2. 처리 주체
 - 회사 교육 코드로 참여한 경우: 소속 회사가 교육을 위해 처리하는 개인정보이며, 운영자는 회사의 위탁을 받아 처리합니다. 소속 회사의 교육 담당자는 수강 현황과 수료증을 열람할 수 있습니다.
 - 개인 신청의 경우: 운영자가 직접 처리하며, 소속 회사에 알리지 않습니다.

3. 보유 기간
 - 수료 정보: 수료일부터 3년 (수료증 진위 확인을 위해)
 - 그 밖의 정보: 회원 탈퇴 또는 위탁계약 종료 시까지

4. 처리 위탁 및 국외 이전
 - Google LLC(미국): 서버·데이터베이스 운영(Firebase), 회원가입 시부터 보유 기간 동안 네트워크로 전송·보관
 - BunnyWay d.o.o.(슬로베니아): 강의 영상 전송(개인정보를 보내지 않음)
 - 네이버클라우드㈜: 신청 알림 메일

5. 정보주체의 권리: 열람, 정정, 삭제, 처리정지를 아래 연락처로 요구할 수 있습니다.

6. 안전성 확보 조치: 비밀번호 암호화, 접근 권한 제한, 시청·수료 기록의 위·변조 방지, 전송 구간 암호화

7. 개인정보 보호책임자: ${PRIVACY_OFFICER}

8. 권익침해 구제: 개인정보침해신고센터(118), 개인정보분쟁조정위원회(1833-6972)

이 방침은 ${LEGAL_DATE}부터 적용됩니다.`]
};
document.addEventListener('click', e => {
  const b = e.target.closest('[data-legal]'); if(!b) return;
  e.preventDefault(); const L = LEGAL[b.dataset.legal];
  $('m-title').textContent = L[0]; $('m-body').textContent = L[1]; $('modal').classList.remove('hidden');
});
$('m-close').onclick = () => { $('modal').classList.add('hidden'); $('modal').querySelector('.card').classList.remove('wide'); };

// ---------- 진위 확인 ----------
async function runVerify(no){
  const box = $('vf-res'); box.innerHTML = '';
  if(!no) return;
  try{
    const r = (await fx.httpsCallable('eduVerifyCertificate')({ no })).data;
    box.innerHTML = r.valid
      ? `<div class="vres ok"><b>확인되었습니다. 발급된 수료증입니다.</b><table style="margin-top:8px"><tr><th>수료번호</th><td>${esc(r.no)}</td></tr><tr><th>성명</th><td>${esc(r.name)}</td></tr><tr><th>과정</th><td>${esc(r.certTitle)}</td></tr>${r.orgName ? `<tr><th>소속</th><td>${esc(r.orgName)}</td></tr>` : ''}<tr><th>교육 방식</th><td>${r.mode === 'offline' ? '대면(집합)' : '온라인'}${r.hoursLabel ? ' · ' + esc(r.hoursLabel) : ''}</td></tr><tr><th>수료일</th><td>${esc(kDateLong(r.completedDate))}</td></tr>${r.assessed ? '<tr><th>수료 요건</th><td>강의 이수, 평가 합격, 조사보고서 검토 승인</td></tr>' : ''}</table></div>`
      : `<div class="vres no"><b>일치하는 수료증이 없습니다.</b> 수료번호를 다시 확인해 주세요.</div>`;
  } catch(e){ box.innerHTML = `<div class="vres no">${esc(errText(e))}</div>`; }
}
$('vf-btn').onclick = () => runVerify($('vf-no').value.trim().toUpperCase());

// ---------- 로그인 · 회원가입 ----------
// 이메일 주소만 이 브라우저에 저장합니다 (비밀번호는 저장하지 않습니다)
const SAVED_EMAIL_KEY = 'cnlworks.edu.email';
let signupMode = false;
try{
  const saved = localStorage.getItem(SAVED_EMAIL_KEY);
  if(saved){ $('a-email').value = saved; $('a-remember').checked = true; }
} catch(e){}
function rememberEmail(email){
  try{
    if($('a-remember').checked && email) localStorage.setItem(SAVED_EMAIL_KEY, email);
    else localStorage.removeItem(SAVED_EMAIL_KEY);
  } catch(e){}
}
function setAuthTab(su){
  signupMode = su;
  $('a-remember-l').classList.toggle('hidden', su); $('t-login').classList.toggle('on', !su); $('t-signup').classList.toggle('on', su);
  $('a-signup-extra').classList.toggle('hidden', !su); $('a-submit').textContent = su ? '가입하기' : '로그인';
  $('a-pw').autocomplete = su ? 'new-password' : 'current-password'; $('a-msg').textContent = '';
}
$('t-login').onclick = () => setAuthTab(false);
$('t-signup').onclick = () => setAuthTab(true);
$('a-submit').onclick = async () => {
  const email = $('a-email').value.trim(), pw = $('a-pw').value, msg = $('a-msg');
  msg.className = 'msg'; msg.textContent = '';
  try{
    if(signupMode){
      if(pw.length < 8 || !/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return msg.textContent = '비밀번호는 8자 이상이며 영문과 숫자를 모두 포함해야 합니다.';
      if(pw !== $('a-pw2').value) return msg.textContent = '비밀번호 확인이 일치하지 않습니다.';
      if(!$('a-agree').checked) return msg.textContent = '이용약관과 개인정보처리방침에 동의해 주세요.';
      await auth.createUserWithEmailAndPassword(email, pw);
    } else {
      await auth.signInWithEmailAndPassword(email, pw);
    }
    rememberEmail(email);
  } catch(e){ msg.textContent = errText(e); }
};
$('a-pw').addEventListener('keydown', e => { if(e.key === 'Enter' && !signupMode) $('a-submit').click(); });
$('a-reset').onclick = async () => {
  const email = $('a-email').value.trim(), msg = $('a-msg');
  if(!email) { msg.className = 'msg'; return msg.textContent = '이메일을 먼저 입력해 주세요.'; }
  try{ await auth.sendPasswordResetEmail(email); msg.className = 'msg ok'; msg.textContent = '비밀번호 재설정 메일을 보냈습니다.'; }
  catch(e){ msg.className = 'msg'; msg.textContent = errText(e); }
};
// 소셜 로그인 — Google은 Firebase가 바로 처리하고, 카카오·네이버는 각 서비스 로그인 창을 거칩니다
let ssoConfig = null;
const SSO_CACHE_KEY = 'cnlworks.sso.config';
function applySso(j){
  ssoConfig = j;
  document.querySelectorAll('[data-sso="kakao"]').forEach(b => b.classList.toggle('hidden', !j.kakao));
  document.querySelectorAll('[data-sso="naver"]').forEach(b => b.classList.toggle('hidden', !j.naver));
}
async function initSso(){
  // 지난번에 받아 둔 설정이 있으면 먼저 보여주고, 최신 값은 뒤에서 받아 둡니다
  try{
    const cached = localStorage.getItem(SSO_CACHE_KEY);
    if(cached) applySso(JSON.parse(cached));
  } catch(e){}
  try{
    const r = await fetch('/api/social', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'config' }) });
    const j = await r.json().catch(() => ({}));
    if(!j.ok) return;
    applySso(j);
    try{ localStorage.setItem(SSO_CACHE_KEY, JSON.stringify(j)); } catch(e){}
  } catch(e){}
}
initSso();

document.addEventListener('click', async ev => {
  const b = ev.target.closest('[data-sso]'); if(!b) return;
  const paid = b.dataset.paid === '1';
  const msg = (paid && $('pd-msg')) || $('a-msg');
  const kind = b.dataset.sso;
  msg.className = 'msg'; msg.textContent = '';
  if(kind === 'google'){
    b.disabled = true;
    try{
      const provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await auth.signInWithPopup(provider);
    } catch(err){
      if(!(err && err.code === 'auth/popup-closed-by-user')) msg.textContent = errText(err);
    } finally { b.disabled = false; }
    return;
  }
  // 카카오·네이버: 로그인 창으로 보냈다가 /auth/ 로 돌아옵니다
  if(!ssoConfig) await initSso();
  if(!ssoConfig || !ssoConfig[kind]) { msg.textContent = '이 로그인은 아직 준비되지 않았습니다.'; return; }
  const state = Array.from(crypto.getRandomValues(new Uint8Array(8)), x => x.toString(16).padStart(2, '0')).join('');
  try{
    sessionStorage.setItem('cnlworks.sso.provider', kind);
    sessionStorage.setItem('cnlworks.sso.return', location.pathname + location.hash);
  } catch(e){}
  const p = new URLSearchParams({
    response_type: 'code',
    client_id: kind === 'kakao' ? ssoConfig.kakaoClientId : ssoConfig.naverClientId,
    redirect_uri: location.origin + '/auth/',
    state
  });
  if(kind === 'kakao' && ssoConfig.kakaoScope) p.set('scope', ssoConfig.kakaoScope);
  location.href = (kind === 'kakao' ? ssoConfig.kakaoAuthUrl : ssoConfig.naverAuthUrl) + '?' + p.toString();
});

$('btn-logout').onclick = () => { $('a-pw').value = ''; auth.signOut(); };
$('btn-verify-mail').onclick = async () => {
  try{ await auth.currentUser.sendEmailVerification({ url: location.origin + location.pathname }); $('vm-msg').textContent = '인증 메일을 보냈습니다. 메일의 링크를 누른 뒤 다시 로그인해 주세요.'; }
  catch(e){ $('vm-msg').textContent = errText(e); }
};

// ---------- 화면 이동 버튼 ----------
document.addEventListener('click', e => {
  const b = e.target.closest('[data-go]'); if(!b) return;
  const g = b.dataset.go;
  if(g === 'join') openJoin();
  else if(g === 'apply') openApply();
  else if(g === 'home') loadHome();
  else if(g === 'back') loadHome();
});

// ---------- 로그인 상태 ----------
async function loadCourses(){
  const s = await db.collection('eduCourses').get();
  courses = s.docs.map(d => ({ id: d.id, ...d.data() }));
}
auth.onAuthStateChanged(async (user) => {
  stopPlayer();
  me = user; isAdmin = false; hrOrgs = []; learner = null;
  if(location.hash.startsWith('#/verify')) return route();
  if(!user){
    $('who').classList.add('hidden'); setAuthTab(false);
    return show('v-auth');
  }
  $('who').classList.remove('hidden'); $('who-email').textContent = user.email || '';
  // 서로 기다릴 필요가 없는 조회는 한꺼번에 보냅니다 (하나씩 기다리면 그만큼 느려집니다)
  const [uSnap, orgSnap] = await Promise.all([
    db.collection('users').doc(user.uid).get().catch(() => null),
    user.emailVerified
      ? db.collection('eduOrgs').where('hrEmails', 'array-contains', user.email).get().catch(() => null)
      : Promise.resolve(null),
    loadCourses().catch(() => {})
  ]);
  isAdmin = !!(uSnap && uSnap.exists && uSnap.data().role === 'admin');
  hrOrgs = orgSnap ? orgSnap.docs.map(d => ({ id: d.id, ...d.data() })) : [];
  // 결제 주문 연결은 화면을 띄운 뒤 뒤에서 처리합니다 (로그인이 느려지지 않도록)
  fx.httpsCallable('eduClaimPaidOrders')({}).then(r => {
    if(r && r.data && r.data.claimed && mode === 'learner') loadHome();
  }).catch(() => {});
  $('btn-mode').classList.toggle('hidden', !(isAdmin || hrOrgs.length));
  mode = isAdmin ? 'admin' : (hrOrgs.length ? 'hr' : 'learner');
  enterMode();
});
function enterMode(){
  const ap = /^#\/apply(?:\/(harassment|sexual|investigator|sexual-investigator))?$/.exec(location.hash);
  if(mode === 'learner' && ap) return openApply(ap[1]);
  $('btn-mode').textContent = mode === 'learner' ? (isAdmin ? '관리자 화면' : '담당자 화면') : '수강 화면';
  if(mode === 'admin') openAdmin();
  else if(mode === 'hr') openHr();
  else loadHome();
}
$('btn-mode').onclick = () => {
  mode = mode === 'learner' ? (isAdmin ? 'admin' : 'hr') : 'learner';
  enterMode();
};

// ---------- 수강생: 내 교육 ----------
let myEnrolls = [];
async function loadHome(){
  stopPlayer();
  const [es, ls] = await Promise.all([
    db.collection('eduEnrollments').where('uid', '==', me.uid).get(),
    db.collection('eduLearners').doc(me.uid).get()
  ]);
  learner = ls.exists ? ls.data() : null;
  myEnrolls = es.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (tsDate(b.createdAt) || 0) - (tsDate(a.createdAt) || 0));
  if(!myEnrolls.length){ $('hr-hint').classList.toggle('hidden', !!hrOrgs.length); return show('v-start'); }
  $('home-sub').textContent = learner && learner.name ? learner.name + ' 님의 교육 목록입니다.' : '';
  $('enr-list').innerHTML = myEnrolls.map(e => {
    let act = '';
    if(e.status === 'active' && (e.mode !== 'offline' || e.track === 'investigator')) act = `<button class="primary" data-open="${esc(e.id)}">수강하기</button>`;
    else if(e.status === 'active') act = `<span class="small-t muted">대면 교육 일정은 담당자가 연락드립니다.</span>`;
    else if(e.status === 'pending') act = `<span class="small-t muted">신청을 확인한 뒤 연락드립니다.</span>`;
    else if(e.status === 'done') act = `<button class="primary" data-cert="${esc(e.certNo)}">수료증 보기</button>${e.mode !== 'offline' ? ` <button data-open="${esc(e.id)}">다시 보기</button>` : ''}`;
    const stg = invStage(e);
    return `<div class="card enr"><div>${badge(e.status)}${stg ? ` <span class="badge">${esc(stg)}</span>` : ''} <span class="small-t muted">${esc(PROGRAM[e.program] || '')} · ${esc(TRACK[e.track] || '')} · ${e.mode === 'offline' ? '대면' : '온라인'}</span><h3>${esc(e.courseTitle)}</h3>${e.orgName ? `<p class="small-t muted">${esc(e.orgName)}</p>` : ''}</div><div class="row">${act}</div></div>`;
  }).join('');
  show('v-home');
}
$('enr-list').addEventListener('click', e => {
  const o = e.target.closest('[data-open]'); if(o) return openCourse(o.dataset.open);
  const c = e.target.closest('[data-cert]'); if(c) return openCert(c.dataset.cert);
});

// ---------- 교육 코드 ----------
function openJoin(){
  $('j-msg').textContent = '';
  if(learner){ $('j-name').value = learner.name || ''; $('j-emp').value = learner.empNo || ''; $('j-dept').value = learner.dept || ''; }
  show('v-join');
}
$('j-submit').onclick = async () => {
  const btn = $('j-submit'), msg = $('j-msg'); msg.textContent = '';
  const code = $('j-code').value.trim(), name = $('j-name').value.trim();
  if(!code) return msg.textContent = '교육 코드를 입력해 주세요.';
  if(name.length < 2) return msg.textContent = '성명을 정확히 입력해 주세요.';
  btn.disabled = true;
  try{
    await fx.httpsCallable('eduJoin')({ code, name, empNo: $('j-emp').value.trim(), dept: $('j-dept').value.trim() });
    $('j-code').value = ''; await loadHome();
  } catch(e){ msg.textContent = errText(e); }
  finally{ btn.disabled = false; }
};

// ---------- 개인 신청 ----------
function openApply(program){
  $('p-msg').className = 'msg'; $('p-msg').textContent = '';
  const all = courses.filter(c => (c.track === 'offender' || c.track === 'investigator') && c.active !== false && c.allowApply !== false);
  const picked = program === 'investigator' ? all.filter(c => c.track === 'investigator' && (c.program || 'harassment') === 'harassment')
    : program === 'sexual-investigator' ? all.filter(c => c.track === 'investigator' && c.program === 'sexual')
    : (program ? all.filter(c => c.track === 'offender' && (c.program || 'harassment') === program) : []);
  const list = picked.length ? picked : all;
  $('p-course').innerHTML = list.length ? list.map(c => `<option value="${esc(c.id)}">${esc(c.title)}</option>`).join('') : '<option value="">현재 신청 가능한 과정이 없습니다</option>';
  if(learner) { $('p-name').value = learner.name || ''; $('p-phone').value = learner.phone || ''; }
  applyTrackUI();
  show('v-apply');
}
// 선택한 과정에 맞춰 제목, 안내, 신청 사유, 수강 방식을 바꿉니다
function applyTrackUI(){
  const c = courses.find(x => x.id === $('p-course').value);
  const inv = !!c && c.track === 'investigator';
  $('p-h1').textContent = inv ? '조사관 과정 개인 신청' : '재발방지 교육 개인 신청';
  $('p-lead').textContent = inv ? '신청 내용을 확인한 뒤 연락드립니다. 승인되면 바로 수강할 수 있습니다.' : '신청 내용은 담당 공인노무사만 확인하며, 소속 회사에 알리지 않습니다.';
  const reasons = inv ? INV_REASONS : OFF_REASONS;
  const sel = $('p-reason'), prev = sel.value;
  sel.innerHTML = '<option value="">선택하세요</option>' + reasons.map(r => `<option${r === prev ? ' selected' : ''}>${esc(r)}</option>`).join('');
  $('p-mode-wrap').classList.toggle('hidden', inv);
  $('p-consent-inv').classList.toggle('hidden', !inv);
  if(inv){ const on = document.querySelector('input[name=p-mode][value=online]'); if(on) on.checked = true; }
}
$('p-course').onchange = applyTrackUI;
$('p-submit').onclick = async () => {
  const btn = $('p-submit'), msg = $('p-msg'); msg.className = 'msg'; msg.textContent = '';
  const data = { courseId: $('p-course').value, name: $('p-name').value.trim(), phone: $('p-phone').value.trim(),
    orgText: $('p-org').value.trim(), reason: $('p-reason').value,
    mode: (document.querySelector('input[name=p-mode]:checked') || {}).value, consent: $('p-agree').checked };
  if(!data.courseId) return msg.textContent = '과정을 선택해 주세요.';
  if(data.name.length < 2) return msg.textContent = '성명을 정확히 입력해 주세요.';
  if(!/^[0-9+\-() ]{7,30}$/.test(data.phone)) return msg.textContent = '연락처를 확인해 주세요.';
  if(!data.reason) return msg.textContent = '신청 사유를 선택해 주세요.';
  if(!data.consent) return msg.textContent = '개인정보 수집·이용에 동의해 주세요.';
  btn.disabled = true;
  try{ await fx.httpsCallable('eduApply')(data); await loadHome(); }
  catch(e){ msg.textContent = errText(e); }
  finally{ btn.disabled = false; }
};

// ---------- 강의 시청 ----------
let cur = null;           // { enroll, course, idx, progress: [{sec, pos}] }
let player = null, track = null, flushTimer = null;
let playerjsP = null;
function loadPlayerJs(){
  if(window.playerjs) return Promise.resolve();
  if(playerjsP) return playerjsP;
  playerjsP = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://assets.mediadelivery.net/playerjs/playerjs-latest.min.js'; s.onload = res; s.onerror = () => rej(new Error('재생 도구를 불러오지 못했습니다.')); document.head.appendChild(s); });
  return playerjsP;
}
async function openCourse(enrollId){
  stopPlayer();
  lastPctSaved = -1;
  const e = myEnrolls.find(x => x.id === enrollId); if(!e) return;
  const c = courses.find(x => x.id === e.courseId);
  if(!c || !(c.videos || []).length){ alert('과정 영상이 아직 준비되지 않았습니다.'); return; }
  const progress = await Promise.all(c.videos.map((v, i) => db.collection('eduProgress').doc(`${me.uid}_${c.id}_${i}`).get()
    .then(s => s.exists ? { sec: s.data().sec || 0, pos: s.data().pos || 0, exists: true } : { sec: 0, pos: 0, exists: false })));
  cur = { enroll: e, course: c, idx: -1, progress };
  $('c-title').textContent = c.title; $('c-badge').textContent = (PROGRAM[c.program] || '') + ' · ' + (TRACK[c.track] || '');
  $('c-msg').textContent = '';
  const isInv = c.track === 'investigator';
  $('c-inv').classList.toggle('hidden', !isInv);
  $('c-cert-card').classList.toggle('hidden', isInv);
  $('c-desc').textContent = isInv
    ? '영상을 모두 시청한 뒤 평가에 합격하고, 모의사건 조사보고서를 제출해 검토 승인을 받으면 수료증이 발급됩니다. 배속 재생한 시간은 인정되지 않습니다.'
    : '모든 영상을 끝까지 시청하면 수료증이 발급됩니다. 배속 재생한 시간은 인정되지 않습니다.';
  inv = null;
  if(isInv) await initInv(e, c);
  renderVideoList();
  const firstTodo = c.videos.findIndex((v, i) => !isVideoDone(i));
  show('v-course');
  playVideo(firstTodo >= 0 ? firstTodo : 0);
}
function isVideoDone(i){ const v = cur.course.videos[i]; return v.durationSec > 0 && cur.progress[i].sec >= Math.floor(v.durationSec * 0.95); }
function renderVideoList(){
  const c = cur.course;
  $('c-videos').innerHTML = c.videos.map((v, i) => {
    const pct = v.durationSec ? Math.min(100, Math.round(cur.progress[i].sec / v.durationSec * 100)) : 0;
    const done = isVideoDone(i);
    return `<div class="vitem ${i === cur.idx ? 'on' : ''} ${done ? 'done' : ''}" data-v="${i}"><div><b>${esc(v.title || (i + 1) + '번 영상')}</b><div class="small-t muted">${fmtDur(v.durationSec)} · ${done ? '시청 완료' : pct + '%'}</div></div><div class="bar"><div style="width:${done ? 100 : pct}%"></div></div></div>`;
  }).join('');
  const all = c.videos.every((v, i) => isVideoDone(i));
  const done = cur.enroll.status === 'done';
  $('c-cert').disabled = !(all || done);
  $('c-cert').textContent = done ? '수료증 보기' : '수료증 받기';
  $('c-done-text').textContent = done ? '수료한 과정입니다.' : (all ? '모든 영상을 시청했습니다. 수료증을 받으세요.' : '모든 영상을 시청하면 수료증을 받을 수 있습니다.');
  if(inv){ renderInvSteps(); if(inv.phase === 'videos' && invVideosDone()) renderInvBody(); }
}
$('c-videos').addEventListener('click', e => { const v = e.target.closest('[data-v]'); if(v) playVideo(+v.dataset.v); });
$('c-replay').onclick = () => { if(cur) playVideo(cur.idx, true); };
$('c-next').onclick = () => { if(cur && cur.idx < cur.course.videos.length - 1) playVideo(cur.idx + 1); };

async function playVideo(i, fromStart){
  await flushProgress(); stopPlayer(true);
  cur.idx = i; $('c-vdone').classList.add('hidden'); renderVideoList();
  const v = cur.course.videos[i];
  $('c-stat').textContent = '영상을 불러오는 중…';
  try{
    const [{ data }] = await Promise.all([fx.httpsCallable('eduPlaybackAuth')({ videoId: v.videoId }), loadPlayerJs()]);
    if(!data.libraryId) throw new Error('영상 라이브러리 설정이 없습니다 (functions/.env의 BUNNY_LIBRARY_ID).');
    const p = cur.progress[i];
    const start = (fromStart || isVideoDone(i)) ? 0 : Math.max(0, Math.min(p.pos || 0, (v.durationSec || 0) - 5));
    const frame = $('c-frame');
    frame.src = `https://iframe.mediadelivery.net/embed/${data.libraryId}/${v.videoId}?token=${data.token}&expires=${data.expires}&autoplay=false&preload=true` + (start ? '&t=' + start : '') + '&_=' + Date.now();
    player = new playerjs.Player(frame);
    track = { lastPos: null, lastReal: null, gained: 0, playing: false };
    player.on('ready', () => {
      player.on('play', () => { track.playing = true; track.lastPos = null; });
      player.on('pause', () => { track.playing = false; flushProgress(); });
      player.on('ended', () => { track.playing = false; flushProgress(); renderVideoDone(); });
      player.on('timeupdate', (d) => onTime(d && typeof d.seconds === 'number' ? d.seconds : null));
    });
    flushTimer = setInterval(() => { if(track && track.gained >= 20) flushProgress(); }, 5000);
    updateStat();
  } catch(e){ $('c-stat').textContent = errText(e); }
}
function onTime(pos){
  if(pos == null || !track) return;
  const now = Date.now();
  if(track.lastPos != null && track.playing){
    const dPos = pos - track.lastPos, dReal = (now - track.lastReal) / 1000;
    // 정상 재생 구간만 인정: 앞으로 넘긴 구간, 배속으로 늘어난 시간은 제외
    if(dPos > 0 && dPos < 3) track.gained += Math.min(dPos, dReal);
  }
  track.lastPos = pos; track.lastReal = now; track.pos = pos;
  updateStat();
}
function updateStat(){
  if(!cur || cur.idx < 0) return;
  const v = cur.course.videos[cur.idx];
  $('c-stat').textContent = v.durationSec ? '' : '이 강의는 재생 시간이 등록되지 않아 수강 완료가 기록되지 않습니다. 운영자에게 알려 주세요.';
  renderVideoDone();
}
// 강의를 끝까지 들으면 '다시 보기 / 다음 강의' 안내를 띄웁니다
function renderVideoDone(){
  const box = $('c-vdone');
  if(!cur || cur.idx < 0 || !isVideoDone(cur.idx)){ box.classList.add('hidden'); return; }
  const last = cur.idx >= cur.course.videos.length - 1;
  const next = cur.course.videos.slice(cur.idx + 1).findIndex(() => true);
  $('c-vdone-text').textContent = last ? '마지막 강의까지 모두 들었습니다.' : `${cur.idx + 1}강을 끝까지 들었습니다.`;
  const btn = $('c-next');
  btn.classList.toggle('hidden', last);
  if(!last) btn.textContent = `${cur.idx + 2}강 보기`;
  box.classList.remove('hidden');
}
let flushing = false;
async function flushProgress(){
  if(!cur || cur.idx < 0 || !track || flushing) return;
  const t = track, C = cur, i = cur.idx, p = cur.progress[i];
  const add = Math.floor(t.gained);
  const pos = Math.floor(t.pos || 0);
  if(add < 1 && !(pos && Math.abs(pos - (p.pos || 0)) > 10)) return;
  flushing = true;
  const step = Math.min(add, 85);
  const next = p.sec + step;
  const ref = db.collection('eduProgress').doc(`${me.uid}_${C.course.id}_${i}`);
  try{
    await ref.set({ uid: me.uid, courseId: C.course.id, idx: i, sec: next, pos, updatedAt: TS() });
    p.sec = next; p.pos = pos; p.exists = true; t.gained -= step;
  } catch(e){
    // 규칙에 막히면(너무 빠른 저장 등) 서버 값으로 맞추고 이어서 누적
    try{ const s = await ref.get(); if(s.exists){ p.sec = s.data().sec || 0; } } catch(err){}
    t.gained = Math.min(t.gained, 30);
  } finally {
    flushing = false;
    if(cur && cur.idx === i) renderVideoList(), updateStat();
    saveProgressSummary();
  }
}
// 담당자·관리자 화면에서 볼 수 있도록 수강 정보에 진도(%)만 따로 적어 둡니다
let lastPctSaved = -1;
function coursePct(){
  if(!cur) return 0;
  const vs = cur.course.videos || [];
  const total = vs.reduce((a, v) => a + (v.durationSec || 0), 0);
  if(!total) return 0;
  const done = vs.reduce((a, v, i) => a + Math.min(cur.progress[i].sec, v.durationSec || 0), 0);
  return Math.max(0, Math.min(100, Math.round(done / total * 100)));
}
function saveProgressSummary(){
  if(!cur || cur.enroll.status === 'done') return;
  const pct = coursePct();
  if(pct === lastPctSaved || pct - (cur.enroll.progressPct || 0) < 1) return;
  lastPctSaved = pct; cur.enroll.progressPct = pct;
  db.collection('eduEnrollments').doc(cur.enroll.id).update({ progressPct: pct, lastSeenAt: TS() }).catch(() => {});
}

function stopPlayer(keepCur){
  if(flushTimer){ clearInterval(flushTimer); flushTimer = null; }
  if(!keepCur && inv){ saveReport(); inv = null; }
  if(!keepCur){
    if(track) flushProgress();
    const f = $('c-frame'); if(f) f.src = 'about:blank';
    cur = null;
  }
  player = null; track = null;
}
window.addEventListener('beforeunload', () => { flushProgress(); });
document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'hidden') flushProgress(); });

$('c-cert').onclick = async () => {
  const btn = $('c-cert'), msg = $('c-msg'); msg.textContent = '';
  if(cur.enroll.status === 'done' && cur.enroll.certNo) return openCert(cur.enroll.certNo);
  btn.disabled = true;
  try{
    await flushProgress();
    const r = (await fx.httpsCallable('eduIssueCertificate')({ enrollmentId: cur.enroll.id })).data;
    cur.enroll.status = 'done'; cur.enroll.certNo = r.certNo;
    openCert(r.certNo);
  } catch(e){ msg.textContent = errText(e); btn.disabled = false; }
};

// ---------- 조사관 과정: 평가 · 조사보고서 ----------
let inv = null; // { enroll, course, quiz, report:{exists, body, status, reviewComment}, phase, saveTimer, dirty }
const REPORT_MIN = 300;
async function initInv(e, c){
  const id = e.id;
  const [qr, rp] = await Promise.all([
    db.collection('eduQuizResults').doc(id).get().catch(() => null),
    db.collection('eduReports').doc(id).get().catch(() => null)
  ]);
  const R = rp && rp.exists ? rp.data() : null;
  inv = { enroll: e, course: c, phase: '', saveTimer: null, dirty: false,
    quiz: qr && qr.exists ? qr.data() : null,
    report: { exists: !!R, body: R ? (R.body || '') : '', status: R ? (R.status || 'draft') : 'draft', reviewComment: R ? (R.reviewComment || '') : '' } };
  if(inv.quiz && inv.quiz.passed) e.quizPassed = true;
  $('inv-msg').textContent = '';
  renderInvBody();
}
const invOffline = () => inv.enroll.mode === 'offline';
function invVideosDone(){ return invOffline() || (cur && cur.course.videos.every((v, i) => isVideoDone(i))); }
function renderInvSteps(){
  if(!inv) return;
  const e = inv.enroll, st = inv.report.status, done = e.status === 'done';
  const vDone = invVideosDone(), qDone = invOffline() || !!e.quizPassed, rDone = st === 'submitted' || st === 'approved' || done;
  const steps = [
    ['강의 수강', invOffline() ? '대면 수강' : (vDone ? '완료' : '진행 중'), vDone ? 'done' : 'now'],
    ['평가', invOffline() ? '해당 없음' : (qDone ? `합격 (${e.quizScore != null ? e.quizScore : (inv.quiz ? inv.quiz.bestScore : '-')}점)` : (vDone ? '응시 가능' : '대기')), qDone ? 'done' : (vDone ? 'now' : '')],
    ['조사보고서', rDone ? '제출 완료' : (st === 'revision' ? '보완 요청' : (qDone && vDone ? '작성 중' : '대기')), rDone ? 'done' : (qDone && vDone ? 'now' : '')],
    ['검토 · 수료', done ? '수료' : (st === 'submitted' ? '검토 중' : '대기'), done ? 'done' : (st === 'submitted' ? 'now' : '')]
  ];
  $('inv-steps').innerHTML = steps.map(s => `<li class="${s[2]}"><span>${esc(s[0])}</span><b>${esc(s[1])}</b></li>`).join('');
}
function renderInvBody(){
  if(!inv) return;
  renderInvSteps();
  const e = inv.enroll, st = inv.report.status, box = $('inv-body');
  $('inv-msg').className = 'msg'; $('inv-msg').textContent = '';
  if(e.status === 'done'){
    inv.phase = 'done';
    box.innerHTML = `<p>조사보고서가 승인되어 과정을 수료했습니다.</p>${inv.report.reviewComment ? `<div class="note-box" style="margin-top:12px;background:var(--ok-bg);color:var(--ok)"><b>검토 의견</b>${esc(inv.report.reviewComment)}</div>` : ''}<div class="row" style="margin-top:14px"><button class="primary" id="inv-cert">수료증 보기</button><button id="inv-case">사건 자료 보기</button></div><h4 style="margin:20px 0 8px;font-size:15px;color:var(--ink)">제출한 보고서</h4><div class="doc">${esc(inv.report.body)}</div>`;
    $('inv-cert').onclick = () => openCert(e.certNo);
    $('inv-case').onclick = openCaseFile;
    return;
  }
  if(st === 'submitted'){
    inv.phase = 'submitted';
    box.innerHTML = `<p>보고서를 검토하고 있습니다. 결과는 가입한 이메일로 알려드립니다.</p><div class="row" style="margin-top:14px"><button id="inv-case">사건 자료 보기</button></div><h4 style="margin:20px 0 8px;font-size:15px;color:var(--ink)">제출한 보고서</h4><div class="doc">${esc(inv.report.body)}</div>`;
    $('inv-case').onclick = openCaseFile;
    return;
  }
  if(!invVideosDone()){
    inv.phase = 'videos';
    box.innerHTML = '<p class="muted">모든 영상을 시청하면 평가를 볼 수 있습니다.</p>';
    return;
  }
  if(!invOffline() && !e.quizPassed){
    inv.phase = 'quiz';
    const q = inv.quiz;
    box.innerHTML = `<p>강의 내용을 확인하는 평가입니다. ${inv.course.passScore ? `${inv.course.passScore}점 이상이면 합격이며, ` : ''}합격할 때까지 다시 응시할 수 있습니다.</p>${q && q.attempts ? `<p class="small-t muted" style="margin-top:6px">지금까지 ${q.attempts}회 응시, 최고 ${q.bestScore}점</p>` : ''}<div class="row" style="margin-top:14px"><button class="primary" id="inv-quiz-start">평가 시작</button></div><div id="inv-quiz"></div>`;
    $('inv-quiz-start').onclick = startQuiz;
    return;
  }
  inv.phase = 'report';
  renderReportEditor();
}

async function startQuiz(){
  const btn = $('inv-quiz-start'), msg = $('inv-msg'); msg.className = 'msg'; msg.textContent = '';
  btn.disabled = true;
  try{
    await flushProgress();
    const d = (await fx.httpsCallable('eduGetQuiz')({ enrollmentId: inv.enroll.id })).data;
    btn.parentElement.remove();
    $('inv-quiz').innerHTML = `<div class="card" style="margin-top:4px;padding:20px">${d.questions.map((q, i) => `<div class="quiz-q"><p>${i + 1}. ${esc(q.q)}</p>${q.options.map((o, k) => `<label><input type="radio" name="qz-${i}" value="${k}"> <span>${esc(o)}</span></label>`).join('')}</div>`).join('')}</div><div class="row" style="margin-top:14px"><button class="primary" id="inv-quiz-submit">답안 제출</button><span class="small-t muted">${d.questions.length}문항 · 합격 ${d.passScore}점</span></div>`;
    $('inv-quiz-submit').onclick = () => submitQuiz(d.questions.length);
  } catch(e){ msg.textContent = errText(e); btn.disabled = false; }
}
async function submitQuiz(n){
  const msg = $('inv-msg'), btn = $('inv-quiz-submit'); msg.className = 'msg'; msg.textContent = '';
  const answers = [];
  for(let i = 0; i < n; i++){
    const c = document.querySelector(`input[name="qz-${i}"]:checked`);
    if(!c) return msg.textContent = `${i + 1}번 문항에 답해 주세요.`;
    answers.push(+c.value);
  }
  btn.disabled = true;
  try{
    const r = (await fx.httpsCallable('eduSubmitQuiz')({ enrollmentId: inv.enroll.id, answers })).data;
    inv.quiz = Object.assign({}, inv.quiz, { attempts: ((inv.quiz && inv.quiz.attempts) || 0) + 1, bestScore: Math.max((inv.quiz && inv.quiz.bestScore) || 0, r.score), passed: r.passed });
    if(r.passed){
      inv.enroll.quizPassed = true; inv.enroll.quizScore = Math.max(inv.enroll.quizScore || 0, r.score);
      renderInvBody();
      $('inv-msg').className = 'msg ok'; $('inv-msg').textContent = `${r.score}점으로 합격했습니다. 이제 사건 자료를 읽고 조사보고서를 작성해 주세요.`;
    } else {
      renderInvBody();
      $('inv-msg').textContent = `${r.score}점입니다 (합격 ${r.passScore}점). 강의를 다시 확인한 뒤 1분 후에 다시 응시할 수 있습니다.`;
    }
  } catch(e){ msg.textContent = errText(e); btn.disabled = false; }
}

function reportLen(t){ return String(t || '').replace(/\s/g, '').length; }
function renderReportEditor(){
  const st = inv.report.status;
  $('inv-body').innerHTML = `${st === 'revision' && inv.report.reviewComment ? `<div class="note-box" style="margin-bottom:14px"><b>보완 요청</b>${esc(inv.report.reviewComment)}</div>` : ''}
    <p>사건 자료를 읽고, 강의에서 배운 순서에 따라 조사보고서를 작성해 주세요. 작성 중인 내용은 자동으로 저장됩니다.</p>
    <div class="row" style="margin-top:12px"><button id="inv-case">사건 자료 보기</button></div>
    <label style="margin-top:16px">조사보고서<textarea class="report-ed" id="inv-report" maxlength="30000" placeholder="1. 조사 개요&#10;2. 신고 내용&#10;3. 조사 경과&#10;4. 인정 사실&#10;5. 판단&#10;6. 조치 의견"></textarea></label>
    <div class="row" style="justify-content:space-between;margin-top:8px"><span class="small-t muted" id="inv-count"></span><span class="small-t muted" id="inv-saved"></span></div>
    <div class="row" style="margin-top:14px"><button class="primary" id="inv-submit">${st === 'revision' ? '보완해서 다시 제출' : '보고서 제출'}</button><span class="small-t muted">제출하면 검토가 끝날 때까지 고칠 수 없습니다.</span></div>`;
  const ta = $('inv-report');
  ta.value = inv.report.body;
  const count = () => { const n = reportLen(ta.value); $('inv-count').textContent = `공백 제외 ${n.toLocaleString()}자${n < REPORT_MIN ? ` (최소 ${REPORT_MIN}자)` : ''}`; };
  count();
  ta.addEventListener('input', () => {
    inv.report.body = ta.value; inv.dirty = true; count();
    $('inv-saved').textContent = '저장 대기 중…';
    clearTimeout(inv.saveTimer); inv.saveTimer = setTimeout(saveReport, 1500);
  });
  ta.addEventListener('blur', () => saveReport());
  $('inv-case').onclick = openCaseFile;
  $('inv-submit').onclick = submitReport;
}
let saving = null;
async function saveReport(){
  const I = inv;
  if(!I || !I.dirty) return saving;
  if(saving) { await saving; if(!I.dirty) return; }
  clearTimeout(I.saveTimer);
  I.dirty = false;
  const ref = db.collection('eduReports').doc(I.enroll.id), body = I.report.body;
  saving = (async () => {
    try{
      if(I.report.exists) await ref.update({ body, updatedAt: TS() });
      else { await ref.set({ uid: me.uid, courseId: I.course.id, body, updatedAt: TS() }); I.report.exists = true; }
      const el = $('inv-saved'); if(el && inv === I){ const t = new Date(); el.textContent = `저장됨 ${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}`; }
    } catch(e){
      I.dirty = true;
      const el = $('inv-saved'); if(el && inv === I) el.textContent = '저장하지 못했습니다. 잠시 후 다시 시도합니다.';
    } finally { saving = null; }
  })();
  return saving;
}
async function submitReport(){
  const msg = $('inv-msg'), btn = $('inv-submit'); msg.className = 'msg'; msg.textContent = '';
  if(reportLen(inv.report.body) < REPORT_MIN) return msg.textContent = `보고서는 공백을 빼고 ${REPORT_MIN}자 이상 작성해 주세요.`;
  if(!confirm('보고서를 제출할까요? 검토가 끝날 때까지 내용을 고칠 수 없습니다.')) return;
  btn.disabled = true;
  try{
    inv.dirty = true; await saveReport();
    if(inv.dirty) throw new Error('보고서를 저장하지 못했습니다. 잠시 후 다시 제출해 주세요.');
    await fx.httpsCallable('eduSubmitReport')({ enrollmentId: inv.enroll.id });
    inv.report.status = 'submitted'; inv.enroll.reportStatus = 'submitted';
    renderInvBody();
    $('inv-msg').className = 'msg ok'; $('inv-msg').textContent = '보고서를 제출했습니다.';
  } catch(e){ msg.textContent = errText(e); btn.disabled = false; }
}
async function openCaseFile(){
  try{
    const s = await db.collection('eduCaseFiles').doc(inv.course.id).get();
    const body = s.exists ? (s.data().body || '') : '';
    if(!body.trim()) return alert('사건 자료가 아직 준비되지 않았습니다.');
    const who = (learner && learner.name ? learner.name : (inv.enroll.name || '')) + (me.email ? ' (' + me.email + ')' : '');
    $('m-title').textContent = '모의사건 자료';
    $('m-body').textContent = `열람자: ${who}\n\n${body}\n\n────────────\n© ${OPERATOR}. 이 자료는 CNL Works 조사관 과정 수강생의 학습용으로만 제공됩니다. 무단 복제·배포와 외부 유출을 금지합니다.`;
    $('modal').querySelector('.card').classList.add('wide');
    $('modal').classList.remove('hidden');
  } catch(e){ alert(errText(e)); }
}
document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'hidden') saveReport(); });

// ---------- 수료증 ----------
function certHtml(c){
  const showOrg = c.orgName && c.track !== 'offender';
  const verifyUrl = location.origin + location.pathname + '#/verify/' + c.no;
  return `<div class="cert">
    <img class="mark" src="${MARK}" alt="">
    <div class="no">제 ${esc(c.no)} 호</div>
    <h1>수료증</h1>
    <dl>
      <dt>성 명</dt><dd>${esc(c.name)}</dd>
      ${showOrg ? `<dt>소 속</dt><dd>${esc(c.orgName)}${c.dept ? ' ' + esc(c.dept) : ''}</dd>` : ''}
      <dt>교육과정</dt><dd>${esc(c.certTitle || c.courseTitle)}</dd>
      <dt>교육방식</dt><dd>${c.mode === 'offline' ? '대면(집합) 교육' : '온라인 교육'}${c.hoursLabel ? ' · ' + esc(c.hoursLabel) : ''}</dd>
      <dt>수 료 일</dt><dd>${esc(kDateLong(c.completedDate))}</dd>
    </dl>
    <p class="stmt">${c.track === 'investigator'
      ? `위 사람은 CNL Works가 실시한<br>「${esc(c.certTitle || c.courseTitle)}」 과정에서<br>강의, 시험, 실습 과제를 모두 이수하고<br>수료하였음을 증명합니다.`
      : `위 사람은 CNL Works가 실시한<br>「${esc(c.certTitle || c.courseTitle)}」 과정을<br>수료하였음을 증명합니다.`}</p>
    <p class="date">${esc(kDateLong(c.completedDate))}</p>
    <div class="issuer"><small>CNL Works</small>노무법인 C&amp;L<img src="${STAMP}" alt="직인"></div>
    <div class="verify">진위 확인: ${esc(verifyUrl)}</div>
  </div>`;
}
let certBack = null;
async function openCert(no){
  certBack = prevView;
  stopPlayer();
  try{
    const s = await db.collection('eduCertificates').doc(no).get();
    if(!s.exists) throw new Error('수료증을 찾을 수 없습니다.');
    $('cv-box').innerHTML = certHtml(s.data());
    show('v-cert');
  } catch(e){ alert(errText(e)); }
}
$('cv-back').onclick = () => { if(certBack === 'v-hr') openHr(); else if(certBack === 'v-admin') openAdmin(currentTab); else loadHome(); };
$('cv-print').onclick = () => printCerts(null);
function printCerts(list){
  $('print-area').innerHTML = list ? list.map(certHtml).join('') : $('cv-box').innerHTML;
  setTimeout(() => window.print(), 50);
}

// ---------- 회사 담당자 ----------
let hrData = { enr: [], certs: [] };
async function openHr(){
  stopPlayer();
  $('hr-org').innerHTML = hrOrgs.map(o => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('');
  show('v-hr');
  await loadHrOrg();
}
$('hr-org').onchange = loadHrOrg;
async function loadHrOrg(){
  const orgId = $('hr-org').value; if(!orgId) return;
  const [es, cs] = await Promise.all([
    db.collection('eduEnrollments').where('orgId', '==', orgId).get(),
    db.collection('eduCertificates').where('orgId', '==', orgId).get()
  ]);
  hrData.enr = es.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => String(a.name).localeCompare(b.name, 'ko'));
  hrData.certs = cs.docs.map(d => d.data()).filter(c => !c.revoked);
  const off = hrData.certs.filter(c => c.mode === 'offline' && !c.enrollmentId);
  const done = hrData.enr.filter(e => e.status === 'done').length;
  $('hr-stats').innerHTML = `<div><div class="small-t muted">온라인 참여</div><b style="font-size:22px">${hrData.enr.length}</b></div><div><div class="small-t muted">온라인 수료</div><b style="font-size:22px">${done}</b></div><div><div class="small-t muted">집합교육 수료</div><b style="font-size:22px">${off.length}</b></div>`;
  $('hr-enr').innerHTML = hrData.enr.length ? `<table><thead><tr><th>성명</th><th>사번</th><th>부서</th><th>과정</th><th>진도</th><th>상태</th><th>수료번호</th><th></th></tr></thead><tbody>${hrData.enr.map(e => `<tr><td>${esc(e.name)}</td><td>${esc(e.empNo || '-')}</td><td>${esc(e.dept || '-')}</td><td>${esc(e.courseTitle)}</td><td>${pctCell(e)}</td><td>${badge(e.status)}${invStage(e) ? `<div class="small-t muted">${esc(invStage(e))}</div>` : ''}</td><td>${esc(e.certNo || '-')}</td><td>${e.certNo ? `<button class="small" data-cert="${esc(e.certNo)}">수료증</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="muted small-t">아직 참여한 직원이 없습니다.</p>';
  $('hr-off').innerHTML = off.length ? `<table><thead><tr><th>성명</th><th>사번</th><th>부서</th><th>과정</th><th>교육일</th><th>수료번호</th><th></th></tr></thead><tbody>${off.map(c => `<tr><td>${esc(c.name)}</td><td>${esc(c.empNo || '-')}</td><td>${esc(c.dept || '-')}</td><td>${esc(c.certTitle)}</td><td>${esc(c.completedDate)}</td><td>${esc(c.no)}</td><td><button class="small" data-cert="${esc(c.no)}">수료증</button></td></tr>`).join('')}</tbody></table>` : '<p class="muted small-t">집합교육 수료 기록이 없습니다.</p>';
}
$('v-hr').addEventListener('click', e => { const c = e.target.closest('[data-cert]'); if(c) openCert(c.dataset.cert); });
$('hr-print').onclick = () => { if(!hrData.certs.length) return alert('출력할 수료증이 없습니다.'); printCerts(hrData.certs.slice().sort((a, b) => a.no.localeCompare(b.no))); };
$('hr-csv').onclick = () => {
  const rows = [['구분','성명','사번','부서','과정','진도(%)','상태','수료번호','수료일']];
  const certByNo = Object.fromEntries(hrData.certs.map(c => [c.no, c]));
  hrData.enr.forEach(e => rows.push(['온라인', e.name, e.empNo || '', e.dept || '', e.courseTitle, e.status === 'done' ? 100 : (e.progressPct || 0), invStage(e) || (STATUS[e.status] || [e.status])[0], e.certNo || '', e.certNo && certByNo[e.certNo] ? certByNo[e.certNo].completedDate : '']));
  hrData.certs.filter(c => c.mode === 'offline' && !c.enrollmentId).forEach(c => rows.push(['집합', c.name, c.empNo || '', c.dept || '', c.certTitle, '', '수료', c.no, c.completedDate]));
  downloadCsv(rows, '교육현황_' + ($('hr-org').selectedOptions[0] || {}).text + '.csv');
};
function downloadCsv(rows, name){
  const csv = '\uFEFF' + rows.map(r => r.map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(',')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- 메인 관리자 ----------
let currentTab = 'contracts', orgs = [];
async function openAdmin(tab){
  stopPlayer(); show('v-admin');
  await Promise.all([loadCourses(), loadOrgs()]);
  fillCourseSelects();
  setTab(tab || currentTab);
}
document.querySelectorAll('#atabs button').forEach(b => b.onclick = () => setTab(b.dataset.tab));
function setTab(t){
  currentTab = t;
  document.querySelectorAll('#atabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  document.querySelectorAll('[data-panel]').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== t));
  ({ orders: loadOrders, contracts: loadContracts, qna: loadQnaAdmin, enroll: loadEnrolls, reports: loadReports, orgs: renderOrgs, invites: loadInvites, offline: prepOffline, certs: loadCerts, courses: renderCourses })[t]();
}
async function loadOrgs(){ const s = await db.collection('eduOrgs').get(); orgs = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => String(a.name).localeCompare(b.name, 'ko')); }
function courseOpts(filter){ return courses.filter(filter).map(c => `<option value="${esc(c.id)}">${esc(c.title)}${c.active === false ? ' (중지)' : ''}</option>`).join('') || '<option value="">먼저 과정을 만들어 주세요</option>'; }
function fillCourseSelects(){
  $('ao-course').innerHTML = courseOpts(c => c.track === 'general');
  $('ai-course').innerHTML = courseOpts(c => c.track === 'offender' || c.track === 'investigator');
  $('af-course').innerHTML = courseOpts(() => true);
  const orgOpts = orgs.map(o => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('');
  $('ai-org').innerHTML = '<option value="">회사 없음 (개인)</option>' + orgOpts;
  $('af-org').innerHTML = orgOpts + '<option value="__manual">직접 입력</option><option value="">회사 없음</option>';
  $('af-orgname-l').classList.toggle('hidden', $('af-org').value !== '__manual');
}

// 계약 신청 (홈페이지 기업 교육 신청)
let contracts = [];
const MODE_T = { online: '온라인', offline: '집합(대면)', both: '온라인 + 집합' };
async function loadContracts(){
  const s = await db.collection('eduContractRequests').orderBy('createdAt', 'desc').limit(300).get();
  contracts = s.docs.map(d => ({ id: d.id, ...d.data() })); renderContracts();
}
$('ct-filter').onchange = renderContracts; $('ct-reload').onclick = loadContracts;
function renderContracts(){
  const f = $('ct-filter').value;
  const list = contracts.filter(c => f === 'all' || c.status === f);
  if(!list.length){ $('ct-list').innerHTML = '<div class="card"><p class="muted small-t">해당하는 신청이 없습니다.</p></div>'; return; }
  $('ct-list').innerHTML = list.map(c => {
    const isInvReq = c.program === 'investigator' || c.program === 'sexual-investigator';
    const opts = courses.filter(x => x.track === 'general' && (x.program || 'harassment') === (c.program || 'harassment'))
      .map(x => `<option value="${esc(x.id)}">${esc(x.title)}</option>`).join('');
    const st = c.status === 'approved' ? `<span class="badge ok">${isInvReq ? '계약 완료' : '코드 발급 완료'}</span>` : (c.status === 'closed' ? '<span class="badge">종료</span>' : '<span class="badge warn">새 신청</span>');
    const act = c.status === 'new' && isInvReq
      ? `<div class="row" style="margin-top:14px"><span class="small-t muted">방문 강의와 실습 과제를 마친 뒤 '집합교육 수료'에서 조사관 과정으로 수료 처리하세요.</span><button class="small primary" data-done-ct="${esc(c.id)}">계약 완료로 표시</button><button class="small" data-close-ct="${esc(c.id)}">종료</button></div>`
      : c.status === 'new'
      ? `<div class="row" style="margin-top:14px"><select data-course="${esc(c.id)}" style="max-width:280px;margin:0">${opts || '<option value="">일반 과정을 먼저 만들어 주세요</option>'}</select><label class="row" style="margin:0;font-weight:500"><input type="checkbox" data-mail="${esc(c.id)}" checked> 담당자에게 안내 메일</label><button class="small primary" data-approve-ct="${esc(c.id)}">계약 완료 → 회사 등록·코드 발급</button><button class="small" data-close-ct="${esc(c.id)}">종료</button></div>`
      : (c.joinCode ? `<p class="small-t" style="margin-top:12px">교육 코드 <span class="code">${esc(fmtCode(c.joinCode))}</span></p>` : '');
    return `<div class="card"><div class="row" style="justify-content:space-between"><div>${st} <b style="font-size:16px;margin-left:4px">${esc(c.company)}</b> <span class="small-t muted">${isInvReq ? (c.program === 'sexual-investigator' ? '성희롱' : '괴롭힘') + ' 조사관 과정 · 방문 집합' : esc(PROGRAM[c.program] || '') + ' 예방교육'} · ${esc(c.headcount)}명 · ${esc(MODE_T[c.mode] || '')}</span></div><span class="small-t muted">${kDate(tsDate(c.createdAt))}</span></div>
      <dl class="kv"><dt>담당자</dt><dd>${esc(c.name)}${c.title ? ' / ' + esc(c.title) : ''}</dd><dt>연락처</dt><dd>${esc(c.phone)} · ${esc(c.email)}</dd>${c.bizNo ? `<dt>사업자번호</dt><dd>${esc(c.bizNo)}</dd>` : ''}${c.billEmail ? `<dt>세금계산서</dt><dd>${esc(c.billEmail)}</dd>` : ''}<dt>희망 시기</dt><dd>${esc(c.when || '-')}</dd>${c.place ? `<dt>교육 장소</dt><dd>${esc(c.place)}</dd>` : ''}<dt>궁금한 점</dt><dd>${esc(c.question || '-')}</dd></dl>${act}</div>`;
  }).join('');
}
$('ct-list').addEventListener('click', async e => {
  const a = e.target.closest('[data-approve-ct]'), c = e.target.closest('[data-close-ct]'), dn = e.target.closest('[data-done-ct]');
  try{
    if(dn){
      await db.collection('eduContractRequests').doc(dn.dataset.doneCt).update({ status: 'approved', approvedAt: TS() });
    } else if(a){
      const id = a.dataset.approveCt, courseId = document.querySelector(`[data-course="${id}"]`).value;
      if(!courseId) return alert('일반 사내교육 과정을 먼저 만들어 주세요.');
      if(!confirm('계약이 완료된 신청인가요? 회사를 등록하고 교육 코드를 발급합니다.')) return;
      a.disabled = true;
      const r = (await fx.httpsCallable('eduApproveContract')({ requestId: id, courseId, sendMail: document.querySelector(`[data-mail="${id}"]`).checked })).data;
      alert(`교육 코드 ${fmtCode(r.joinCode)} 발급 완료` + (r.mailed ? ' · 담당자에게 안내 메일을 보냈습니다.' : ''));
      await loadOrgs(); fillCourseSelects();
    } else if(c){
      if(!confirm('이 신청을 종료 처리할까요?')) return;
      await db.collection('eduContractRequests').doc(c.dataset.closeCt).update({ status: 'closed', closedAt: TS() });
    } else return;
    await loadContracts();
  } catch(err){ alert(errText(err)); if(a) a.disabled = false; }
});

// 개인 수강 결제 주문
let orders = [];
async function loadOrders(){
  const s = await db.collection('eduOrders').orderBy('createdAt', 'desc').limit(500).get();
  orders = s.docs.map(d => ({ id: d.id, ...d.data() })); renderOrders();
}
$('or-filter').onchange = renderOrders; $('or-reload').onclick = loadOrders;
const won = n => Number(n || 0).toLocaleString('ko-KR') + '원';
function renderOrders(){
  const f = $('or-filter').value;
  const list = orders.filter(o => f === 'all' || o.status === f);
  const ST = { paid: '<span class="badge ok">결제 완료</span>', ready: '<span class="badge warn">진행 중</span>', failed: '<span class="badge">실패</span>' };
  $('or-list').innerHTML = list.length ? `<table><thead><tr><th>결제일</th><th>성명</th><th>이메일 · 연락처</th><th>과정</th><th>금액</th><th>수강 연결</th><th>상태</th><th></th></tr></thead><tbody>${list.map(o => `<tr><td>${kDate(tsDate(o.paidAt || o.createdAt))}<div class="small-t muted">${esc(o.id)}</div></td><td>${esc(o.name)}</td><td class="small-t">${esc(o.email)}<div class="muted">${esc(o.phone || '-')}</div></td><td>${esc(o.courseTitle)}</td><td>${won(o.amount)}</td><td>${o.claimedBy ? '<span class="badge ok">완료</span>' : (o.status === 'paid' ? '<span class="badge warn">가입 대기</span>' : '-')}</td><td>${ST[o.status] || esc(o.status)}</td><td>${o.receiptUrl ? `<a class="small-t" href="${esc(o.receiptUrl)}" target="_blank" rel="noopener">영수증</a>` : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="muted small-t">해당하는 주문이 없습니다.</p>';
}
$('or-csv').onclick = () => {
  const rows = [['주문번호','결제일','성명','이메일','연락처','과정','금액','상태','수강 연결']];
  orders.forEach(o => rows.push([o.id, kDate(tsDate(o.paidAt || o.createdAt)), o.name, o.email, o.phone || '', o.courseTitle, o.amount, o.status, o.claimedBy ? '완료' : '']));
  const csv = '\uFEFF' + rows.map(r => r.map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(',')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = '결제주문.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

// Q&A (홈페이지)
// 공지
let notices = [], editingNotice = null;
async function loadNotices(){
  const s = await db.collection('qnaNotices').orderBy('createdAt', 'desc').get();
  notices = s.docs.map(d => ({ id: d.id, ...d.data() }));
  $('an-list').innerHTML = notices.length ? `<table><thead><tr><th>등록일</th><th>제목</th><th></th></tr></thead><tbody>${notices.map(n => `<tr><td>${kDate(tsDate(n.createdAt))}</td><td>${esc(n.title)}</td><td style="white-space:nowrap"><button class="small" data-n-edit="${esc(n.id)}">수정</button> <button class="small" data-n-del="${esc(n.id)}">삭제</button> <a class="small-t" href="/#/qna/notice-${esc(n.id)}" target="_blank" rel="noopener">홈페이지에서 보기</a></td></tr>`).join('')}</tbody></table>` : '<p class="muted small-t">등록된 공지가 없습니다.</p>';
}
function fillNotice(n){
  editingNotice = n ? n.id : null;
  $('an-form-title').textContent = n ? '공지 수정' : '공지 작성';
  $('an-save').textContent = n ? '공지 수정' : '공지 등록';
  $('an-title').value = n ? n.title || '' : ''; $('an-body').value = n ? n.body || '' : ''; $('an-msg').textContent = '';
}
$('an-new').onclick = () => fillNotice(null);
$('an-save').onclick = async () => {
  const msg = $('an-msg'); msg.className = 'msg'; msg.textContent = '';
  const title = $('an-title').value.trim(), body = $('an-body').value.trim();
  if(title.length < 2) return msg.textContent = '제목을 입력해 주세요.';
  if(body.length < 5) return msg.textContent = '내용을 입력해 주세요.';
  try{
    if(editingNotice) await db.collection('qnaNotices').doc(editingNotice).update({ title, body, updatedAt: TS() });
    else await db.collection('qnaNotices').add({ title, body, createdAt: TS(), updatedAt: TS() });
    const was = editingNotice; fillNotice(null); await loadNotices();
    msg.className = 'msg ok'; msg.textContent = was ? '공지를 수정했습니다.' : '공지를 등록했습니다.';
  } catch(err){ msg.textContent = errText(err); }
};
$('an-list').addEventListener('click', async ev => {
  const ed = ev.target.closest('[data-n-edit]'), del = ev.target.closest('[data-n-del]');
  if(ed){ fillNotice(notices.find(n => n.id === ed.dataset.nEdit)); $('an-title').focus(); return; }
  if(del){
    if(!confirm('이 공지를 삭제할까요? 되돌릴 수 없습니다.')) return;
    try{ await db.collection('qnaNotices').doc(del.dataset.nDel).delete(); if(editingNotice === del.dataset.nDel) fillNotice(null); await loadNotices(); }
    catch(err){ alert(errText(err)); }
  }
});

let qnaItems = [];
async function loadQnaAdmin(){
  loadNotices().catch(err => { $('an-list').innerHTML = `<p class="msg">${esc(errText(err))}</p>`; });
  const [q, s] = await Promise.all([db.collection('qna').orderBy('createdAt', 'desc').limit(300).get(), db.collection('qnaSecret').get()]);
  const sec = Object.fromEntries(s.docs.map(d => [d.id, d.data()]));
  qnaItems = q.docs.map(d => ({ id: d.id, ...d.data(), ...(sec[d.id] || {}) })); renderQnaAdmin();
}
$('aq-filter').onchange = renderQnaAdmin; $('aq-reload').onclick = loadQnaAdmin;
function renderQnaAdmin(){
  const f = $('aq-filter').value;
  const list = qnaItems.filter(q => f === 'all' || q.status === f);
  $('aq-list').innerHTML = list.length ? list.map(q => `<div class="card">
    <div class="row" style="justify-content:space-between"><div>${q.status === 'answered' ? '<span class="badge ok">답변 완료</span>' : '<span class="badge warn">답변 대기</span>'} ${q.isPrivate ? '<span class="badge">비공개</span>' : '<span class="badge in">공개</span>'} <span class="small-t muted">${esc(q.category)}</span></div><span class="small-t muted">${kDate(tsDate(q.createdAt))}</span></div>
    <h3 style="font-size:17px;margin-top:10px">${esc(q.title)}</h3>
    <p class="small-t muted" style="margin-top:2px">${esc(q.name)} · ${esc(q.email)}</p>
    <p style="white-space:pre-wrap;margin-top:10px">${esc(q.body)}</p>
    <label>답변<textarea rows="5" data-ans="${esc(q.id)}">${esc(q.answer || '')}</textarea></label>
    <div class="row" style="margin-top:10px"><button class="small primary" data-save-ans="${esc(q.id)}">${q.status === 'answered' ? '답변 수정' : '답변 등록'}</button><label class="row" style="margin:0;font-weight:500"><input type="checkbox" data-ans-mail="${esc(q.id)}" ${q.status === 'answered' ? '' : 'checked'}> 질문자에게 메일</label><button class="small" data-del-q="${esc(q.id)}">삭제</button><a class="small-t" href="/#/qna/${esc(q.id)}" target="_blank" rel="noopener">홈페이지에서 보기</a></div>
  </div>`).join('') : '<div class="card"><p class="muted small-t">해당하는 질문이 없습니다.</p></div>';
}
$('aq-list').addEventListener('click', async e => {
  const s = e.target.closest('[data-save-ans]'), d = e.target.closest('[data-del-q]');
  try{
    if(s){
      const id = s.dataset.saveAns, answer = document.querySelector(`[data-ans="${id}"]`).value.trim();
      if(answer.length < 2) return alert('답변을 입력해 주세요.');
      s.disabled = true;
      const r = (await fx.httpsCallable('qnaAnswer')({ id, answer, sendMail: document.querySelector(`[data-ans-mail="${id}"]`).checked })).data;
      if(r.mailed) alert('답변을 등록하고 질문자에게 메일을 보냈습니다.');
    } else if(d){
      if(!confirm('이 질문을 삭제할까요? 되돌릴 수 없습니다.')) return;
      const b = db.batch(); b.delete(db.collection('qna').doc(d.dataset.delQ)); b.delete(db.collection('qnaSecret').doc(d.dataset.delQ)); await b.commit();
    } else return;
    await loadQnaAdmin();
  } catch(err){ alert(errText(err)); if(s) s.disabled = false; }
});

// 신청·수강
let adminEnrolls = [];
async function loadEnrolls(){
  const s = await db.collection('eduEnrollments').orderBy('createdAt', 'desc').limit(500).get();
  adminEnrolls = s.docs.map(d => ({ id: d.id, ...d.data() }));
  renderEnrolls();
}
$('ae-filter').onchange = renderEnrolls; $('ae-reload').onclick = loadEnrolls;
function renderEnrolls(){
  const f = $('ae-filter').value;
  const list = adminEnrolls.filter(e => f === 'all' || e.status === f);
  const src = { code: '회사 코드', invite: '회사 지정', apply: '개인 신청' };
  $('ae-list').innerHTML = list.length ? `<table><thead><tr><th>신청일</th><th>성명</th><th>과정</th><th>경로</th><th>방식</th><th>진도</th><th>연락처 · 사유</th><th>상태</th><th></th></tr></thead><tbody>${list.map(e => {
    let act = '';
    if(e.status === 'pending') act = `<button class="small primary" data-approve="${esc(e.id)}">승인</button> <button class="small" data-reject="${esc(e.id)}">반려</button>`;
    else if(e.status === 'active' && e.track === 'investigator') act = e.reportStatus === 'submitted' ? `<button class="small primary" data-goreports="1">보고서 검토</button>` : `<span class="small-t muted">${esc(invStage(e))}</span>`;
    else if(e.status === 'active') act = `<button class="small" data-offdone="${esc(e.id)}">수료 처리</button>`;
    else if(e.status === 'done') act = `<button class="small" data-cert="${esc(e.certNo)}">수료증</button>`;
    return `<tr><td>${kDate(tsDate(e.createdAt))}</td><td>${esc(e.name)}${e.orgName ? `<div class="small-t muted">${esc(e.orgName)}</div>` : (e.orgText ? `<div class="small-t muted">${esc(e.orgText)}</div>` : '')}</td><td>${esc(e.courseTitle)}</td><td>${src[e.source] || ''}</td><td>${e.mode === 'offline' ? '대면' : '온라인'}</td><td>${e.mode === 'offline' ? '-' : pctCell(e)}</td><td class="small-t">${esc(e.phone || '')}${e.reason ? `<div class="muted">${esc(e.reason)}</div>` : ''}</td><td>${badge(e.status)}</td><td style="white-space:nowrap">${act}</td></tr>`;
  }).join('')}</tbody></table>` : '<p class="muted small-t">해당하는 항목이 없습니다.</p>';
}
$('ae-list').addEventListener('click', async e => {
  const a = e.target.closest('[data-approve]'), r = e.target.closest('[data-reject]'), o = e.target.closest('[data-offdone]'), c = e.target.closest('[data-cert]');
  if(e.target.closest('[data-goreports]')) return setTab('reports');
  try{
    if(a){ await db.collection('eduEnrollments').doc(a.dataset.approve).update({ status: 'active', approvedAt: TS(), approvedBy: me.uid }); }
    else if(r){ if(!confirm('이 신청을 반려할까요?')) return; await db.collection('eduEnrollments').doc(r.dataset.reject).update({ status: 'rejected', rejectedAt: TS() }); }
    else if(o){
      const date = prompt('교육(수료)일을 입력하세요 (YYYY-MM-DD). 온라인 과정을 직접 수료 처리할 때도 사용합니다.', kDate(new Date()));
      if(!date) return;
      await fx.httpsCallable('eduIssueOffline')({ enrollmentId: o.dataset.offdone, date });
    }
    else if(c){ return openCert(c.dataset.cert); }
    else return;
    await loadEnrolls();
  } catch(err){ alert(errText(err)); }
});

// 보고서 검토 (조사관 과정)
let adminReports = [];
async function loadReports(){
  $('ar-view').classList.add('hidden');
  const s = await db.collection('eduReports').orderBy('submittedAt', 'desc').limit(300).get();
  adminReports = s.docs.map(d => ({ id: d.id, ...d.data() }));
  renderReports();
}
$('ar-filter').onchange = renderReports; $('ar-reload').onclick = loadReports;
const REPORT_ST = { submitted: ['검토 대기','warn'], revision: ['보완 요청 중',''], approved: ['승인','ok'] };
function renderReports(){
  const f = $('ar-filter').value;
  const list = adminReports.filter(r => f === 'all' || r.status === f);
  $('ar-list').innerHTML = list.length ? `<table><thead><tr><th>제출일</th><th>성명</th><th>과정</th><th>평가</th><th>제출</th><th>분량</th><th>상태</th><th></th></tr></thead><tbody>${list.map(r => {
    const st = REPORT_ST[r.status] || [r.status, ''];
    return `<tr><td>${kDate(tsDate(r.submittedAt))}</td><td>${esc(r.name)}${r.orgName ? `<div class="small-t muted">${esc(r.orgName)}</div>` : ''}</td><td>${esc(r.courseTitle)}</td><td>${r.quizScore == null ? '-' : esc(r.quizScore) + '점'}</td><td>${esc(r.submitCount || 1)}회</td><td>${reportLen(r.body).toLocaleString()}자</td><td><span class="badge ${st[1]}">${esc(st[0])}</span></td><td><button class="small" data-rview="${esc(r.id)}">보기</button></td></tr>`;
  }).join('')}</tbody></table>` : '<p class="muted small-t">해당하는 보고서가 없습니다.</p>';
}
$('ar-list').addEventListener('click', e => { const b = e.target.closest('[data-rview]'); if(b) viewReport(b.dataset.rview); });
function viewReport(id){
  const r = adminReports.find(x => x.id === id); if(!r) return;
  const v = $('ar-view'); v.classList.remove('hidden');
  const canReview = r.status === 'submitted';
  v.innerHTML = `<div class="row" style="justify-content:space-between"><h3 style="font-size:17px">${esc(r.name)} · ${esc(r.courseTitle)}</h3><button class="small" id="ar-close">닫기</button></div>
    <p class="small-t muted" style="margin-top:4px">평가 ${r.quizScore == null ? '-' : esc(r.quizScore) + '점'} · ${esc(r.submitCount || 1)}번째 제출 · 공백 제외 ${reportLen(r.body).toLocaleString()}자${r.certNo ? ' · 수료번호 ' + esc(r.certNo) : ''}</p>
    ${r.reviewComment ? `<div class="note-box" style="margin-top:12px"><b>이전 검토 의견</b>${esc(r.reviewComment)}</div>` : ''}
    <div class="doc" style="margin-top:14px">${esc(r.body)}</div>
    ${canReview ? `<label>검토 의견 <span class="opt">(보완 요청 시 필수, 수강생에게 메일로 전달됩니다)</span><textarea id="ar-comment" rows="5"></textarea></label>
    <div class="row" style="margin-top:14px"><button class="primary" id="ar-approve">승인하고 수료증 발급</button><button id="ar-revise">보완 요청</button></div>
    <div class="msg" id="ar-msg"></div>` : ''}`;
  $('ar-close').onclick = () => v.classList.add('hidden');
  if(canReview){
    const go = async (decision) => {
      const msg = $('ar-msg'); msg.className = 'msg'; msg.textContent = '';
      const comment = $('ar-comment').value.trim();
      if(decision === 'revise' && comment.length < 5) return msg.textContent = '보완할 내용을 적어 주세요.';
      if(decision === 'approve' && !confirm(`${r.name} 님의 보고서를 승인하고 수료증을 발급할까요?`)) return;
      $('ar-approve').disabled = $('ar-revise').disabled = true;
      try{
        const d = (await fx.httpsCallable('eduReviewReport')({ enrollmentId: id, decision, comment })).data;
        await loadReports();
        alert(decision === 'approve' ? `승인했습니다. 수료번호 ${d.certNo}${d.mailed ? ', 수강생에게 메일을 보냈습니다.' : ''}` : `보완을 요청했습니다.${d.mailed ? ' 수강생에게 메일을 보냈습니다.' : ''}`);
      } catch(e){ msg.textContent = errText(e); $('ar-approve').disabled = $('ar-revise').disabled = false; }
    };
    $('ar-approve').onclick = () => go('approve');
    $('ar-revise').onclick = () => go('revise');
  }
  v.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// 회사·교육 코드
function renderOrgs(){
  $('ao-list').innerHTML = orgs.length ? `<table><thead><tr><th>회사</th><th>과정</th><th>교육 코드</th><th>담당자 이메일</th><th>상태</th><th></th></tr></thead><tbody>${orgs.map(o => {
    const c = courses.find(x => x.id === o.courseId);
    return `<tr><td>${esc(o.name)}</td><td>${esc(c ? c.title : '-')}</td><td><span class="code">${esc(fmtCode(o.joinCode))}</span></td><td class="small-t">${esc((o.hrEmails || []).join(', ') || '-')}</td><td>${o.active === false ? '<span class="badge">중지</span>' : '<span class="badge ok">사용 중</span>'}</td><td style="white-space:nowrap"><button class="small" data-hr="${esc(o.id)}">담당자 수정</button> <button class="small" data-toggle="${esc(o.id)}">${o.active === false ? '다시 사용' : '코드 중지'}</button></td></tr>`;
  }).join('')}</tbody></table>` : '<p class="muted small-t">등록된 회사가 없습니다.</p>';
}
function parseEmails(s){ return String(s || '').split(/[,\s;]+/).map(x => x.trim().toLowerCase()).filter(x => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)); }
$('ao-add').onclick = async () => {
  const msg = $('ao-msg'); msg.className = 'msg'; msg.textContent = '';
  const name = $('ao-name').value.trim(), courseId = $('ao-course').value;
  if(!name) return msg.textContent = '회사명을 입력해 주세요.';
  if(!courseId) return msg.textContent = '일반 사내교육 과정을 먼저 만들어 주세요.';
  const code = genCode(); const ref = db.collection('eduOrgs').doc();
  const b = db.batch();
  b.set(ref, { name, courseId, hrEmails: parseEmails($('ao-hr').value), joinCode: code, active: true, createdAt: TS() });
  b.set(db.collection('eduJoinCodes').doc(code), { orgId: ref.id, orgName: name, courseId, active: true, createdAt: TS() });
  try{ await b.commit(); $('ao-name').value = ''; $('ao-hr').value = ''; msg.className = 'msg ok'; msg.textContent = `등록했습니다. 교육 코드: ${fmtCode(code)}`; await loadOrgs(); fillCourseSelects(); renderOrgs(); }
  catch(e){ msg.textContent = errText(e); }
};
$('ao-list').addEventListener('click', async e => {
  const h = e.target.closest('[data-hr]'), t = e.target.closest('[data-toggle]');
  try{
    if(h){
      const o = orgs.find(x => x.id === h.dataset.hr);
      const v = prompt('담당자 이메일 (쉼표로 구분)', (o.hrEmails || []).join(', '));
      if(v == null) return;
      await db.collection('eduOrgs').doc(o.id).update({ hrEmails: parseEmails(v) });
    } else if(t){
      const o = orgs.find(x => x.id === t.dataset.toggle); const active = o.active === false;
      const b = db.batch();
      b.update(db.collection('eduOrgs').doc(o.id), { active });
      b.update(db.collection('eduJoinCodes').doc(o.joinCode), { active });
      await b.commit();
    } else return;
    await loadOrgs(); renderOrgs();
  } catch(err){ alert(errText(err)); }
});

// 지정 대상자
async function loadInvites(){
  const s = await db.collection('eduInvites').orderBy('createdAt', 'desc').limit(300).get();
  const list = s.docs.map(d => ({ code: d.id, ...d.data() }));
  $('ai-list').innerHTML = list.length ? `<table><thead><tr><th>만든 날</th><th>대상자</th><th>과정</th><th>회사</th><th>방식</th><th>수강 코드</th><th>상태</th></tr></thead><tbody>${list.map(v => `<tr><td>${kDate(tsDate(v.createdAt))}</td><td>${esc(v.name)}</td><td>${esc(v.courseTitle)}</td><td>${esc(v.orgName || '-')}</td><td>${v.mode === 'offline' ? '대면' : '온라인'}</td><td><span class="code">${esc(fmtCode(v.code))}</span></td><td>${v.usedBy ? '<span class="badge ok">사용됨</span>' : '<span class="badge">미사용</span>'}</td></tr>`).join('')}</tbody></table>` : '<p class="muted small-t">만든 수강 코드가 없습니다.</p>';
}
$('ai-add').onclick = async () => {
  const msg = $('ai-msg'); msg.className = 'msg'; msg.textContent = '';
  const courseId = $('ai-course').value, name = $('ai-name').value.trim();
  if(!courseId) return msg.textContent = '재발방지 또는 조사관 과정을 먼저 만들어 주세요.';
  if(name.length < 2) return msg.textContent = '대상자 성명을 입력해 주세요.';
  const c = courses.find(x => x.id === courseId); const o = orgs.find(x => x.id === $('ai-org').value);
  const code = genCode();
  try{
    await db.collection('eduInvites').doc(code).set({ courseId, courseTitle: c ? c.title : '', name, orgId: o ? o.id : null, orgName: o ? o.name : '', mode: $('ai-mode').value, usedBy: null, createdAt: TS(), createdBy: me.uid });
    $('ai-name').value = ''; msg.className = 'msg ok'; msg.textContent = `수강 코드: ${fmtCode(code)} — 대상자에게 교육센터 주소(${location.origin}/edu/)와 함께 전달하세요.`;
    loadInvites();
  } catch(e){ msg.textContent = errText(e); }
};

// 집합교육 수료
function prepOffline(){ if(!$('af-date').value) $('af-date').value = kDate(new Date()); countPeople(); }
$('af-org').onchange = () => $('af-orgname-l').classList.toggle('hidden', $('af-org').value !== '__manual');
function parsePeople(){
  return $('af-people').value.split(/\r?\n/).map(l => l.split(/\t|,/).map(x => x.trim())).filter(a => a[0] && a[0].length >= 2)
    .map(a => ({ name: a[0], empNo: a[1] || '', dept: a[2] || '' }));
}
function countPeople(){ const n = parsePeople().length; $('af-count').textContent = n ? n + '명' : ''; }
$('af-people').addEventListener('input', countPeople);
$('af-issue').onclick = async () => {
  const msg = $('af-msg'), btn = $('af-issue'); msg.className = 'msg'; msg.textContent = '';
  const people = parsePeople(), courseId = $('af-course').value;
  if(!courseId) return msg.textContent = '과정을 선택해 주세요.';
  if(!people.length) return msg.textContent = '수료자 명단을 입력해 주세요.';
  const orgSel = $('af-org').value;
  const data = { courseId, date: $('af-date').value, place: $('af-place').value.trim(), people,
    orgId: orgSel && orgSel !== '__manual' ? orgSel : null, orgName: orgSel === '__manual' ? $('af-orgname').value.trim() : '' };
  if(!confirm(`${people.length}명에게 수료증을 발급할까요? 발급 후에는 번호가 다시 쓰이지 않습니다.`)) return;
  btn.disabled = true;
  try{
    const r = (await fx.httpsCallable('eduIssueOffline')(data)).data;
    msg.className = 'msg ok'; msg.textContent = `${r.certNos.length}명 발급 완료 (${r.certNos[0]} ~ ${r.certNos[r.certNos.length - 1]}). '수료증' 탭에서 출력할 수 있습니다.`;
    $('af-people').value = ''; countPeople();
  } catch(e){ msg.textContent = errText(e); }
  finally{ btn.disabled = false; }
};

// 수료증
let adminCerts = [];
async function loadCerts(){
  const s = await db.collection('eduCertificates').orderBy('issuedAt', 'desc').limit(1000).get();
  adminCerts = s.docs.map(d => d.data()); renderCerts();
}
$('ac-reload').onclick = loadCerts; $('ac-q').oninput = renderCerts;
function renderCerts(){
  const q = $('ac-q').value.trim();
  const list = adminCerts.filter(c => !q || [c.name, c.no, c.orgName].some(v => String(v || '').includes(q)));
  $('ac-list').innerHTML = list.length ? `<div class="row" style="margin-bottom:8px"><button class="small" id="ac-print">아래 ${list.filter(c => !c.revoked).length}건 출력</button></div><table><thead><tr><th>수료번호</th><th>성명</th><th>소속</th><th>과정</th><th>방식</th><th>수료일</th><th></th></tr></thead><tbody>${list.map(c => `<tr><td>${esc(c.no)}${c.revoked ? ' <span class="badge">취소</span>' : ''}</td><td>${esc(c.name)}</td><td>${esc(c.orgName || '-')}</td><td>${esc(c.certTitle)}</td><td>${c.mode === 'offline' ? '대면' : '온라인'}</td><td>${esc(c.completedDate)}</td><td style="white-space:nowrap"><button class="small" data-cert="${esc(c.no)}">보기</button>${c.revoked ? '' : ` <button class="small" data-revoke="${esc(c.no)}">취소</button>`}</td></tr>`).join('')}</tbody></table>` : '<p class="muted small-t">발급된 수료증이 없습니다.</p>';
  const p = $('ac-print'); if(p) p.onclick = () => printCerts(list.filter(c => !c.revoked));
}
$('ac-list').addEventListener('click', async e => {
  const c = e.target.closest('[data-cert]'), r = e.target.closest('[data-revoke]');
  if(c) return openCert(c.dataset.cert);
  if(r){
    const why = prompt('수료를 취소하는 사유를 입력하세요 (예: 대리 수강 확인). 취소된 수료증은 진위 확인에서 "없음"으로 나옵니다.');
    if(!why) return;
    try{ await db.collection('eduCertificates').doc(r.dataset.revoke).update({ revoked: true, revokedAt: TS(), revokeReason: why.slice(0, 200) }); loadCerts(); }
    catch(err){ alert(errText(err)); }
  }
});

// 과정 — 영상 업로드 (Bunny Stream)
let tusP = null;
function ensureTus(){
  if(window.tus) return Promise.resolve(window.tus);
  if(tusP) return tusP;
  tusP = new Promise((res, rej) => {
    const el = document.createElement('script');
    el.src = 'https://cdn.jsdelivr.net/npm/tus-js-client@4/dist/tus.min.js';
    el.onload = () => res(window.tus); el.onerror = () => rej(new Error('업로드 도구를 불러오지 못했습니다.'));
    document.head.appendChild(el);
  });
  return tusP;
}
function upUi(text, pct){
  $('cc-up-status').textContent = text || '';
  const bar = $('cc-up-bar');
  if(pct == null){ bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  $('cc-up-fill').style.width = Math.round(pct) + '%';
}
// 과정에 담긴 강의 목록 (화면에서 순서·제목을 바로 고칩니다)
let ccVideos = [];
// 목록에서 뺀 영상 중 '영상 파일까지 삭제'를 고른 것 — 저장할 때 실제로 지웁니다
let pendingVideoDeletes = [];
// 이 영상을 쓰는 다른 과정이 있는지
function videoUsedElsewhere(videoId, exceptCourseId){
  return courses.some(c => c.id !== exceptCourseId && (c.videos || []).some(v => v.videoId === videoId));
}
async function deleteBunnyVideos(ids){
  let okCount = 0, lastMsg = '';
  for(const id of ids){
    try{
      const r = (await fx.httpsCallable('bunnyDeleteVideo')({ videoId: id })).data;
      if(r && r.ok) okCount++; else lastMsg = (r && r.message) || '';
    } catch(e){ lastMsg = errText(e); }
  }
  return { okCount, failCount: ids.length - okCount, lastMsg };
}
function renderVList(){
  const box = $('cc-vlist');
  if(!ccVideos.length){ box.innerHTML = '<div class="vlist-empty">아직 올린 강의가 없습니다. 위에서 영상 파일을 선택하세요.</div>'; return; }
  box.innerHTML = ccVideos.map((v, i) => `<div class="vrow" data-i="${i}">
    <span class="no">${i + 1}강</span>
    <input data-vt="${i}" maxlength="60" value="${esc(v.title || '')}" placeholder="강의 제목 (예: 직장 내 괴롭힘이란)">
    <span class="dur ${v.durationSec ? '' : 'zero'}">${v.durationSec ? fmtDur(v.durationSec) : '길이 확인 중'}</span>
    <span class="acts">
      <button data-vup="${i}" ${i === 0 ? 'disabled' : ''} title="위로">↑</button>
      <button data-vdn="${i}" ${i === ccVideos.length - 1 ? 'disabled' : ''} title="아래로">↓</button>
      <button data-vdel="${i}" title="삭제">삭제</button>
    </span>
  </div>`).join('');
  const zero = ccVideos.filter(v => !v.durationSec).length;
  $('cc-len-note').textContent = zero ? `${zero}개의 길이를 아직 받지 못했습니다. Bunny가 영상을 처리하는 데 몇 분 걸립니다.` : '';
}
$('cc-vlist').addEventListener('input', ev => {
  const t = ev.target.closest('[data-vt]'); if(!t) return;
  ccVideos[+t.dataset.vt].title = t.value;
});
$('cc-vlist').addEventListener('click', ev => {
  const up = ev.target.closest('[data-vup]'), dn = ev.target.closest('[data-vdn]'), del = ev.target.closest('[data-vdel]');
  if(up){ const i = +up.dataset.vup; [ccVideos[i - 1], ccVideos[i]] = [ccVideos[i], ccVideos[i - 1]]; }
  else if(dn){ const i = +dn.dataset.vdn; [ccVideos[i + 1], ccVideos[i]] = [ccVideos[i], ccVideos[i + 1]]; }
  else if(del){
    const i = +del.dataset.vdel, v = ccVideos[i];
    const used = videoUsedElsewhere(v.videoId, editingCourse);
    if(!confirm(`${i + 1}강을 이 과정에서 뺄까요?`)) return;
    if(used) alert('이 영상은 다른 과정에서도 쓰고 있어 영상 파일은 지우지 않습니다.');
    else if(confirm('올린 영상 파일도 함께 지울까요?\n\n[확인] 저장할 때 영상 파일까지 삭제합니다 (되돌릴 수 없습니다)\n[취소] 목록에서만 빼고 영상 파일은 남겨 둡니다')){
      pendingVideoDeletes.push(v.videoId);
    }
    ccVideos.splice(i, 1);
  }
  else return;
  renderVList();
});

// 올린 직후에는 Bunny가 처리 중이라 길이를 모릅니다 — 잠시 뒤 자동으로 받아옵니다
async function fetchDurations(silent){
  const ids = ccVideos.map(v => v.videoId);
  if(!ids.length) return 0;
  try{
    const { videos } = (await fx.httpsCallable('eduGetVideoInfo')({ videoIds: ids })).data;
    let filled = 0;
    ccVideos.forEach(v => {
      const info = videos[v.videoId];
      if(info && info.durationSec){ if(!v.durationSec) filled++; v.durationSec = info.durationSec; }
    });
    renderVList();
    return filled;
  } catch(e){ if(!silent) throw e; return 0; }
}
let durTimer = null;
function waitForDurations(){
  if(durTimer) clearTimeout(durTimer);
  let tries = 0;
  const tick = async () => {
    tries++;
    await fetchDurations(true);
    if(ccVideos.some(v => !v.durationSec) && tries < 12) durTimer = setTimeout(tick, 15000);
  };
  durTimer = setTimeout(tick, 12000);
}

$('cc-file').onchange = async (ev) => {
  const file = ev.target.files[0]; if(!file) return;
  const msg = $('cc-msg'); msg.className = 'msg'; msg.textContent = '';
  const btnFile = ev.target;
  upUi('업로드 준비 중…', 0);
  try{
    const tusLib = await ensureTus();
    const n = ccVideos.length + 1;
    const title = n + '강';
    const auth = (await fx.httpsCallable('bunnyCreateUpload')({ title })).data;
    await new Promise((resolve, reject) => {
      new tusLib.Upload(file, {
        endpoint: 'https://video.bunnycdn.com/tusupload',
        retryDelays: [0, 1000, 3000, 5000, 10000],
        headers: { AuthorizationSignature: auth.signature, AuthorizationExpire: String(auth.expirationTime), VideoId: auth.videoId, LibraryId: String(auth.libraryId) },
        metadata: { filetype: file.type, title },
        onError: reject,
        onProgress: (sent, total) => upUi(`업로드 중… ${Math.round(sent/1048576)}MB / ${Math.round(total/1048576)}MB`, sent / total * 100),
        onSuccess: resolve
      }).start();
    });
    ccVideos.push({ videoId: auth.videoId, title, durationSec: 0 });
    renderVList(); waitForDurations();
    upUi('업로드 완료 — 영상 길이는 잠시 뒤 자동으로 채워집니다. 제목을 고쳐 주세요.', 100);
  } catch(e){
    upUi('', null);
    msg.textContent = '업로드 실패: ' + errText(e);
  } finally { btnFile.value = ''; }
};
$('cc-fetch-len').onclick = async (ev) => {
  ev.preventDefault();
  const btn = ev.currentTarget, msg = $('cc-msg'); msg.className = 'msg'; msg.textContent = '';
  if(!ccVideos.length) return msg.textContent = '먼저 영상을 올려 주세요.';
  btn.disabled = true;
  try{
    await fetchDurations(false);
    const zero = ccVideos.filter(v => !v.durationSec).length;
    msg.className = 'msg ok';
    msg.textContent = zero ? `${zero}개는 아직 Bunny에서 처리 중입니다. 잠시 뒤 다시 눌러 주세요.` : '영상 길이를 모두 받았습니다.';
  } catch(e){ msg.textContent = errText(e); }
  finally{ btn.disabled = false; }
};

// 과정
let editingCourse = null;
function renderCourses(){
  renderSell();
  $('cc-list').innerHTML = courses.length ? `<table><thead><tr><th>과정</th><th>분야 · 구분</th><th>영상</th><th>교육 시간</th><th>상태</th><th></th></tr></thead><tbody>${courses.map(c => `<tr><td>${esc(c.title)}</td><td>${esc(PROGRAM[c.program] || '')} · ${esc(TRACK[c.track] || '')}</td><td>${(c.videos || []).length}개 · ${fmtDur((c.videos || []).reduce((a, v) => a + (v.durationSec || 0), 0))}${c.track === 'investigator' ? `<div class="small-t muted">평가 ${esc(c.quizCount || 0)}문항 · 합격 ${esc(c.passScore || 70)}점</div>` : ''}</td><td>${esc(c.hoursLabel || '-')}</td><td>${c.active === false ? '<span class="badge">중지</span>' : '<span class="badge ok">운영 중</span>'}</td><td style="white-space:nowrap"><button class="small" data-edit="${esc(c.id)}">수정</button> <button class="small" data-cdel="${esc(c.id)}">삭제</button></td></tr>`).join('')}</tbody></table>` : '<p class="muted small-t">과정을 먼저 추가해 주세요.</p>';
}
function parseVideos(text){
  const out = [], bad = [];
  text.split(/\r?\n/).forEach((l, i) => {
    if(!l.trim()) return;
    const [id, title, dur] = l.split('|').map(x => (x || '').trim());
    const m = /^(\d+):(\d{1,2})$/.exec(dur || '') || /^(\d+)$/.exec(dur || '');
    const sec = m ? (m[2] != null ? (+m[1]) * 60 + (+m[2]) : (+m[1]) * 60) : 0;
    if(!/^[0-9a-fA-F-]{20,50}$/.test(id || '')) bad.push(i + 1); else out.push({ videoId: id, title: title || '', durationSec: sec });
  });
  return { out, bad };
}
// 평가 문항 텍스트 ↔ 데이터
function parseQuiz(text){
  const out = [], bad = [];
  String(text || '').replace(/\r\n?/g, '\n').split(/\n\s*\n/).map(b => b.trim()).filter(Boolean).forEach((b, i) => {
    const lines = b.split('\n').map(l => l.trim()).filter(Boolean);
    const qLines = [], options = []; let answer = -1, dup = false;
    lines.forEach(l => {
      if(/^[-*]/.test(l)){ if(l[0] === '*'){ if(answer >= 0) dup = true; answer = options.length; } options.push(l.slice(1).trim()); }
      else if(!options.length) qLines.push(l.replace(/^(Q\s*)?\d+\s*[.)]\s*/i, ''));
      else dup = true;
    });
    const q = qLines.join(' ').trim();
    if(!q || options.length < 2 || answer < 0 || dup || options.some(o => !o)) bad.push(i + 1);
    else out.push({ q, options, answer });
  });
  return { out, bad };
}
function quizToText(qs){ return (qs || []).map(q => [q.q, ...q.options.map((o, k) => (k === q.answer ? '* ' : '- ') + o)].join('\n')).join('\n\n'); }
function updateQuizCount(){
  const { out, bad } = parseQuiz($('cc-quiz').value);
  $('cc-quiz-count').textContent = bad.length ? `${bad.join(', ')}번째 문항을 확인해 주세요 (문제 한 줄, 보기 두 개 이상, 정답 하나).` : (out.length ? `${out.length}문항` : '');
}
$('cc-quiz').addEventListener('input', updateQuizCount);
const SELL_KEY = { 'harassment|offender': 'harassment-offender', 'sexual|offender': 'sexual-offender',
  'harassment|investigator': 'harassment-investigator', 'sexual|investigator': 'sexual-investigator' };
function renderSell(){
  const box = $('cc-sell'); const v = $('cc-product').value; const key = SELL_KEY[v];
  const price = parseInt($('cc-price').value, 10) || 0;
  const activeOk = $('cc-active').checked, applyOk = $('cc-apply').checked;
  if(!key){
    box.className = 'sell-box off';
    box.innerHTML = '<b>기업 계약 상품입니다</b>홈페이지에서 카드 결제로 팔지 않습니다. 기업이 신청서를 보내면 견적·계약 후 관리자가 교육 코드를 발급합니다. 개인 수강 가격은 비워 두세요.';
    return;
  }
  const miss = [];
  if(price <= 0) miss.push('개인 수강 가격');
  if(!activeOk) miss.push("'운영 중' 체크");
  if(!applyOk) miss.push("'개인 신청 받기' 체크");
  const url = location.origin + '/#/order/' + key;
  box.className = 'sell-box ' + (miss.length ? 'off' : 'on');
  box.innerHTML = miss.length
    ? `<b>아직 결제 버튼이 켜지지 않습니다</b>${esc(miss.join(', '))}이(가) 필요합니다. 저장하면 바로 반영됩니다.<br>구매 페이지: <code>${esc(url)}</code>`
    : `<b>판매 중 — 홈페이지에서 결제할 수 있습니다</b>구매 페이지: <code>${esc(url)}</code><br>같은 상품의 과정이 여러 개면 가격이 입력된 과정이 팔립니다.`;
}
['cc-price', 'cc-active', 'cc-apply'].forEach(id => $(id).addEventListener('input', renderSell));
function toggleInvFields(){ $('cc-inv').classList.toggle('hidden', $('cc-product').value.split('|')[1] !== 'investigator'); }
$('cc-product').addEventListener('change', () => { toggleInvFields(); renderSell(); });
function fillCourseForm(c){
  editingCourse = c ? c.id : null;
  $('ac-form-title').textContent = c ? '과정 수정' : '과정 추가';
  $('cc-title').value = c ? c.title : ''; $('cc-cert').value = c ? (c.certTitle || '') : '';
  $('cc-product').value = (c ? (c.program || 'harassment') : 'harassment') + '|' + (c ? (c.track || 'general') : 'general');
  $('cc-hours').value = c ? (c.hoursLabel || '') : '';
  $('cc-price').value = c && c.priceKrw ? c.priceKrw : '';
  $('cc-sample').checked = !!(c && c.sampleFree); $('cc-active').checked = c ? c.active !== false : true; $('cc-apply').checked = c ? c.allowApply !== false : true;
  pendingVideoDeletes = [];
  ccVideos = c ? (c.videos || []).map(v => ({ videoId: v.videoId, title: v.title || '', durationSec: v.durationSec || 0 })) : [];
  renderVList();
  if(durTimer){ clearTimeout(durTimer); durTimer = null; }
  if(ccVideos.some(v => !v.durationSec)) waitForDurations();
  upUi('', null);
  renderSell();
  $('cc-msg').textContent = '';
  $('cc-pass').value = c && c.passScore ? c.passScore : 70; $('cc-quiz').value = ''; $('cc-case').value = ''; $('cc-quiz-count').textContent = '';
  toggleInvFields();
  if(c && c.track === 'investigator'){
    const id = c.id;
    Promise.all([db.collection('eduQuizKeys').doc(id).get(), db.collection('eduCaseFiles').doc(id).get()]).then(([k, f]) => {
      if(editingCourse !== id) return;
      if(k.exists){ $('cc-quiz').value = quizToText(k.data().questions); if(k.data().passScore) $('cc-pass').value = k.data().passScore; }
      if(f.exists) $('cc-case').value = f.data().body || '';
      updateQuizCount();
    }).catch(() => {});
  }
}
$('cc-new').onclick = () => fillCourseForm(null);
$('cc-list').addEventListener('click', async ev => {
  const b = ev.target.closest('[data-edit]'), d = ev.target.closest('[data-cdel]');
  if(b){ fillCourseForm(courses.find(c => c.id === b.dataset.edit)); window.scrollTo(0, 0); return; }
  if(!d) return;
  const c = courses.find(x => x.id === d.dataset.cdel); if(!c) return;
  const msg = $('cc-msg'); msg.className = 'msg'; msg.textContent = '';
  d.disabled = true;
  try{
    // 수강·수료 기록이 있으면 지우지 않고 '중지'를 권합니다
    const [enr, certs] = await Promise.all([
      db.collection('eduEnrollments').where('courseId', '==', c.id).limit(1).get(),
      db.collection('eduCertificates').where('courseId', '==', c.id).limit(1).get()
    ]);
    if(!enr.empty || !certs.empty){
      msg.textContent = '수강하거나 수료한 사람이 있는 과정은 삭제할 수 없습니다. 더 받지 않으려면 과정을 열어 \'운영 중\' 체크를 풀어 주세요.';
      return;
    }
    if(!confirm(`'${c.title}' 과정을 삭제할까요?\n되돌릴 수 없습니다.`)) return;
    const own = (c.videos || []).map(v => v.videoId).filter(id => !videoUsedElsewhere(id, c.id));
    let alsoVideos = false;
    if(own.length) alsoVideos = confirm(`이 과정에만 쓰인 영상 ${own.length}개가 있습니다. 영상 파일도 함께 지울까요?\n\n[확인] 영상 파일까지 삭제\n[취소] 과정만 삭제하고 영상은 남김`);
    await db.collection('eduCourses').doc(c.id).delete();
    let delMsg = '';
    if(alsoVideos){
      const r = await deleteBunnyVideos(own);
      delMsg = (r.okCount ? ` 영상 파일 ${r.okCount}개도 삭제했습니다.` : '') +
        (r.failCount ? ` 영상 파일 ${r.failCount}개는 지우지 못했습니다. ${r.lastMsg}` : '');
    }
    if(editingCourse === c.id) fillCourseForm(null);
    msg.className = 'msg ok'; msg.textContent = '삭제했습니다.' + delMsg;
    await loadCourses(); fillCourseSelects(); renderCourses();
  } catch(err){ msg.textContent = errText(err); }
  finally{ d.disabled = false; }
});
$('cc-save').onclick = async () => {
  const msg = $('cc-msg'); msg.className = 'msg'; msg.textContent = '';
  const title = $('cc-title').value.trim(); if(!title) return msg.textContent = '과정명을 입력해 주세요.';
  if(ccVideos.some(v => !v.durationSec)){
    msg.textContent = '영상 길이를 받아오는 중입니다…';
    await fetchDurations(true);
  }
  const out = ccVideos.map((v, i) => ({ videoId: v.videoId, title: (v.title || '').trim() || (i + 1) + '강', durationSec: v.durationSec || 0 }));
  if(out.some(v => !v.durationSec)){
    if(!confirm('아직 길이를 받지 못한 영상이 있습니다. 이대로 저장하면 그 강의는 수강 완료 처리가 되지 않습니다.\n\n저장을 계속할까요? (몇 분 뒤 과정을 다시 열어 저장하면 길이가 채워집니다.)')) return;
  }
  const [prog, trk] = $('cc-product').value.split('|');
  const data = { title, certTitle: $('cc-cert').value.trim() || title, program: prog, track: trk,
    hoursLabel: $('cc-hours').value.trim(), active: $('cc-active').checked, allowApply: $('cc-apply').checked, videos: out,
    priceKrw: Math.max(0, parseInt($('cc-price').value, 10) || 0), sampleFree: $('cc-sample').checked, updatedAt: TS() };
  if(editingCourse){
    const c = courses.find(x => x.id === editingCourse);
    if(c && (c.videos || []).length && out.length !== c.videos.length && !confirm('영상 개수가 바뀌면 이미 수강 중인 사람의 진도가 영상 순서와 어긋날 수 있습니다. 계속할까요?')) return;
  }
  const isInv = trk === 'investigator';
  let quiz = [];
  if(isInv){
    const pq = parseQuiz($('cc-quiz').value);
    if(pq.bad.length) return msg.textContent = `평가 문항 ${pq.bad.join(', ')}번째를 확인해 주세요 (문제 한 줄, 보기 두 개 이상, 정답 하나).`;
    quiz = pq.out;
    const pass = parseInt($('cc-pass').value, 10);
    if(!(pass >= 1 && pass <= 100)) return msg.textContent = '합격 점수는 1~100 사이로 입력해 주세요.';
    data.passScore = pass; data.quizCount = quiz.length;
    if(data.active && !quiz.length && !confirm('평가 문항이 없으면 수강생이 평가를 볼 수 없습니다. 이대로 저장할까요?')) return;
  }
  try{
    const ref = editingCourse ? db.collection('eduCourses').doc(editingCourse) : db.collection('eduCourses').doc();
    if(!editingCourse) data.createdAt = TS();
    const b = db.batch();
    b.set(ref, data, { merge: true });
    if(isInv){
      b.set(db.collection('eduQuizKeys').doc(ref.id), { passScore: data.passScore, questions: quiz, updatedAt: TS() });
      b.set(db.collection('eduCaseFiles').doc(ref.id), { body: $('cc-case').value.slice(0, 200000), updatedAt: TS() });
    }
    await b.commit();
    let delMsg = '';
    if(pendingVideoDeletes.length){
      const r = await deleteBunnyVideos(pendingVideoDeletes);
      delMsg = (r.okCount ? ` 영상 파일 ${r.okCount}개를 삭제했습니다.` : '') +
        (r.failCount ? ` 영상 파일 ${r.failCount}개는 지우지 못했습니다. ${r.lastMsg}` : '');
      pendingVideoDeletes = [];
    }
    await loadCourses(); fillCourseSelects(); renderCourses(); fillCourseForm(null);
    msg.className = 'msg ok'; msg.textContent = '저장했습니다.' + delMsg;
  } catch(e){ msg.textContent = errText(e); }
};

// ---------- 주소 처리 ----------
function route(){
  const m = /^#\/verify(?:\/([A-Za-z0-9-]+))?/.exec(location.hash);
  if(m){
    show('v-verify');
    if(m[1]){ $('vf-no').value = m[1].toUpperCase(); runVerify(m[1].toUpperCase()); }
    return true;
  }
  return false;
}
window.addEventListener('hashchange', () => {
  if(route()) return;
  if(me) enterMode(); else show('v-auth');
});
route();
