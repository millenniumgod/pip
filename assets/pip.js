// ============================================================
// Firebase 프로젝트 설정 — 본인 Firebase 콘솔의 값으로 교체하세요
// (프로젝트 설정 > 일반 > 내 앱 > SDK 설정 및 구성)
// ============================================================
const firebaseConfig = {
  apiKey: "AIzaSyCDRIl6YcV8vAmZ6UMmGuXuWnQ89Gce2ZQ",
  authDomain: "pip-growth-program.firebaseapp.com",
  projectId: "pip-growth-program",
  storageBucket: "pip-growth-program.firebasestorage.app",
  messagingSenderId: "385712593094",
  appId: "1:385712593094:web:0434767f58485462081fc7"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const fx = firebase.functions(); // Bunny 업로드·재생 인증용 서버 함수 (functions/index.js)

// Bunny Stream 라이브러리 ID (숫자) — Bunny 대시보드 Stream > 라이브러리 > API 탭에서 확인.
// 비밀 값이 아니므로 여기 그대로 두셔도 됩니다. API 키·토큰 인증 키는 서버 함수 쪽에만 둡니다.
const BUNNY_LIBRARY_ID = "여기에_라이브러리_ID_입력";

// ---------- 탭 전환 (로그인/회원가입) ----------
const tabLogin = document.getElementById('tab-login');
const tabSignup = document.getElementById('tab-signup');
const loginForm = document.getElementById('login-form');
const signupForm = document.getElementById('signup-form');
tabLogin.onclick = () => { tabLogin.classList.add('active'); tabSignup.classList.remove('active'); loginForm.classList.remove('hidden'); signupForm.classList.add('hidden'); };
tabSignup.onclick = () => { tabSignup.classList.add('active'); tabLogin.classList.remove('active'); signupForm.classList.remove('hidden'); loginForm.classList.add('hidden'); };

// ---------- 보안 유틸 ----------
function strongEnough(pw){ return typeof pw === 'string' && pw.length >= 8 && /[A-Za-z]/.test(pw) && /[0-9]/.test(pw); }

// 개인정보 접근 기록: 메인 관리자·회사 관리자가 수강생 정보를 열람·출력·발급할 때 남김 (수정·삭제 불가, firestore.rules)
// 기록 실패가 업무를 막지 않도록 결과를 기다리지 않음
function logAccess(action, targetUid, detail){
  try{
    if(!currentUser || !(currentRole === 'admin' || currentRole === 'client_hr')) return;
    const rec = {
      by: currentUser.uid, role: currentRole,
      companyId: currentRole === 'client_hr' ? (currentCompanyId || null) : (adminSelectedCompanyId || null),
      action: String(action).slice(0, 40),
      targetUid: targetUid || null,
      at: firebase.firestore.FieldValue.serverTimestamp()
    };
    if(detail) rec.detail = String(detail).slice(0, 200);
    db.collection('accessLogs').add(rec).catch(() => {});
  } catch(e){}
}

// 관리자 화면 자동 로그아웃: 메인 관리자·회사 관리자가 30분간 조작이 없으면 로그아웃 (공용 PC 방치 대비)
const IDLE_LIMIT_MS = 30 * 60 * 1000;
let lastActivityAt = Date.now();
['click', 'keydown', 'mousemove', 'touchstart', 'scroll'].forEach(ev =>
  window.addEventListener(ev, () => { lastActivityAt = Date.now(); }, { passive: true }));
setInterval(() => {
  if(!currentUser || !(currentRole === 'admin' || currentRole === 'client_hr')) return;
  if(Date.now() - lastActivityAt < IDLE_LIMIT_MS) return;
  lastActivityAt = Date.now();
  auth.signOut().then(() => { alert('30분 동안 사용이 없어 개인정보 보호를 위해 자동으로 로그아웃되었습니다.'); location.reload(); });
}, 60 * 1000);

// ---------- 초대 코드 유틸 ----------
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 헷갈리는 0/O, 1/I 제외
function genCode(){
  const r = new Uint32Array(8);
  crypto.getRandomValues(r);
  return Array.from(r, x => CODE_ALPHABET[x % CODE_ALPHABET.length]).join('');
}
async function genUniqueCode(){
  for(let i = 0; i < 5; i++){
    const c = genCode();
    const snap = await db.collection('invites').doc(c).get();
    if(!snap.exists) return c;
  }
  throw new Error('코드 생성에 실패했습니다. 다시 시도하세요.');
}
function normalizeCode(s){ return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function fmtCode(c){ return c ? c.slice(0,4) + '-' + c.slice(4) : ''; }

function friendlyError(e){
  const map = {
    'auth/email-already-in-use': '이미 가입된 이메일입니다. 로그인해 주세요.',
    'auth/invalid-email': '이메일 형식이 올바르지 않습니다.',
    'auth/weak-password': '비밀번호는 8자 이상이며 영문과 숫자를 모두 포함해야 합니다.',
    'auth/invalid-credential': '이메일 또는 비밀번호가 올바르지 않습니다.',
    'auth/wrong-password': '이메일 또는 비밀번호가 올바르지 않습니다.',
    'auth/user-not-found': '이메일 또는 비밀번호가 올바르지 않습니다.',
    'auth/too-many-requests': '시도 횟수가 많아 잠시 후 다시 시도해 주세요.',
    'permission-denied': '권한이 없거나 초대 코드가 더 이상 유효하지 않습니다.',
    'auth/requires-recent-login': '보안을 위해 다시 로그인한 뒤 시도해 주세요.'
  };
  return map[e && e.code] || (e && e.message) || '알 수 없는 오류';
}

const ROLE_LABELS = { trainee: '수강생', client_hr: '회사 관리자', admin: '메인 관리자' };

// ================= 약관·개인정보 동의 =================
// ※ 아래 문안은 초안입니다. 운영 전 법률 검토 후 확정하고, 내용을 바꾸면 LEGAL_VERSION을 올리세요
//   (버전이 바뀌면 기존 이용자에게도 다음 로그인 때 다시 동의를 받습니다).
const LEGAL_VERSION = '2026-10-03';   // 문안을 고치면 이 값을 올리세요 (전원 재확인)
const OPERATOR = '노무법인 C&L';
const SERVICE = 'CNL Works PIP';
const CONTACT_EMAIL = 'cnlcg@cnlcg.co.kr';
{ const el = document.getElementById('auth-contact'); if(el && !el.textContent) el.textContent = CONTACT_EMAIL; }
const PRIVACY_OFFICER = '성명: 이상호 · 채형석 (직책: 대표) / 문의: ' + CONTACT_EMAIL;
const RETENTION = '교육 과정 종료일부터 3년';  // 보유기간 — 확정되면 이 문구만 바꾸면 전 문서에 반영됩니다
const DATA_REGION = '대한민국 서울 리전(asia-northeast3)';  // Firestore 데이터베이스 저장 위치

// 이 서비스는 고객사(회사)가 개인정보처리자이고, 운영자는 고객사의 위탁을 받아 운영하는 구조입니다.
// 따라서 수강생에게 제3자 제공 동의를 받지 않고, 처리 사실을 안내하고 확인을 받습니다.

const COMMON_ITEMS =
`  - 성명, 이메일 주소, 비밀번호(암호화하여 저장), 소속 회사
  - 강의별 시청 시간·시청 일시·이수 여부, 퀴즈 응시 기록, 과제 제출문 및 피드백
  - 가입·접속 일시, 이메일 인증 여부`;

const DOMESTIC =
`  - 수강 기록(강의별 시청 시간·시청 일시·이수 여부, 퀴즈 응시 기록, 과제 제출문 및 피드백)과
    이용자 정보(성명, 이메일 주소, 소속 회사)는 ${DATA_REGION}에 저장됩니다.`;

const OVERSEAS =
`  가. Google LLC (미국)
   - 이전되는 항목: 성명, 이메일 주소, 비밀번호(암호화된 형태), 가입·접속 일시, 이메일 인증 여부
     (수강 기록 자체는 위와 같이 국내에 저장되며, 계정 인증과 서버 처리 과정에서 위 항목이 이전됩니다)
   - 이전 국가: 미국
   - 이전 일시 및 방법: 회원 가입·로그인 및 서비스 이용 시점에 정보통신망을 통하여 전송
   - 이용 목적 및 보유 기간: 회원 인증 및 서비스 처리 / 위탁 계약 종료 시까지
   - 연락처: ${CONTACT_EMAIL} (운영자를 통하여 접수)

  나. BunnyWay d.o.o. (bunny.net, 슬로베니아)
   - 이전되는 항목: 강의 영상 재생 요청에 수반되는 접속 정보
   - 이전 국가: 슬로베니아 및 영상 전송을 위한 해외 CDN 거점 국가
   - 이전 일시 및 방법: 강의 영상 재생 시점에 정보통신망을 통하여 전송
   - 이용 목적 및 보유 기간: 강의 영상 저장 및 재생 전송 / 위탁 계약 종료 시까지
   - 연락처: ${CONTACT_EMAIL} (운영자를 통하여 접수)

  ※ 국외 이전을 거부하실 수 있습니다. 거부를 원하시는 경우 ${CONTACT_EMAIL}로 그 뜻을 보내주시면 처리해 드립니다.
    다만 위 업체들은 서비스 운영에 필수적인 기반이므로, 거부하시는 경우 서비스 이용이 제한될 수 있습니다.`;

function buildLegalDocs(companyName){
  const co = companyName || '소속 회사';

  const terms =
`제1조(목적)
이 약관은 ${OPERATOR}(이하 "운영자")가 제공하는 ${SERVICE} 온라인 교육 서비스(이하 "서비스")의 이용 조건과 절차, 운영자와 이용자의 권리·의무를 정함을 목적으로 합니다.

제2조(서비스의 내용)
운영자는 이용자의 소속 회사와 체결한 교육 계약 및 개인정보 처리위탁 계약에 따라 온라인 강의 제공, 수강 기록 관리, 과제 피드백, 수강 현황 보고 등의 서비스를 제공합니다.

제3조(계정)
① 이용자는 소속 회사가 등록한 본인의 이메일 주소로 가입하며, 계정을 타인에게 양도·대여하거나 공유할 수 없습니다.
② 이용자는 비밀번호를 안전하게 관리하여야 하며, 관리 소홀로 인하여 발생한 불이익은 이용자에게 귀속될 수 있습니다.

제4조(이용자의 의무)
이용자는 다음 각 호의 행위를 하여서는 아니 됩니다.
1. 타인의 명의로 가입하거나 타인이 대신 수강하게 하는 행위
2. 강의 영상 및 자료를 무단으로 녹화·복제·배포하는 행위
3. 시청 기록이나 퀴즈 응시 기록을 조작하거나 서비스의 정상적인 운영을 방해하는 행위

제5조(수강 기록)
① 서비스는 강의별 시청 시간과 시청 일시, 이수 여부, 퀴즈 응시 결과, 과제 제출 내역을 자동으로 기록합니다.
② 제1항의 기록은 소속 회사(${co})의 위탁에 따라 처리되며, 소속 회사가 열람·활용할 수 있습니다.

제6조(서비스의 변경 및 중단)
운영자는 운영상 또는 기술상 필요한 경우 서비스의 전부 또는 일부를 변경하거나 일시 중단할 수 있으며, 가능한 경우 사전에 안내합니다.

제7조(문의)
서비스 이용에 관한 문의는 ${CONTACT_EMAIL}로 하시면 됩니다.

제8조(준거법)
이 약관은 대한민국 법령에 따라 해석·적용됩니다.

부칙
이 약관은 ${LEGAL_VERSION}부터 시행합니다.`;

  const notice =
`${co}(이하 "회사")는 ${SERVICE} 운영을 ${OPERATOR}(이하 "운영자")에 위탁하였습니다.
이에 따라 귀하의 개인정보는 회사를 개인정보처리자로 하여 아래와 같이 처리됩니다.

1. 처리 목적
  - 회사가 시행하는 교육 프로그램의 운영, 수강 관리 및 이수 확인
  - 교육 이수 현황의 회사 보고 및 관련 자료 작성

2. 처리 항목
${COMMON_ITEMS}

3. 처리 근거
  - 회사와 귀하 사이의 근로계약 및 회사의 교육 시행에 따른 처리로서, 별도의 동의를 처리 근거로 하지 않습니다.
  - 다만 처리 사실을 충분히 알려드리기 위하여 이 안내문을 제공하며, 내용 확인을 요청드립니다.

4. 수탁자(운영자)의 지위
  - 운영자는 회사의 위탁 범위 안에서만 개인정보를 처리하며, 위탁 목적 외의 용도로 이용하지 않습니다.
  - 운영자가 서비스 운영을 위하여 이용하는 재위탁 업체 및 국외 이전 사항은 아래 제5항과 같습니다.

5. 개인정보의 저장 위치 및 국외 이전
${DOMESTIC}

  아래 업체를 통하여 일부 항목이 국외로 이전됩니다.
${OVERSEAS}

6. 보유 기간
  - ${RETENTION}. 다만 관계 법령에서 보존 기간을 달리 정하는 경우에는 그에 따릅니다.

7. 정보주체의 권리
  - 귀하는 개인정보의 열람, 정정·삭제, 처리정지를 요구하실 수 있습니다.
  - 요구는 회사의 인사 담당자에게 하시거나, ${CONTACT_EMAIL}로 보내주시면 접수하여 회사와 협의해 처리해 드립니다.`;

  const policy =
`${OPERATOR}(이하 "운영자")는 「개인정보 보호법」에 따라 이용자의 개인정보를 보호하고 관련 고충을 원활하게 처리하기 위하여 다음과 같이 개인정보처리방침을 수립·공개합니다.

1. 처리 구조
 이 서비스는 고객사(이용자의 소속 회사)가 개인정보처리자이고, 운영자는 고객사와 체결한 개인정보 처리위탁 계약에 따라 교육 운영 업무를 수행하는 수탁자입니다. 따라서 운영자는 고객사가 정한 목적과 범위 안에서만 개인정보를 처리하며, 이를 제3자에게 제공하지 않습니다.

2. 처리하는 개인정보의 항목
${COMMON_ITEMS}

3. 처리 목적
 고객사가 시행하는 교육의 운영, 본인 확인, 수강 관리, 이수 확인, 과제 피드백 제공, 수강 기록 보고서 작성

4. 처리 및 보유 기간
 ${RETENTION}. 다만 관계 법령에서 보존 기간을 달리 정하는 경우에는 그에 따릅니다.

5. 개인정보의 제3자 제공
 운영자는 개인정보를 제3자에게 제공하지 않습니다. 수강 기록을 고객사가 열람·활용하는 것은 고객사가 개인정보처리자로서 자신의 개인정보를 처리하는 것이므로 제3자 제공에 해당하지 않습니다.

6. 개인정보의 저장 위치 및 국외 이전
${DOMESTIC}

 아래 업체를 통하여 일부 항목이 국외로 이전됩니다.
${OVERSEAS}

7. 회원 탈퇴 및 개인정보의 파기
 이용자는 '내 정보' 화면에서 언제든지 탈퇴할 수 있으며, 탈퇴 시 로그인 계정은 즉시 삭제됩니다. 다만 수강 기록과 확인 기록은 제4항의 보유 기간 동안 접근 권한을 제한하여 보관한 후 파기합니다.
 보유 기간이 경과하거나 처리 목적이 달성된 경우 지체 없이 복구할 수 없는 방법으로 파기합니다.

8. 정보주체의 권리·의무 및 행사 방법
 이용자는 열람, 정정·삭제, 처리정지를 요구할 수 있습니다. 운영자는 수탁자이므로, 요구를 받은 경우 지체 없이 고객사에 알리고 고객사의 지시에 따라 처리합니다. 요구는 ${CONTACT_EMAIL}로 보내주시면 접수됩니다. 다만 법령상 보존 의무가 있는 정보는 삭제가 제한될 수 있습니다.

9. 안전성 확보 조치
 비밀번호 일방향 암호화 저장, 역할별 접근 권한 제한(수강생 본인·고객사 담당자·운영자), 고객사 담당자·운영자의 개인정보 열람·출력 기록 보관, 일정 시간 미사용 시 담당자 화면 자동 로그아웃, 수강·응시 기록의 위·변조 방지 설정, 전송 구간 암호화(HTTPS)

10. 개인정보 보호책임자 및 문의처
 ${PRIVACY_OFFICER}

11. 개인정보처리방침의 변경
 이 개인정보처리방침은 ${LEGAL_VERSION}부터 적용됩니다.`;

  return {
    terms: { title: '이용약관', body: terms },
    privacy: { title: '개인정보 처리 안내', body: notice },
    policy: { title: '개인정보처리방침', body: policy }
  };
}

// 현재 화면에서 쓸 문서 묶음 (회사가 정해지기 전에는 회사명을 일반 표현으로 표시)
let currentLegalCompany = '';
function legalDocs(){ return buildLegalDocs(currentLegalCompany); }

function openLegal(key){
  const d = legalDocs()[key];
  if(!d) return;
  document.getElementById('legal-title').textContent = d.title;
  document.getElementById('legal-body').textContent = d.body;
  document.getElementById('legal-modal').classList.remove('hidden');
}
document.addEventListener('click', (ev) => { const a = ev.target.closest('[data-legal]'); if(a){ ev.preventDefault(); openLegal(a.dataset.legal); } });
document.getElementById('btn-legal-close').onclick = () => document.getElementById('legal-modal').classList.add('hidden');
document.getElementById('legal-modal').onclick = (ev) => { if(ev.target.id === 'legal-modal') ev.currentTarget.classList.add('hidden'); };

function consentItems(){
  return [
    { key: 'terms', label: '[필수] 이용약관 동의' },
    { key: 'privacy', label: '[필수] 개인정보 처리 안내 확인' }
  ];
}
function renderConsentBox(elId){
  const el = document.getElementById(elId);
  if(!el) return;
  el.innerHTML = '<label class="all"><input type="checkbox" data-all> 전체 선택</label>' +
    consentItems().map(i => '<label><input type="checkbox" data-ck="' + i.key + '"> ' + i.label + '<a data-legal="' + i.key + '">보기</a></label>').join('');
  const all = el.querySelector('[data-all]');
  const items = [...el.querySelectorAll('[data-ck]')];
  all.onchange = () => items.forEach(i => { i.checked = all.checked; });
  items.forEach(i => { i.onchange = () => { all.checked = items.every(x => x.checked); }; });
}
function consentAllChecked(elId){ return [...document.querySelectorAll('#' + elId + ' [data-ck]')].every(i => i.checked); }
function consentDocId(uid){ return uid + '_' + LEGAL_VERSION; }
async function saveConsent(uid){
  // consents/{uid}_{버전}: 한 번 쓰면 수정·삭제 불가 (규칙으로 강제)
  await db.collection('consents').doc(consentDocId(uid)).set({
    version: LEGAL_VERSION,
    companyId: currentCompanyId || null, companyName: currentLegalCompany || null,
    terms: true, privacy: true,
    agreedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}
async function hasConsent(uid){
  try{ return (await db.collection('consents').doc(consentDocId(uid)).get()).exists; }
  catch(e){ return false; }
}
// 로그인한 사용자의 소속 회사명을 문서에 반영
async function prepareLegalForUser(userData){
  currentLegalCompany = '';
  try{
    if(userData && userData.companyId){
      const co = await getCompanyDoc(userData.companyId);
      if(co) currentLegalCompany = co.name || '';
    }
  } catch(e){}
  renderConsentBox('gate-consent');
  const t = document.getElementById('consent-screen-desc');
  if(t) t.textContent = (currentLegalCompany || '소속 회사') + '의 위탁에 따라 운영되는 교육입니다. 아래 내용을 확인하신 뒤 계속 진행해 주세요.';
}

const authMsg = document.getElementById('auth-msg');
function showAuthMsg(text){ authMsg.textContent = text || ''; }

const APP_URL = location.origin + location.pathname.replace(/index\.html$/, ''); // 예: https://…/pip/
function inviteLink(code){ return APP_URL + '?code=' + fmtCode(code); }

// 초대 링크(?code=XXXX-XXXX)로 들어오면 회원가입 탭을 열고 코드·이름을 미리 채움
(function initInviteFromUrl(){
  const code = normalizeCode(new URLSearchParams(location.search).get('code'));
  if(!code) return;
  tabSignup.onclick();
  document.getElementById('signup-code').value = fmtCode(code);
  document.getElementById('gate-code').value = fmtCode(code);
  db.collection('invites').doc(code).get().then(snap => {
    const info = document.getElementById('invite-info');
    const inv = snap.exists ? snap.data() : null;
    if(!inv || inv.active !== true){
      showAuthMsg('이미 사용되었거나 취소된 초대 링크입니다. 회사 담당자에게 확인해 주세요.');
      return;
    }
    const roleText = inv.type === 'manager' ? '회사 관리자' : '수강생';
    info.textContent = '[' + (inv.companyName || '') + '] ' + roleText + ' 초대입니다. 이메일과 비밀번호를 정해 가입해 주세요.';
    info.classList.remove('hidden');
    const nameEl = document.getElementById('signup-name');
    if(inv.inviteeName && !nameEl.value) nameEl.value = inv.inviteeName;
    if(inv.inviteeEmail){
      const emailEl = document.getElementById('signup-email');
      emailEl.value = inv.inviteeEmail;
      emailEl.readOnly = true; // 초대받은 이메일로만 가입 가능
      emailEl.style.background = 'var(--paper)';
    }
  }).catch(() => {});
})();

document.getElementById('btn-login').onclick = async () => {
  showAuthMsg('');
  const email = document.getElementById('login-email').value.trim();
  const pw = document.getElementById('login-pw').value;
  if(!email || !pw){ showAuthMsg('이메일과 비밀번호를 입력하세요.'); return; }
  try{ await auth.signInWithEmailAndPassword(email, pw); }
  catch(e){ showAuthMsg('로그인에 실패했습니다: ' + friendlyError(e)); }
};

// 가입은 초대 코드로만 가능. 코드의 종류(수강생/회사 관리자)와 회사가 곧 계정의 역할·소속이 되며,
// 이 대응 관계는 firestore.rules에서 다시 검증하므로 화면을 조작해도 바꿀 수 없음.
let signingUp = false;

document.getElementById('btn-signup').onclick = async () => {
  showAuthMsg('');
  const name = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const pw = document.getElementById('signup-pw').value;
  const code = normalizeCode(document.getElementById('signup-code').value);
  if(!name || !email || !pw){ showAuthMsg('이름, 이메일, 비밀번호를 입력하세요.'); return; }
  if(!strongEnough(pw)){ showAuthMsg('비밀번호는 8자 이상이며 영문과 숫자를 모두 포함해야 합니다.'); return; }
  if(pw.toLowerCase().includes(email.split('@')[0].toLowerCase()) && email.split('@')[0].length >= 4){ showAuthMsg('비밀번호에 이메일 아이디를 넣을 수 없습니다.'); return; }

  // 코드 없음 = 회사 명단에 등록된 수강생: 계정 생성 → 이메일 인증 → 명단과 대조해 회사 연결
  if(!code){
    signingUp = true;
    try{
      const cred = await auth.createUserWithEmailAndPassword(email, pw);
      await cred.user.updateProfile({ displayName: name });
      await sendVerification(cred.user);
      signingUp = false;
      await enterApp(cred.user);
    } catch(e){
      signingUp = false;
      showAuthMsg('가입에 실패했습니다: ' + friendlyError(e));
    }
    return;
  }

  let invite = null;
  try{
    const snap = await db.collection('invites').doc(code).get();
    invite = snap.exists ? snap.data() : null;
  } catch(e){ invite = null; }
  if(!invite || invite.active !== true){
    showAuthMsg('유효하지 않은 초대 코드입니다. 회사 또는 담당 노무사에게 확인해 주세요.');
    return;
  }
  if(invite.inviteeEmail && invite.inviteeEmail !== email.toLowerCase()){
    showAuthMsg('이 초대는 ' + invite.inviteeEmail + ' 주소로만 가입할 수 있습니다.');
    return;
  }
  const role = invite.type === 'manager' ? 'client_hr' : 'trainee';
  if(!confirm('[' + (invite.companyName || '') + '] ' + ROLE_LABELS[role] + ' 계정으로 가입합니다. 계속할까요?')) return;

  signingUp = true;
  let cred = null;
  try{
    cred = await auth.createUserWithEmailAndPassword(email, pw);
    const uid = cred.user.uid;
    const batch = db.batch();
    batch.set(db.collection('users').doc(uid), {
      name, email: cred.user.email, role, companyId: invite.companyId, inviteCode: code,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    if(invite.type === 'manager' || invite.type === 'trainee_single'){
      // 1회용 코드(관리자 코드, 개인별 수강생 링크): 사용 처리와 계정 생성을 한 번에
      batch.update(db.collection('invites').doc(code), {
        usedBy: uid, usedAt: firebase.firestore.FieldValue.serverTimestamp(), active: false
      });
    }
    await batch.commit();
    signingUp = false;
    if(location.search) history.replaceState(null, '', location.pathname); // 주소창의 코드 제거
    await enterApp(cred.user);
  } catch(e){
    signingUp = false;
    // 프로필 저장에 실패하면 반쯤 만들어진 로그인 계정을 지워 같은 이메일로 다시 가입할 수 있게 함
    if(cred && cred.user){ try{ await cred.user.delete(); } catch(_){} }
    showAuthMsg('가입에 실패했습니다: ' + friendlyError(e));
  }
};

document.getElementById('btn-logout').onclick = () => { stopWatchTimer(); auth.signOut(); };

// ================= 과제 관리 (메인 관리자) · 제출문 열람 =================
let curAsgList = [];

async function renderCurAssignments(){
  const wrap = document.getElementById('cur-asg-wrap');
  const listEl = document.getElementById('cur-asg-list');
  if(!curEdit || curEdit.type !== 'track'){ wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');
  if(!curEdit.id){
    listEl.innerHTML = '<p style="font-size:13px;color:var(--muted);margin:4px 0">과정을 먼저 저장하면 과제를 추가할 수 있습니다.</p>';
    return;
  }
  curAsgList = await loadAssignments(curEdit.id);
  listEl.innerHTML = curAsgList.length ? '' : '<p style="font-size:13px;color:var(--muted);margin:4px 0">등록된 과제가 없습니다.</p>';
  curAsgList.forEach(a => {
    const row = document.createElement('div');
    row.className = 'lecture';
    row.innerHTML =
      '<div><div class="title">' + a.week + '주차 · ' + escapeHtml(a.title) + '</div>' +
      '<div class="meta">' + (a.required === false ? '선택 과제' : '필수 과제') +
        (a.visibleToHr === false ? ' · 회사 관리자 비공개' : ' · 회사 관리자 공개') +
        (a.guide ? ' · 안내문 있음' : '') + '</div></div>' +
      '<div class="row" style="gap:6px"><button class="ghost small-btn" data-asg-edit="' + a.id + '">수정</button>' +
      '<button class="ghost small-btn" data-asg-del="' + a.id + '">삭제</button></div>';
    listEl.appendChild(row);
  });
  listEl.onclick = async (ev) => {
    const b = ev.target.closest('button');
    if(!b) return;
    const a = curAsgList.find(x => x.id === (b.dataset.asgEdit || b.dataset.asgDel));
    if(!a) return;
    if(b.dataset.asgEdit){
      document.getElementById('asg-new-week').value = a.week;
      document.getElementById('asg-new-title').value = a.title;
      document.getElementById('asg-new-guide').value = a.guide || '';
      document.getElementById('asg-new-required').checked = a.required !== false;
      document.getElementById('asg-new-hr').checked = a.visibleToHr !== false;
      document.getElementById('btn-asg-add').textContent = '수정 저장';
      document.getElementById('btn-asg-add').dataset.editing = a.id;
      return;
    }
    const subs = await db.collection('submissions').where('aid', '==', a.id).get().catch(() => ({ size: 0 }));
    if(subs.size && !confirm('이미 제출된 과제입니다 (' + subs.size + '건). 삭제하면 수강생 화면에서 사라집니다. 제출 기록 자체는 남습니다. 계속할까요?')) return;
    if(!subs.size && !confirm('이 과제를 삭제할까요?')) return;
    await db.collection('assignments').doc(a.id).delete();
    renderCurAssignments();
  };
}

document.getElementById('btn-asg-add').onclick = async () => {
  const msg = document.getElementById('cur-asg-msg');
  msg.style.color = ''; msg.textContent = '';
  if(!curEdit || !curEdit.id){ msg.textContent = '과정을 먼저 저장하세요.'; return; }
  const week = parseInt(document.getElementById('asg-new-week').value, 10);
  const title = document.getElementById('asg-new-title').value.trim();
  const guide = document.getElementById('asg-new-guide').value.trim();
  if(!(week >= 1)){ msg.textContent = '주차를 확인하세요.'; return; }
  if(!title){ msg.textContent = '과제 제목을 입력하세요.'; return; }
  const btn = document.getElementById('btn-asg-add');
  const editingId = btn.dataset.editing;
  const data = {
    trackId: curEdit.id, week, title, guide,
    required: document.getElementById('asg-new-required').checked,
    visibleToHr: document.getElementById('asg-new-hr').checked,
    updatedAt: TS_NOW()
  };
  try{
    if(editingId) await db.collection('assignments').doc(editingId).update(data);
    else await db.collection('assignments').add({ ...data, createdBy: currentUser.uid, createdAt: TS_NOW() });
    document.getElementById('asg-new-title').value = '';
    document.getElementById('asg-new-guide').value = '';
    btn.textContent = '추가'; delete btn.dataset.editing;
    msg.style.color = 'var(--teal-dark)'; msg.textContent = editingId ? '수정했습니다.' : '과제를 추가했습니다.';
    renderCurAssignments();
  } catch(e){ msg.textContent = '저장 실패: ' + friendlyError(e); }
};

// 제출문 열람 (메인 관리자·회사 관리자 공통, 피드백 작성은 메인 관리자만)
async function openSubmission(sid, asg, traineeName){
  const msg = document.getElementById('sub-msg');
  msg.style.color = ''; msg.textContent = '';
  document.getElementById('sub-title').textContent = asg.title;
  document.getElementById('sub-text').textContent = '';
  document.getElementById('sub-versions').textContent = '';
  document.getElementById('sub-feedback-list').innerHTML = '';
  document.getElementById('sub-feedback-text').value = '';
  document.getElementById('sub-feedback-write').classList.toggle('hidden', currentRole !== 'admin');
  document.getElementById('sub-modal').classList.remove('hidden');
  try{
    const ref = db.collection('submissions').doc(sid);
    const [snap, vs, fs] = await Promise.all([ref.get(), ref.collection('versions').get(), ref.collection('feedback').get()]);
    if(!snap.exists){ document.getElementById('sub-text').textContent = '(제출된 내용이 없습니다)'; return; }
    const d = snap.data();
    document.getElementById('sub-meta').textContent =
      (traineeName || '') + ' · ' + asg.week + '주차 · ' +
      (d.status === 'submitted' ? '제출 ' + kDateTime(tsDate(d.submittedAt)) + ' (' + (d.lastVersion || 1) + '차)' : '임시저장 중 — 아직 제출 전') +
      ' · 마지막 저장 ' + kDateTime(tsDate(d.updatedAt)) + ' · ' + (d.text || '').length + '자';
    document.getElementById('sub-text').textContent = d.text || '';
    const versions = vs.docs.map(x => x.data()).sort((a, b) => a.n - b.n);
    if(versions.length > 1){
      document.getElementById('sub-versions').textContent = '제출 이력: ' +
        versions.map(v => v.n + '차 ' + kDateTime(tsDate(v.at))).join(' · ') + ' (이전 제출본도 보존됩니다)';
    }
    subCtx = { sid, asg };
    const list = fs.docs.map(x => x.data()).sort((a, b) => ((a.at && a.at.seconds) || 0) - ((b.at && b.at.seconds) || 0));
    document.getElementById('sub-feedback-list').innerHTML = list.length
      ? '<p style="font-size:13px;font-weight:600;margin:0 0 6px">피드백</p>' + list.map(f =>
          '<div style="background:var(--teal-bg);border-radius:8px;padding:10px 12px;margin-bottom:6px">' +
          '<div style="font-size:12px;color:var(--muted);margin-bottom:4px">' + escapeHtml(f.byName || '') + ' · ' + kDateTime(tsDate(f.at)) + '</div>' +
          '<div style="white-space:pre-wrap;font-size:13px;line-height:1.7">' + escapeHtml(f.text) + '</div></div>').join('')
      : '';
  } catch(e){ msg.textContent = '불러오기 실패: ' + friendlyError(e); }
}
let subCtx = null;
document.getElementById('btn-sub-close').onclick = () => { document.getElementById('sub-modal').classList.add('hidden'); subCtx = null; };
document.getElementById('btn-sub-feedback').onclick = async () => {
  if(!subCtx) return;
  const msg = document.getElementById('sub-msg');
  msg.style.color = ''; msg.textContent = '';
  const text = document.getElementById('sub-feedback-text').value.trim();
  if(text.length < 2){ msg.textContent = '피드백 내용을 입력하세요.'; return; }
  if(!confirm('피드백을 저장할까요? 저장 후에는 수정하거나 삭제할 수 없습니다.')) return;
  try{
    await db.collection('submissions').doc(subCtx.sid).collection('feedback').add({
      text, by: currentUser.uid, byName: (currentUserData && currentUserData.name) || currentUser.email, at: TS_NOW()
    });
    document.getElementById('sub-feedback-text').value = '';
    openSubmission(subCtx.sid, subCtx.asg, null);
  } catch(e){ msg.textContent = '저장 실패: ' + friendlyError(e); }
};

// ================= 과제 (수강생 작성·제출) =================
// assignments/{aid}: 과정(track)의 주차별 과제. submissions/{uid}_{aid}: 본인 제출문.
// 작성 중인 내용은 브라우저에 즉시, 서버에는 몇 초마다 임시저장되어 실수로 날아가지 않게 합니다.
let asgByTrack = {};           // trackId -> [assignment]
let mySubmissions = {};        // aid -> submission
let asgCtx = null;             // 현재 열려 있는 과제
let asgTimer = null, asgDirty = false, asgSaving = false;
const ASG_AUTOSAVE_MS = 8000;

async function loadAssignments(trackId){
  if(!trackId) return [];
  try{
    const snap = await db.collection('assignments').where('trackId', '==', trackId).get();
    asgByTrack[trackId] = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.week - b.week) || ((a.order || 0) - (b.order || 0)));
  } catch(e){ asgByTrack[trackId] = []; }
  return asgByTrack[trackId];
}
async function loadMySubmissions(uid){
  try{
    const snap = await db.collection('submissions').where('uid', '==', uid).get();
    mySubmissions = {};
    snap.docs.forEach(d => { mySubmissions[d.data().aid] = { id: d.id, ...d.data() }; });
  } catch(e){ mySubmissions = {}; }
  return mySubmissions;
}
function asgLocalKey(uid, aid){ return 'asgdraft_' + uid + '_' + aid; }
function asgStatusLabel(sub, asg, sch){
  const due = sch && sch.paced ? sch.dueAt(asg.week) : null;
  if(!sub) return { text: '미작성', cls: 'warn', due };
  if(sub.status === 'draft') return { text: '임시저장 중', cls: 'warn', due };
  const at = tsDate(sub.submittedAt);
  const late = due && at && at > due;
  return { text: '제출 완료' + (late ? ' (기한 후)' : ''), cls: late ? 'warn' : 'ok', due, at };
}

async function openAssignment(asg, sch){
  const uid = currentUser.uid;
  const sub = mySubmissions[asg.id] || null;
  asgCtx = { asg, sub, sid: uid + '_' + asg.id, uid, sch };
  document.getElementById('asg-title').textContent = asg.title;
  const st = asgStatusLabel(sub, asg, sch);
  document.getElementById('asg-meta').textContent =
    asg.week + '주차 과제' + (st.due ? ' · 제출 기한 ' + kDate(st.due) : '') +
    ' · 상태: ' + st.text + (st.at ? ' (' + kDateTime(st.at) + ')' : '') +
    (asg.required === false ? ' · 선택 과제' : '');
  const guideEl = document.getElementById('asg-guide');
  guideEl.textContent = asg.guide || '별도의 안내문이 등록되지 않은 과제입니다. 주차 강의 내용을 바탕으로 작성해 주세요.';
  guideEl.style.color = asg.guide ? '' : 'var(--muted)';
  const ta = document.getElementById('asg-text');
  ta.value = (sub && sub.text) || '';
  // 브라우저에 남아 있는 작성분이 서버보다 새로우면 복구 제안
  try{
    const raw = localStorage.getItem(asgLocalKey(uid, asg.id));
    if(raw){
      const local = JSON.parse(raw);
      const serverAt = sub && sub.updatedAt ? sub.updatedAt.seconds * 1000 : 0;
      if(local.text && local.text !== ta.value && local.at > serverAt + 2000){
        if(confirm('이 기기에 저장이 안 된 작성분이 남아 있습니다 (' + new Date(local.at).toLocaleString('ko-KR') + ').\n그 내용을 불러올까요?')) ta.value = local.text;
      }
    }
  } catch(e){}
  updateAsgCount();
  document.getElementById('asg-save-state').textContent = sub && sub.updatedAt ? '마지막 저장 ' + kDateTime(tsDate(sub.updatedAt)) : '';
  document.getElementById('asg-msg').textContent = '';
  document.getElementById('btn-asg-submit').textContent = sub && sub.status === 'submitted' ? '수정해서 다시 제출' : '제출하기';
  document.getElementById('asg-modal').classList.remove('hidden');
  renderAsgFeedback();
  if(asgTimer) clearInterval(asgTimer);
  asgTimer = setInterval(() => { if(asgDirty) saveAsgDraft(); }, ASG_AUTOSAVE_MS);
  ta.focus();
}

function updateAsgCount(){
  const n = document.getElementById('asg-text').value.length;
  document.getElementById('asg-count').textContent = n.toLocaleString('ko-KR') + '자';
}

async function renderAsgFeedback(){
  const box = document.getElementById('asg-feedback');
  const list = document.getElementById('asg-feedback-list');
  box.classList.add('hidden');
  if(!asgCtx || !asgCtx.sub) return;
  try{
    const snap = await db.collection('submissions').doc(asgCtx.sid).collection('feedback').get();
    const fs = snap.docs.map(d => d.data()).sort((a, b) => ((a.at && a.at.seconds) || 0) - ((b.at && b.at.seconds) || 0));
    if(!fs.length) return;
    list.innerHTML = fs.map(f =>
      '<div style="background:var(--teal-bg);border-radius:8px;padding:10px 12px;margin-bottom:6px">' +
      '<div style="font-size:12px;color:var(--muted);margin-bottom:4px">' + escapeHtml(f.byName || '') + ' · ' + kDateTime(tsDate(f.at)) + '</div>' +
      '<div style="white-space:pre-wrap;font-size:13px;line-height:1.7">' + escapeHtml(f.text) + '</div></div>').join('');
    box.classList.remove('hidden');
  } catch(e){}
}

document.getElementById('asg-text').oninput = () => {
  asgDirty = true;
  updateAsgCount();
  document.getElementById('asg-save-state').textContent = '작성 중…';
  if(asgCtx){
    // 서버 저장 전이라도 이 기기에는 즉시 보관
    try{ localStorage.setItem(asgLocalKey(asgCtx.uid, asgCtx.asg.id), JSON.stringify({ text: document.getElementById('asg-text').value, at: Date.now() })); } catch(e){}
  }
};

async function saveAsgDraft(silent){
  if(!asgCtx || asgSaving) return false;
  const text = document.getElementById('asg-text').value;
  const sub = asgCtx.sub;
  // 이미 제출한 과제는 임시저장으로 덮어쓰지 않고, 이 기기에만 보관 (다시 제출해야 반영)
  if(sub && sub.status === 'submitted'){
    if(!silent) document.getElementById('asg-save-state').textContent = '이 기기에 임시 보관됨 — 반영하려면 [수정해서 다시 제출]';
    asgDirty = false;
    return true;
  }
  asgSaving = true;
  const state = document.getElementById('asg-save-state');
  state.textContent = '저장 중…';
  try{
    const ref = db.collection('submissions').doc(asgCtx.sid);
    const data = {
      uid: asgCtx.uid, aid: asgCtx.asg.id, trackId: asgCtx.asg.trackId, companyId: currentCompanyId || null,
      text, status: 'draft', updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if(sub) await ref.update({ text, status: 'draft', updatedAt: data.updatedAt });
    else await ref.set(data);
    asgCtx.sub = { ...(sub || {}), ...data, id: asgCtx.sid, status: 'draft' };
    mySubmissions[asgCtx.asg.id] = asgCtx.sub;
    asgDirty = false;
    state.textContent = '임시저장됨 ' + new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    return true;
  } catch(e){
    state.textContent = '';
    document.getElementById('asg-msg').textContent = '임시저장 실패: ' + friendlyError(e) + ' (작성 내용은 이 기기에 남아 있습니다)';
    return false;
  } finally { asgSaving = false; }
}
document.getElementById('btn-asg-draft').onclick = () => saveAsgDraft();

document.getElementById('btn-asg-submit').onclick = async () => {
  if(!asgCtx) return;
  const msg = document.getElementById('asg-msg');
  msg.style.color = ''; msg.textContent = '';
  const text = document.getElementById('asg-text').value.trim();
  if(text.length < 10){ msg.textContent = '내용을 10자 이상 작성해 주세요.'; return; }
  const sub = asgCtx.sub;
  const n = ((sub && sub.lastVersion) || 0) + 1;
  if(!confirm(n > 1 ? '수정한 내용으로 다시 제출할까요? 이전 제출본도 기록에 남습니다.' : '이 내용으로 제출할까요? 제출 후에도 수정해서 다시 낼 수 있습니다.')) return;
  const btn = document.getElementById('btn-asg-submit');
  btn.disabled = true;
  try{
    const TS = firebase.firestore.FieldValue.serverTimestamp();
    const ref = db.collection('submissions').doc(asgCtx.sid);
    const batch = db.batch();
    const data = {
      uid: asgCtx.uid, aid: asgCtx.asg.id, trackId: asgCtx.asg.trackId, companyId: currentCompanyId || null,
      text, status: 'submitted', lastVersion: n, submittedAt: TS, updatedAt: TS
    };
    if(sub) batch.update(ref, { text, status: 'submitted', lastVersion: n, submittedAt: TS, updatedAt: TS });
    else batch.set(ref, data);
    batch.set(ref.collection('versions').doc(String(n)), { text, n, at: TS });
    await batch.commit();
    try{ localStorage.removeItem(asgLocalKey(asgCtx.uid, asgCtx.asg.id)); } catch(e){}
    asgDirty = false;
    msg.style.color = 'var(--teal-dark)';
    msg.textContent = '제출되었습니다. (' + n + '차 제출)';
    asgCtx.sub = { ...(sub || {}), ...data, id: asgCtx.sid };
    mySubmissions[asgCtx.asg.id] = asgCtx.sub;
    document.getElementById('asg-save-state').textContent = '제출 완료';
    btn.textContent = '수정해서 다시 제출';
    loadTraineeView(asgCtx.uid);
  } catch(e){ msg.textContent = '제출 실패: ' + friendlyError(e); }
  finally{ btn.disabled = false; }
};

function closeAsgModal(){
  if(asgTimer){ clearInterval(asgTimer); asgTimer = null; }
  if(asgDirty) saveAsgDraft(true);
  document.getElementById('asg-modal').classList.add('hidden');
  asgCtx = null;
}
document.getElementById('btn-asg-close').onclick = closeAsgModal;
window.addEventListener('beforeunload', () => { if(asgDirty) saveAsgDraft(true); });
document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'hidden' && asgDirty) saveAsgDraft(true); });

// ================= 퀴즈 (수강생 응시) =================
// 정답은 수강생에게 내려보내지 않음. 제출 시 '점수'를 높은 값부터 차례로 주장하며 저장을 시도하고,
// 서버 규칙이 정답과 대조해 맞는 점수일 때만 저장을 허용 → 정답 노출 없이 검증된 점수를 얻음.
// 응시 기록(quizAttempts)은 회차 번호가 붙어 순서대로 쌓이며 수정·삭제 불가, 재응시 간격은 규칙으로 강제.
let quizCtx = null;
function shuffled(n){ const a = [...Array(n).keys()]; for(let i = n - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

async function openQuiz(cid){
  const q = quizMeta[cid];
  if(!q || !q.questions || !q.questions.length) return;
  const course = libraryById[cid] || {};
  let state = null;
  try{ const st = await db.collection('quizState').doc(currentUser.uid + '_' + cid).get(); state = st.exists ? st.data() : null; } catch(e){}
  const passed = !!(traineeProgMap[cid] || {}).quizPassed;
  const ordered = n => [...Array(n).keys()];
  quizCtx = { cid, q, state, passed, orders: q.questions.map(qq => (q.shuffle === true ? shuffled(qq.options.length) : ordered(qq.options.length))) };
  document.getElementById('quiz-title').textContent = '퀴즈 — ' + (course.title || '');
  document.getElementById('quiz-info').textContent = q.questions.length + '문항 · 합격 기준 ' + (q.passPct || 70) + '% · ' +
    ((state && state.count) ? (state.count + 1) + '회차 응시' : '첫 응시') + (passed ? ' · 이미 합격한 퀴즈입니다 (복습용 응시)' : '');
  document.getElementById('quiz-body').innerHTML = q.questions.map((qq, i) =>
    '<div class="qz-q"><p class="qt">' + (i + 1) + '. ' + escapeHtml(qq.q) + '</p>' +
      quizCtx.orders[i].map(oi => '<label><input type="radio" name="qz' + i + '" value="' + oi + '"> <span>' + escapeHtml(qq.options[oi]) + '</span></label>').join('') +
    '</div>').join('');
  document.getElementById('quiz-result').classList.add('hidden');
  document.getElementById('quiz-msg').textContent = '';
  const sb = document.getElementById('btn-quiz-submit');
  sb.classList.remove('hidden'); sb.disabled = false;
  document.getElementById('quiz-modal').classList.remove('hidden');
  quizCooldownCheck();
}

function quizCooldownLeftSec(){
  const st = quizCtx && quizCtx.state;
  if(!st || !st.lastAt) return 0;
  const cool = (quizCtx.q.cooldownMin != null ? quizCtx.q.cooldownMin : 3) * 60;
  return Math.max(0, Math.ceil(st.lastAt.seconds + cool + 2 - Date.now() / 1000));
}
function quizCooldownCheck(){
  const left = quizCooldownLeftSec();
  if(left > 0){
    document.getElementById('quiz-msg').textContent = '재응시는 ' + Math.ceil(left / 60) + '분 뒤에 가능합니다.';
    document.getElementById('btn-quiz-submit').disabled = true;
    return false;
  }
  return true;
}

document.getElementById('btn-quiz-close').onclick = () => { document.getElementById('quiz-modal').classList.add('hidden'); };

document.getElementById('btn-quiz-submit').onclick = async () => {
  const ctx = quizCtx;
  if(!ctx) return;
  const msg = document.getElementById('quiz-msg');
  msg.textContent = '';
  const total = ctx.q.questions.length;
  const answers = [];
  for(let i = 0; i < total; i++){
    const sel = document.querySelector('input[name="qz' + i + '"]:checked');
    if(!sel){ msg.textContent = (i + 1) + '번 문항에 답을 선택하세요.'; return; }
    answers.push(parseInt(sel.value, 10));
  }
  if(!quizCooldownCheck()) return;
  const btn = document.getElementById('btn-quiz-submit');
  btn.disabled = true; btn.textContent = '채점 중…';
  const uid = currentUser.uid;
  const n = ((ctx.state && ctx.state.count) || 0) + 1;
  const attemptId = uid + '_' + ctx.cid + '_' + n;
  const passPct = ctx.q.passPct || 70;
  const TS = firebase.firestore.FieldValue.serverTimestamp();
  let result = null, lastErr = null;
  for(let sc = total; sc >= 0; sc--){
    const passed = sc * 100 >= total * passPct;
    const batch = db.batch();
    batch.set(db.collection('quizAttempts').doc(attemptId), {
      uid, courseId: ctx.cid, companyId: currentCompanyId || null, n, answers, score: sc, total, passed, at: TS
    });
    batch.set(db.collection('quizState').doc(uid + '_' + ctx.cid), { courseId: ctx.cid, lastAt: TS, count: n });
    if(passed && !ctx.passed){
      batch.update(db.collection('progress').doc(uid).collection('lectures').doc(ctx.cid), { quizPassed: true, quizPassedAt: TS, quizAttemptId: attemptId });
    }
    try{ await batch.commit(); result = { score: sc, passed }; break; }
    catch(e){ lastErr = e; if(e.code !== 'permission-denied') break; }
  }
  btn.textContent = '제출하기';
  if(!result){
    btn.disabled = false;
    msg.textContent = '제출하지 못했습니다. 영상을 끝까지 시청했는지, 재응시 간격이 지났는지 확인해 주세요. (' + ((lastErr && lastErr.code) || '') + ')';
    return;
  }
  const box = document.getElementById('quiz-result');
  box.classList.remove('hidden');
  box.style.background = result.passed ? 'var(--teal-bg)' : '#fff4f0';
  const cool = ctx.q.cooldownMin != null ? ctx.q.cooldownMin : 3;
  box.innerHTML = '<b style="font-size:16px">' + total + '문항 중 ' + result.score + '문항 정답 — ' + (result.passed ? '합격' : '불합격') + '</b><br>' +
    (result.passed
      ? (ctx.passed ? '복습 응시가 기록되었습니다.' : '강의가 완료 처리되었습니다.')
      : '합격 기준은 ' + passPct + '%입니다. 강의를 다시 보신 뒤 ' + (cool ? cool + '분 후에 ' : '') + '재응시할 수 있습니다.') +
    '<br><span style="font-size:12px;color:var(--muted)">문항별 정답은 공개되지 않습니다.</span>';
  btn.classList.add('hidden');
  if(result.passed && !ctx.passed) loadTraineeView(uid);
};

// ================= 퀴즈 편집 (메인 관리자) =================
let qeCourseId = null;
async function openQuizEditor(cid){
  qeCourseId = cid;
  document.getElementById('qe-course').textContent = (libraryById[cid] || {}).title || '';
  document.getElementById('qe-msg').textContent = '';
  let quiz = null, key = null;
  try{
    const [qs, ks] = await Promise.all([db.collection('quizzes').doc(cid).get(), db.collection('quizKeys').doc(cid).get()]);
    quiz = qs.exists ? qs.data() : null; key = ks.exists ? ks.data() : null;
  } catch(e){ document.getElementById('qe-msg').textContent = '불러오기 실패: ' + friendlyError(e); }
  document.getElementById('qe-pass').value = quiz && quiz.passPct ? quiz.passPct : 70;
  document.getElementById('qe-cool').value = quiz && quiz.cooldownMin != null ? quiz.cooldownMin : 3;
  document.getElementById('qe-shuffle').checked = !!(quiz && quiz.shuffle === true);
  const list = document.getElementById('qe-list');
  list.innerHTML = '';
  if(quiz && quiz.questions && quiz.questions.length){
    quiz.questions.forEach((qq, i) => addQeQuestion(qq.q, qq.options, key && key.answers ? key.answers[i] : null));
  } else addQeQuestion('', ['', '', '', ''], null);
  document.getElementById('btn-qe-delete').classList.toggle('hidden', !quiz);
  document.getElementById('quiz-edit-modal').classList.remove('hidden');
}
let qeSeq = 0;
function renumberQe(){ document.querySelectorAll('#qe-list .qe-q').forEach((el, i) => { el.querySelector('.qe-no').textContent = (i + 1) + '번 문항'; }); }
function addQeOption(box, text, checked){
  const name = box.dataset.name;
  const row = document.createElement('div');
  row.className = 'qe-opt';
  row.innerHTML = '<input type="radio" name="' + name + '" title="정답"' + (checked ? ' checked' : '') + '><input type="text" placeholder="보기">' +
    '<button class="ghost small-btn" title="보기 삭제">×</button>';
  row.querySelector('input[type=text]').value = text || '';
  row.querySelector('button').onclick = () => { if(box.querySelectorAll('.qe-opt').length > 2) row.remove(); };
  box.appendChild(row);
}
function addQeQuestion(q, options, answer){
  const list = document.getElementById('qe-list');
  if(list.querySelectorAll('.qe-q').length >= 10){ document.getElementById('qe-msg').textContent = '문항은 최대 10개입니다.'; return; }
  const el = document.createElement('div');
  el.className = 'qe-q';
  el.innerHTML = '<div class="row" style="justify-content:space-between;align-items:center"><b class="qe-no" style="font-size:13px"></b>' +
    '<button class="ghost small-btn" data-rm>문항 삭제</button></div>' +
    '<textarea rows="2" placeholder="질문"></textarea><div class="qe-opts" data-name="qe' + (++qeSeq) + '"></div>' +
    '<button class="ghost small-btn" data-addopt style="margin-top:4px">+ 보기 추가</button>';
  el.querySelector('textarea').value = q || '';
  const box = el.querySelector('.qe-opts');
  (options && options.length ? options : ['', '']).forEach((o, i) => addQeOption(box, o, answer === i));
  el.querySelector('[data-addopt]').onclick = () => { if(box.querySelectorAll('.qe-opt').length < 5) addQeOption(box, '', false); };
  el.querySelector('[data-rm]').onclick = () => { el.remove(); renumberQe(); };
  list.appendChild(el);
  renumberQe();
}
document.getElementById('btn-qe-add').onclick = () => addQeQuestion('', ['', '', '', ''], null);
document.getElementById('btn-qe-close').onclick = () => document.getElementById('quiz-edit-modal').classList.add('hidden');
document.getElementById('btn-qe-save').onclick = async () => {
  const msg = document.getElementById('qe-msg');
  msg.style.color = ''; msg.textContent = '';
  const passPct = parseInt(document.getElementById('qe-pass').value, 10);
  const cooldownMin = parseInt(document.getElementById('qe-cool').value, 10);
  if(!(passPct >= 1 && passPct <= 100)){ msg.textContent = '합격 기준은 1~100 사이로 입력하세요.'; return; }
  if(!(cooldownMin >= 0 && cooldownMin <= 1440)){ msg.textContent = '재응시 간격은 0~1440분으로 입력하세요.'; return; }
  const questions = [], answers = [];
  const blocks = [...document.querySelectorAll('#qe-list .qe-q')];
  if(!blocks.length){ msg.textContent = '문항을 1개 이상 넣어 주세요.'; return; }
  for(let i = 0; i < blocks.length; i++){
    const b = blocks[i];
    const q = b.querySelector('textarea').value.trim();
    const opts = [...b.querySelectorAll('.qe-opt')];
    const texts = opts.map(o => o.querySelector('input[type=text]').value.trim());
    const ans = opts.findIndex(o => o.querySelector('input[type=radio]').checked);
    if(!q){ msg.textContent = (i + 1) + '번 문항의 질문을 입력하세요.'; return; }
    if(texts.some(t => !t)){ msg.textContent = (i + 1) + '번 문항에 빈 보기가 있습니다.'; return; }
    if(ans < 0){ msg.textContent = (i + 1) + '번 문항의 정답(동그라미)을 선택하세요.'; return; }
    questions.push({ q, options: texts });
    answers.push(ans);
  }
  const btn = document.getElementById('btn-qe-save');
  btn.disabled = true;
  try{
    const prev = quizMeta[qeCourseId];
    const TS = firebase.firestore.FieldValue.serverTimestamp();
    const batch = db.batch();
    batch.set(db.collection('quizzes').doc(qeCourseId), { questions, passPct, cooldownMin, shuffle: document.getElementById('qe-shuffle').checked, version: ((prev && prev.version) || 0) + 1, updatedAt: TS });
    batch.set(db.collection('quizKeys').doc(qeCourseId), { answers, updatedAt: TS });
    await batch.commit();
    msg.style.color = 'var(--teal-dark)'; msg.textContent = '저장했습니다.';
    document.getElementById('btn-qe-delete').classList.remove('hidden');
    loadAdminView();
  } catch(e){ msg.textContent = '저장 실패: ' + friendlyError(e); }
  finally{ btn.disabled = false; }
};
document.getElementById('btn-qe-delete').onclick = async () => {
  if(!confirm('이 강의의 퀴즈를 삭제할까요? 이후 이 강의는 영상 시청만으로 완료됩니다. (지금까지의 응시 기록은 남습니다)')) return;
  try{
    const batch = db.batch();
    batch.delete(db.collection('quizzes').doc(qeCourseId));
    batch.delete(db.collection('quizKeys').doc(qeCourseId));
    await batch.commit();
    document.getElementById('quiz-edit-modal').classList.add('hidden');
    loadAdminView();
  } catch(e){ document.getElementById('qe-msg').textContent = '삭제 실패: ' + friendlyError(e); }
};

// ================= 내 정보 · 회원 탈퇴 =================
// 탈퇴: 사용자 문서에 탈퇴 상태·일시를 남기고 로그인 계정(Firebase Auth)을 삭제.
// 수강·동의 기록은 증빙 및 보유기간 준수를 위해 남겨 두며, 보유기간 경과 후 파기.
document.getElementById('btn-my-info').onclick = async () => {
  const u = currentUserData || {};
  const coName = u.companyId ? ((await getCompanyDoc(u.companyId)) || {}).name || '-' : '-';
  let consent = '기록 없음';
  try{
    const cs = await db.collection('consents').doc(consentDocId(currentUser.uid)).get();
    if(cs.exists){
      const d = cs.data();
      consent = kDateTime(tsDate(d.agreedAt)) + ' 확인 (문서 버전 ' + escapeHtml(d.version) + ')';
    }
  } catch(e){}
  document.getElementById('my-info-table').innerHTML =
    '<tr><td>이름</td><td>' + escapeHtml(u.name || '-') + '</td></tr>' +
    '<tr><td>이메일</td><td>' + escapeHtml(u.email || currentUser.email) + '</td></tr>' +
    '<tr><td>계정 유형</td><td>' + escapeHtml(ROLE_LABELS[currentRole] || currentRole) + '</td></tr>' +
    '<tr><td>소속 회사</td><td>' + escapeHtml(coName) + '</td></tr>' +
    '<tr><td>가입 일시</td><td>' + kDateTime(tsDate(u.createdAt)) + '</td></tr>' +
    '<tr><td>약관·개인정보 동의</td><td>' + consent + '</td></tr>';
  document.getElementById('withdraw-area').classList.toggle('hidden', currentRole === 'admin'); // 메인 관리자는 콘솔에서 관리
  document.getElementById('withdraw-form').classList.add('hidden');
  document.getElementById('btn-withdraw-open').classList.remove('hidden');
  document.getElementById('withdraw-msg').textContent = '';
  document.getElementById('my-modal').classList.remove('hidden');
};
document.getElementById('btn-my-close').onclick = () => document.getElementById('my-modal').classList.add('hidden');
document.getElementById('btn-withdraw-open').onclick = () => {
  document.getElementById('withdraw-form').classList.remove('hidden');
  document.getElementById('btn-withdraw-open').classList.add('hidden');
};
document.getElementById('btn-withdraw-cancel').onclick = () => {
  document.getElementById('withdraw-form').classList.add('hidden');
  document.getElementById('btn-withdraw-open').classList.remove('hidden');
};
document.getElementById('btn-withdraw').onclick = async () => {
  const msg = document.getElementById('withdraw-msg');
  msg.textContent = '';
  if(!document.getElementById('withdraw-agree').checked){ msg.textContent = '안내 내용을 확인하고 체크해 주세요.'; return; }
  const pw = document.getElementById('withdraw-pw').value;
  if(!pw){ msg.textContent = '비밀번호를 입력하세요.'; return; }
  if(!confirm('정말 탈퇴하시겠습니까? 되돌릴 수 없습니다.')) return;
  const btn = document.getElementById('btn-withdraw');
  btn.disabled = true;
  try{
    const user = auth.currentUser;
    // 본인 확인 (계정 삭제는 최근 로그인이 필요)
    await user.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(user.email, pw));
    stopWatchTimer();
    await db.collection('users').doc(user.uid).update({
      status: 'withdrawn',
      withdrawnAt: firebase.firestore.FieldValue.serverTimestamp(),
      withdrawReason: document.getElementById('withdraw-reason').value.trim().slice(0, 200)
    });
    await user.delete();
    document.getElementById('my-modal').classList.add('hidden');
    showAuthMsg('탈퇴가 완료되었습니다. 이용해 주셔서 감사합니다.');
  } catch(e){
    msg.textContent = '탈퇴 처리 실패: ' + friendlyError(e);
  } finally { btn.disabled = false; }
};

// ---------- 인증 상태에 따른 화면 전환 ----------
const authScreen = document.getElementById('auth-screen');
const appScreen = document.getElementById('app-screen');
const traineeView = document.getElementById('trainee-view');
const adminView = document.getElementById('admin-view');

let currentUser = null;
let currentRole = null;
let currentCompanyId = null;
let companyCache = [];
let courseCache = [];
// 강의 카테고리 (settings/courseCategories에 저장, 최초에는 아래 기본안 사용)
const DEFAULT_CATEGORIES = [
  { name: '오리엔테이션', desc: '프로그램 목적·진행 절차·평가 기준 이해' },
  { name: '자기진단·성과분석', desc: '현재 성과 수준과 부진 원인 점검' },
  { name: '직무·역할 이해', desc: '직무 기대수준, 성과 기준, 조직 내 역할' },
  { name: '목표 설정·실행계획', desc: '개선 목표 수립, 실행계획 작성과 점검' },
  { name: '업무 수행 역량', desc: '업무 프로세스, 문서 작성, 보고' },
  { name: '시간·업무 관리', desc: '우선순위, 일정 관리, 업무 효율' },
  { name: '커뮤니케이션·협업', desc: '보고·소통, 피드백 수용, 협업' },
  { name: '문제해결·의사결정', desc: '문제 분석, 대안 도출, 의사결정' },
  { name: '근무태도·조직규범', desc: '근무 기본자세, 사내 규정, 직업윤리' },
  { name: '자기관리·회복탄력성', desc: '스트레스 관리, 동기부여, 마인드셋' },
  { name: '성장·경력개발', desc: '강점 개발, 중장기 성장 계획' },
  { name: '성과 점검·평가', desc: '중간 점검, 최종 평가, 성찰' }
];
let courseCategories = DEFAULT_CATEGORIES.slice();
const UNCAT = '미분류';
let currentUserData = null;
let traineeCurriculum = [];
let traineeLocked = new Set(); // 아직 공개되지 않은 주차의 강의
let traineeProgMap = {};
let activeLecture = null; // { uid, courseId, title }
let watchTimer = null;
let watchState = null; // { progRef, accumulated, saved, duration, dirty, alreadyDone, pendingComplete, modalShown, flushing }
let watchTickTime = null;
const WATCH_THRESHOLD = 0.95; // 실제 시청 시간이 전체의 95% 이상이어야 완료 처리 (firestore.rules와 같은 값)
const FLUSH_EVERY_SEC = 60;    // 60초 시청마다 서버에 저장 (규칙상 1회 저장당 최대 150초까지만 인정)
const MAX_TICK_SEC = 65;       // 절전/탭 정지 후 복귀 시 시간이 한꺼번에 튀는 것 방지

function extractYouTubeId(url){
  if(!url) return null;
  const patterns = [
    /youtu\.be\/([A-Za-z0-9_-]{6,})/,
    /[?&]v=([A-Za-z0-9_-]{6,})/,
    /embed\/([A-Za-z0-9_-]{6,})/,
    /shorts\/([A-Za-z0-9_-]{6,})/
  ];
  for(const p of patterns){ const m = url.match(p); if(m) return m[1]; }
  return null;
}

function stopWatchTimer(){
  if(watchTimer){ clearInterval(watchTimer); watchTimer = null; }
  flushWatchState();
}

// ---------- 시청 시간 추적 ----------
// 유튜브 IFrame Player API로 실제 재생 상태(재생/일시정지/버퍼링/종료)를 받아,
// '재생 중'인 시간만 누적합니다. API가 막힌 환경에서는 postMessage 방식으로 한 번 더 시도하고,
// 그래도 상태를 못 받으면 시간을 누적하지 않습니다 (일시정지·창만 열어둔 시간이 기록되지 않도록).
let ytPlayer = null;
let ytApiPromise = null;
let bunnyPlayer = null;
let playerjsPromise = null;
function ensurePlayerJs(){
  if(window.playerjs) return Promise.resolve(window.playerjs);
  if(playerjsPromise) return playerjsPromise;
  playerjsPromise = new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = '//assets.mediadelivery.net/playerjs/playerjs-latest.min.js';
    el.onload = () => resolve(window.playerjs);
    el.onerror = () => reject(new Error('Bunny 재생 라이브러리를 불러오지 못했습니다.'));
    document.head.appendChild(el);
  });
  return playerjsPromise;
}
function loadYtApi(){
  if(window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if(ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if(prev) try{ prev(); }catch(e){} resolve(window.YT); };
    const el = document.createElement('script');
    el.src = 'https://www.youtube.com/iframe_api';
    el.onerror = () => reject(new Error('YouTube API 로드 실패'));
    document.head.appendChild(el);
    setTimeout(() => reject(new Error('YouTube API 응답 없음')), 8000);
  });
  return ytApiPromise;
}
let ytFrameEl = null;
let ytPreciseMode = false; // true = 실제 재생 상태를 postMessage로 정확히 받고 있음
let ytLastState = null; // -1 미시작, 0 종료, 1 재생중, 2 일시정지, 3 버퍼링, 5 큐잉
let ytCurrentTime = null; // 영상 내 현재 위치(초) — 이어보기 위치 저장용
let ytMessageListenerAdded = false;

function postYtCommand(func, args){
  if(!ytFrameEl || !ytFrameEl.contentWindow) return;
  ytFrameEl.contentWindow.postMessage(JSON.stringify({ event: 'command', func: func, args: args || [] }), '*');
}

function setupYtMessageListener(){
  if(ytMessageListenerAdded) return;
  ytMessageListenerAdded = true;
  window.addEventListener('message', (e) => {
    if(!e.origin || e.origin.indexOf('youtube.com') === -1) return; // youtube.com / youtube-nocookie.com
    let data;
    try{ data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch(err){ return; }
    if(!data || typeof data !== 'object') return;
    if(window.__ytDebug) console.log('[yt]', data.event, data.info);

    if(!ytPreciseMode){
      ytPreciseMode = true;
      postYtCommand('addEventListener', ['onStateChange']);
    }
    if(data.info && typeof data.info === 'object' && typeof data.info.playerState === 'number'){
      ytLastState = data.info.playerState;
    }
    if(data.info && typeof data.info === 'object' && typeof data.info.currentTime === 'number'){
      ytCurrentTime = data.info.currentTime;
    }
    if(data.event === 'onStateChange' && typeof data.info === 'number'){
      ytLastState = data.info;
    }
  });
}

// 시청 기록 저장. 서버 규칙(firestore.rules)이 ① 1회 저장당 증가폭 90초 이하
// ② 직전 저장 이후 실제 경과 시간 이하 ③ 완료 처리는 누적 95% 이상일 때만 을 검사하므로,
// 규칙에 막히면 서버 값으로 다시 맞춘 뒤 이어서 누적합니다.
function newSessionId(){ return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function flushWatchState(){
  const ws = watchState;
  if(!ws || ws.flushing || (!ws.dirty && !ws.pendingComplete)) return;
  ws.dirty = false;
  ws.flushing = true;
  const secs = Math.floor(ws.accumulated);
  const gained = Math.max(0, secs - Math.floor(ws.saved || 0));
  const TS = firebase.firestore.FieldValue.serverTimestamp();
  const payload = {
    watchedSeconds: secs,
    updatedAt: TS
  };
  // 이번 저장으로 늘어난 시청 시간을 세션 항목에도 같은 쓰기로 기록 (쓰기 횟수 증가 없음)
  // 시각(first/last)은 서버 시각으로만 기록되며, 규칙이 증가분 일치·같은 날짜 여부를 검사함
  const sid = ws.sid;
  const sessionNext = ws.sessionSaved + gained;
  const startingSession = gained > 0 && !ws.sessionStarted;
  if(gained > 0){
    payload.sid = sid;
    payload.sessions = { [sid]: startingSession ? { s: sessionNext, first: TS, last: TS } : { s: sessionNext, last: TS } };
  }
  if(typeof ytCurrentTime === 'number') payload.lastPosition = Math.floor(ytCurrentTime);
  const completing = ws.pendingComplete;
  if(completing){
    payload.watched = true;
    payload.completedAt = firebase.firestore.FieldValue.serverTimestamp();
  }
  ws.progRef.set(payload, { merge: true })
    .then(() => {
      ws.saved = secs;
      if(gained > 0){ ws.sessionSaved = sessionNext; ws.sessionStarted = true; }
      if(completing){ ws.pendingComplete = false; loadTraineeView(ws.uid); }
    })
    .catch(async (e) => {
      console.warn('시청 기록 저장이 거부되어 서버 값으로 다시 맞춥니다:', e.message);
      // 자정을 넘긴 경우 등: 새 세션으로 이어서 기록
      ws.sid = newSessionId(); ws.sessionSaved = 0; ws.sessionStarted = false;
      try{
        const snap = await ws.progRef.get();
        const d = snap.exists ? snap.data() : {};
        ws.accumulated = d.watchedSeconds || 0;
        ws.saved = ws.accumulated;
        ws.alreadyDone = d.watched === true;
      } catch(err){}
      ws.pendingComplete = false;
      updatePlayerStatusText();
    })
    .finally(() => { ws.flushing = false; });
}

function updatePlayerStatusText(){
  if(!watchState) return;
  const statusEl = document.getElementById('player-status');
  const fillEl = document.getElementById('player-progress-fill');
  if(watchState.alreadyDone){
    statusEl.className = 'player-status done';
    statusEl.textContent = '완료된 강의입니다. 다시 봐도 됩니다.';
    if(fillEl) fillEl.style.width = '100%';
    return;
  }
  const dur = watchState.duration;
  if(dur > 0){
    const pct = Math.min(100, Math.round((watchState.accumulated / dur) * 100));
    statusEl.className = 'player-status';
    let state = '';
    if(!ytPreciseMode) state = ' · 재생 상태를 확인하는 중입니다 (이 동안에는 시간이 기록되지 않습니다)';
    else if(ytLastState === 1) state = ' · 재생 중 (기록 중)';
    else if(ytLastState === 2) state = ' · 일시정지 — 시간이 기록되지 않습니다';
    else if(ytLastState === 3) state = ' · 불러오는 중';
    else if(ytLastState === 0) state = ' · 영상이 끝났습니다';
    statusEl.textContent = '시청 시간 ' + pct + '%' + state;
    if(fillEl) fillEl.style.width = pct + '%';
  } else {
    statusEl.textContent = '관리자가 이 강의의 재생 시간을 등록하지 않아 진도를 계산할 수 없습니다.';
    if(fillEl) fillEl.style.width = '0%';
  }
}

function startWatchTimer(){
  if(watchTimer) clearInterval(watchTimer);
  watchTickTime = Date.now();
  watchTimer = setInterval(() => {
    if(!watchState) return;
    const now = Date.now();
    const elapsed = Math.min((now - watchTickTime) / 1000, MAX_TICK_SEC);
    watchTickTime = now;
    // 재생 중(state 1)일 때만 누적 — 일시정지·버퍼링·종료 상태에서는 시간이 흐르지 않음
    if(!ytPreciseMode){ updatePlayerStatusText(); return; }
    if(ytLastState !== 1){ updatePlayerStatusText(); return; }
    if(ytPlayer && ytPlayer.getCurrentTime){ try{ ytCurrentTime = ytPlayer.getCurrentTime(); }catch(e){} }
    watchState.accumulated += elapsed;
    watchState.dirty = true;
    checkThreshold();
    if(watchState.accumulated - (watchState.saved || 0) >= FLUSH_EVERY_SEC) flushWatchState();
  }, 1000);
}

function checkThreshold(){
  if(!watchState) return;
  const dur = watchState.duration;
  if(!watchState.alreadyDone){
    updatePlayerStatusText();
    if(dur > 0 && Math.floor(watchState.accumulated) >= Math.ceil(dur * WATCH_THRESHOLD)){
      watchState.alreadyDone = true;
      watchState.pendingComplete = true; // 누적 시간과 완료 표시를 한 번에 저장
      flushWatchState();
      updatePlayerStatusText();
    }
  }
  // '다음 강의' 안내는 영상이 실제로 끝까지 재생되어 멈췄을 때만 띄움 (YouTube 상태 0 = 종료).
  // 누적 시청 시간이 영상 길이를 넘긴 것만으로는 띄우지 않음 — 95%(WATCH_THRESHOLD)에서
  // 강의는 이미 완료 처리되지만, 안내창은 실제 재생 종료를 기다림.
  if(dur > 0 && !watchState.modalShown && ytLastState === 0){
    watchState.modalShown = true;
    showCompleteModal();
  }
}

function showCompleteModal(){
  stopWatchTimer();
  const cid = activeLecture && activeLecture.courseId;
  const needQuiz = cid && hasQuiz(cid) && !((traineeProgMap[cid] || {}).quizPassed);
  document.getElementById('complete-text').textContent = needQuiz
    ? '영상 시청을 마쳤습니다. 퀴즈에 합격하면 강의가 완료됩니다.'
    : '해당 강의가 완료되었습니다';
  document.getElementById('btn-take-quiz').classList.toggle('hidden', !needQuiz);
  document.getElementById('btn-next-lecture').classList.toggle('hidden', !!needQuiz);
  document.getElementById('complete-modal').classList.remove('hidden');
}

function hideCompleteModal(){
  document.getElementById('complete-modal').classList.add('hidden');
}

function findNextCourse(uid, courseId){
  const idx = traineeCurriculum.findIndex(c => c.id === courseId);
  if(idx === -1 || idx === traineeCurriculum.length - 1) return null;
  return traineeCurriculum[idx + 1];
}

document.getElementById('btn-replay-lecture').onclick = () => {
  hideCompleteModal();
  if(activeLecture) openLecture(traineeCurriculum.find(c => c.id === activeLecture.courseId) || activeLecture, activeLecture.uid, true);
};
document.getElementById('btn-take-quiz').onclick = () => {
  hideCompleteModal();
  if(activeLecture) openQuiz(activeLecture.courseId);
};
document.getElementById('btn-stop-watching').onclick = () => {
  hideCompleteModal();
  document.getElementById('player-area').classList.add('hidden');
};

document.getElementById('btn-next-lecture').onclick = () => {
  hideCompleteModal();
  if(!activeLecture) return;
  const next = findNextCourse(activeLecture.uid, activeLecture.courseId);
  if(next && traineeLocked.has(next.id)){
    alert('다음 강의(' + next.week + '주차)는 아직 공개되지 않았습니다. 공개일에 이어서 수강해 주세요.');
    document.getElementById('player-area').classList.add('hidden');
  }
  else if(next){ openLecture(next, activeLecture.uid, false); }
  else { document.getElementById('player-area').classList.add('hidden'); }
};

async function openLecture(course, uid, isDone){
  const useBunny = !!course.videoId;
  const videoId = useBunny ? course.videoId : extractYouTubeId(course.youtubeUrl);
  const area = document.getElementById('player-area');
  const statusEl = document.getElementById('player-status');
  document.getElementById('player-title').textContent = course.title;
  area.classList.remove('hidden');
  area.scrollIntoView({ behavior: 'smooth', block: 'start' });
  hideCompleteModal();

  stopWatchTimer(); // 이전 강의 재생 정보 저장 후 정리
  activeLecture = { uid, courseId: course.id, title: course.title };

  const container = document.getElementById('yt-player');
  const overlay = document.getElementById('play-overlay');
  container.innerHTML = '';
  overlay.classList.remove('hidden');

  if(!videoId){
    statusEl.textContent = useBunny ? '이 강의는 영상이 아직 준비되지 않았습니다.' : '이 강의는 YouTube 링크가 올바르지 않아 재생할 수 없습니다.';
    overlay.classList.add('hidden');
    return;
  }

  // 기존 시청 기록 불러오기 (누적 시청시간 기준으로 이어서 보기)
  const progRef = db.collection('progress').doc(uid).collection('lectures').doc(course.id);
  const progSnap = await progRef.get();
  const progData = progSnap.exists ? progSnap.data() : {};
  const durSec = course.duration ? course.duration * 60 : 0;
  // 이어보기 위치: 마지막 재생 위치 기준 (누적 시청시간과 영상 위치는 다를 수 있음). 완료 강의는 처음부터.
  let resumeAt = isDone ? 0 : Math.floor(progData.lastPosition != null ? progData.lastPosition : (progData.watchedSeconds || 0));
  if(durSec && resumeAt > durSec - 10) resumeAt = 0;

  watchState = {
    uid, courseId: course.id, progRef,
    accumulated: progData.watchedSeconds || 0,
    saved: progData.watchedSeconds || 0,
    startAccumulated: progData.watchedSeconds || 0, // 이번에 열었을 때의 누적값 (안내창 판단용)
    duration: durSec,
    dirty: false,
    alreadyDone: isDone,
    pendingComplete: false,
    modalShown: false,
    flushing: false,
    sid: newSessionId(),  // 이번 시청 세션 (일자별 수강 기록용)
    sessionSaved: 0,      // 서버에 확정된 이번 세션 시청 초
    sessionStarted: false // 서버에 세션 항목이 만들어졌는지
  };
  statusEl.textContent = '재생 버튼을 누르면 시청 시간이 기록됩니다.';
  document.getElementById('player-progress-fill').style.width =
    (watchState.duration ? Math.min(100, Math.round((watchState.accumulated / watchState.duration) * 100)) : 0) + '%';

  overlay.onclick = async () => {
    overlay.classList.add('hidden');
    const playerId = 'ytp-' + Date.now();
    ytPreciseMode = false;
    ytLastState = null;
    ytCurrentTime = null;
    ytPlayer = null;
    bunnyPlayer = null;
    updatePlayerStatusText();
    startWatchTimer(); // 재생 상태를 받기 시작하면 그때부터 누적됨
    pushPlayerHistoryState();

    if(useBunny){
      // ---------- Bunny Stream 재생 ----------
      // 5분짜리 재생 토큰을 서버 함수에서 받아, 그 토큰이 붙은 주소로만 iframe을 엽니다.
      const iframe = document.createElement('iframe');
      iframe.id = playerId;
      iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen');
      iframe.setAttribute('allowfullscreen', 'true');
      iframe.setAttribute('frameborder', '0');
      iframe.style.position = 'absolute';
      iframe.style.top = '0'; iframe.style.left = '0';
      iframe.style.width = '100%'; iframe.style.height = '100%';
      try{
        const [PlayerJs, authRes] = await Promise.all([
          ensurePlayerJs(),
          fx.httpsCallable('bunnyGetPlaybackAuth')({ videoId })
        ]);
        const { token, expires } = authRes.data;
        iframe.src = 'https://iframe.mediadelivery.net/embed/' + BUNNY_LIBRARY_ID + '/' + videoId +
          '?autoplay=true&token=' + encodeURIComponent(token) + '&expires=' + expires +
          (resumeAt ? '&t=' + resumeAt : '') + '&_=' + Date.now(); // player.js 스펙상 src를 매번 고유하게
        container.appendChild(iframe);
        ytFrameEl = iframe;
        bunnyPlayer = new PlayerJs.Player(iframe);
        bunnyPlayer.on('ready', () => { ytPreciseMode = true; updatePlayerStatusText(); });
        bunnyPlayer.on('play', () => { ytLastState = 1; updatePlayerStatusText(); });
        bunnyPlayer.on('pause', () => { ytLastState = 2; updatePlayerStatusText(); });
        bunnyPlayer.on('timeupdate', (d) => {
          ytLastState = 1; // 재생 중일 때만 오는 이벤트
          if(d && typeof d.seconds === 'number') ytCurrentTime = d.seconds;
        });
        bunnyPlayer.on('ended', () => { ytLastState = 0; checkThreshold(); updatePlayerStatusText(); });
        bunnyPlayer.on('error', () => {
          document.getElementById('player-status').textContent = '영상을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.';
        });
      } catch(e){
        document.getElementById('player-status').textContent = '재생 준비 중 오류가 났습니다: ' + (e && e.message ? e.message : e);
      }
      return;
    }

    // ---------- YouTube 재생 (기존 강의) ----------
    const host = document.createElement('div');
    host.id = playerId;
    host.style.position = 'absolute';
    host.style.top = '0'; host.style.left = '0';
    host.style.width = '100%'; host.style.height = '100%';
    container.appendChild(host);

    try{
      const YT = await loadYtApi();
      ytPlayer = new YT.Player(playerId, {
        videoId: videoId,
        host: 'https://www.youtube-nocookie.com',
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1, autoplay: 1, controls: 1, start: resumeAt || 0 },
        events: {
          onReady: (ev) => {
            ytPreciseMode = true;
            ytFrameEl = ev.target.getIframe ? ev.target.getIframe() : null;
            try{ ev.target.playVideo(); }catch(e){}
            updatePlayerStatusText();
          },
          onStateChange: (ev) => {
            ytLastState = ev.data;
            try{ ytCurrentTime = ev.target.getCurrentTime(); }catch(e){}
            if(ev.data === 0) checkThreshold(); // 영상 종료
            updatePlayerStatusText();
          }
        }
      });
    } catch(e){
      // API가 막힌 환경: 일반 iframe + postMessage로 한 번 더 시도
      console.warn('YouTube API 사용 불가, 대체 방식 시도:', e.message);
      host.remove();
      const origin = encodeURIComponent(window.location.origin);
      const iframe = document.createElement('iframe');
      iframe.id = playerId;
      iframe.src = 'https://www.youtube-nocookie.com/embed/' + videoId +
        '?enablejsapi=1&rel=0&modestbranding=1&playsinline=1&autoplay=1&controls=1&origin=' + origin +
        (resumeAt ? '&start=' + resumeAt : '');
      iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen');
      iframe.setAttribute('allowfullscreen', 'true');
      iframe.setAttribute('frameborder', '0');
      iframe.style.position = 'absolute';
      iframe.style.top = '0'; iframe.style.left = '0';
      iframe.style.width = '100%'; iframe.style.height = '100%';
      container.appendChild(iframe);
      ytFrameEl = iframe;
      setupYtMessageListener();
      let tries = 0;
      const handshakeTimer = setInterval(() => {
        tries++;
        if(ytPreciseMode || tries > 20){
          clearInterval(handshakeTimer);
          if(!ytPreciseMode){
            const st = document.getElementById('player-status');
            st.textContent = '재생 상태를 확인할 수 없어 시청 시간이 기록되지 않습니다. 새로고침하거나 다른 브라우저에서 다시 시도해 주세요.';
          }
          return;
        }
        postYtCommand('addEventListener', ['onStateChange']);
      }, 400);
    }
  };
}

function closePlayerArea(){
  stopWatchTimer();
  if(ytPlayer && ytPlayer.destroy){ try{ ytPlayer.destroy(); }catch(e){} }
  ytPlayer = null;
  bunnyPlayer = null;
  ytPreciseMode = false;
  document.getElementById('player-area').classList.add('hidden');
}

document.getElementById('btn-back-to-list').onclick = () => {
  closePlayerArea();
};

// ---------- 브라우저 뒤로가기 처리: 로그인 후에는 뒤로가기를 눌러도
// 사이트 밖으로 나가지 않고 안에 머물도록 함 (열린 화면이 있으면 그것부터 닫음) ----------
let appHistoryBaseSet = false;
function pushAppBaseState(){
  if(appHistoryBaseSet) return;
  appHistoryBaseSet = true;
  history.pushState({ pipApp: true }, '', location.href);
}
function pushPlayerHistoryState(){
  history.pushState({ pipPlayer: true }, '', location.href);
}
window.addEventListener('popstate', () => {
  if(!appHistoryBaseSet) return; // 로그인 전(로그인 화면)에는 평소처럼 동작
  // 뒤로가기로 히스토리가 한 칸 줄어든 것을 다시 채워, 다음 뒤로가기도 사이트 안에 머물게 함
  history.pushState({ pipApp: true }, '', location.href);

  const area = document.getElementById('player-area');
  if(!area.classList.contains('hidden')){
    closePlayerArea();
    return;
  }
  const detailModal = document.getElementById('trainee-detail-modal');
  if(detailModal && !detailModal.classList.contains('hidden')){
    detailModal.classList.add('hidden');
    return;
  }
  const acView = document.getElementById('admin-company');
  if(acView && !acView.classList.contains('hidden')){
    closeAdminCompany();
    return;
  }
});

// 모바일에서는 beforeunload가 잘 발생하지 않으므로 탭이 가려질 때도 저장
window.addEventListener('beforeunload', () => { flushWatchState(); });
document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'hidden') flushWatchState(); });

auth.onAuthStateChanged(async (user) => {
  if(!user){
    currentUser = null; currentRole = null;
    document.getElementById('verify-screen').classList.add('hidden');
    document.getElementById('consent-screen').classList.add('hidden');
    document.getElementById('app-legal-links').style.display = 'none';
    appHistoryBaseSet = false;
    authScreen.classList.remove('hidden');
    appScreen.classList.add('hidden');
    return;
  }
  if(signingUp) return; // 가입 처리 중에는 프로필 저장이 끝난 뒤 직접 enterApp 호출
  await enterApp(user);
});

// ---------- 이메일 인증 + 명단 대조 ----------
const verifyScreen = document.getElementById('verify-screen');
function setVerifyMsg(t, ok){ const m = document.getElementById('verify-msg'); m.style.color = ok ? 'var(--teal-dark)' : ''; m.textContent = t || ''; }

async function sendVerification(user){
  auth.languageCode = 'ko';
  await user.sendEmailVerification({ url: APP_URL });
}

async function showVerifyScreen(user){
  authScreen.classList.add('hidden');
  appScreen.classList.add('hidden');
  verifyScreen.classList.remove('hidden');
  setVerifyMsg('');
  const textEl = document.getElementById('verify-text');
  const fb = document.getElementById('verify-fallback');
  if(!user.emailVerified){
    // 관리자 승인 요청 상태 확인
    let req = null;
    try{ const rs = await db.collection('joinRequests').doc(user.uid).get(); req = rs.exists ? rs.data() : null; } catch(e){}
    if(req && req.status === 'approved') return claimPending(user);
    document.getElementById('btn-verify-done').classList.remove('hidden');
    document.getElementById('btn-verify-resend').classList.remove('hidden');
    fb.classList.remove('hidden');
    if(req && req.status === 'pending'){
      textEl.innerHTML = '<b>관리자 승인을 기다리고 있습니다.</b><br>' +
        '담당자가 명단과 대조해 승인하면 이 화면에서 <b>[인증 완료했어요]</b>를 누르거나 다시 로그인해 주세요.<br>' +
        '<span style="font-size:12px;color:var(--muted)">그 사이 인증 메일이 도착하면 메일의 링크로 인증하셔도 됩니다.</span>';
      document.getElementById('btn-verify-request').classList.add('hidden');
      return;
    }
    if(req && req.status === 'rejected'){
      textEl.innerHTML = '관리자 승인 요청이 반려되었습니다.<br><span style="font-size:13px;color:var(--muted)">가입하신 이메일 주소가 회사에서 받은 안내 메일의 주소와 같은지 확인하시고, 회사 담당자에게 문의해 주세요.</span>';
      document.getElementById('btn-verify-request').classList.add('hidden');
      return;
    }
    textEl.innerHTML = '<b>' + escapeHtml(user.email) + '</b> 주소로 인증 메일을 보냈습니다.<br>' +
      '메일의 인증 링크를 누른 뒤 이 화면으로 돌아와 <b>[인증 완료했어요]</b>를 눌러 주세요.<br>' +
      '<span style="font-size:12px;color:var(--muted)">보내는 주소: ' + escapeHtml(VERIFY_SENDER) + ' (노무법인 C&amp;L) · 메일이 보이지 않으면 스팸함도 확인해 주세요.</span>';
    document.getElementById('btn-verify-request').classList.remove('hidden');
    return;
  }
  fb.classList.add('hidden');
  await claimPending(user);
}

document.getElementById('btn-verify-request').onclick = async () => {
  const user = auth.currentUser;
  if(!user) return;
  if(!confirm('인증 메일 대신 담당자의 승인으로 가입을 진행할까요?\n담당자가 회사 명단의 이메일과 대조한 뒤 승인합니다.')) return;
  try{
    await db.collection('joinRequests').doc(user.uid).set({
      email: (user.email || '').toLowerCase(), name: user.displayName || '', status: 'pending',
      requestedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await showVerifyScreen(user);
  } catch(e){ setVerifyMsg('요청 실패: ' + friendlyError(e)); }
};

async function claimPending(user){
  const textEl = document.getElementById('verify-text');
  document.getElementById('btn-verify-resend').classList.add('hidden');
  const email = (user.email || '').toLowerCase();
  let p = null;
  try{
    const snap = await db.collection('pending').doc(email).get();
    p = snap.exists ? snap.data() : null;
  } catch(e){
    // 명단이 없는 것이 아니라 조회 권한 오류인 경우 — 원인 파악을 위해 구분해서 표시
    console.warn('명단 조회 오류:', e.code, e.message);
    textEl.innerHTML = '이메일 인증은 완료되었지만 수강 명단을 확인하는 중 오류가 났습니다.<br>' +
      '<span style="font-size:12px;color:var(--muted)">잠시 후 [인증 완료했어요]를 다시 눌러 주세요. 계속되면 담당자에게 아래 오류 코드를 알려 주세요: ' + escapeHtml(e.code || e.message) + '</span>';
    document.getElementById('btn-verify-done').classList.remove('hidden');
    return;
  }
  if(!p || p.active !== true || p.usedBy){
    textEl.innerHTML = (user.emailVerified ? '이메일 인증은 완료되었습니다.' : '관리자 승인은 확인되었습니다.') + '<br>다만 <b>' + escapeHtml(user.email) + '</b> 주소로 등록된 수강 명단이 없습니다.<br>' +
      '<span style="font-size:13px;color:var(--muted)">안내 메일을 받은 주소와 같은지 확인해 주시고, 같다면 회사 담당자에게 등록 여부를 문의해 주세요. 등록이 끝나면 다시 로그인하시면 바로 연결됩니다.</span>';
    document.getElementById('btn-verify-done').classList.add('hidden');
    return;
  }
  try{
    const batch = db.batch();
    batch.set(db.collection('users').doc(user.uid), {
      name: p.inviteeName || user.displayName || user.email,
      email: user.email, role: 'trainee', companyId: p.companyId, inviteEmail: email, rosteredAt: p.createdAt,
      trackId: p.trackId || null,
      joinVia: user.emailVerified ? 'email' : 'approval',
      approvedAt: user.emailVerified ? null : (p.approvedAt || null),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    batch.update(db.collection('pending').doc(email), {
      usedBy: user.uid, usedAt: firebase.firestore.FieldValue.serverTimestamp(), active: false
    });
    await batch.commit();
    verifyScreen.classList.add('hidden');
    await enterApp(user);
  } catch(e){ setVerifyMsg('연결에 실패했습니다: ' + friendlyError(e)); }
}

document.getElementById('btn-verify-done').onclick = async () => {
  setVerifyMsg('');
  const user = auth.currentUser;
  if(!user) return;
  await user.reload();
  if(!auth.currentUser.emailVerified){
    let req = null;
    try{ const rs = await db.collection('joinRequests').doc(user.uid).get(); req = rs.exists ? rs.data() : null; } catch(e){}
    if(req && req.status === 'approved') return claimPending(auth.currentUser);
    setVerifyMsg(req && req.status === 'pending' ? '아직 승인되지 않았습니다. 잠시 후 다시 눌러 주세요.' : '아직 인증이 확인되지 않았습니다. 메일의 링크를 누른 뒤 다시 시도해 주세요.');
    return;
  }
  await auth.currentUser.getIdToken(true); // 인증 완료 상태를 권한 확인에 반영
  await claimPending(auth.currentUser);
};
document.getElementById('btn-verify-resend').onclick = async () => {
  try{ await sendVerification(auth.currentUser); setVerifyMsg('인증 메일을 다시 보냈습니다.', true); }
  catch(e){ setVerifyMsg('발송 실패: ' + friendlyError(e)); }
};
document.getElementById('btn-verify-logout').onclick = () => auth.signOut();

document.getElementById('btn-consent-agree').onclick = async () => {
  const msg = document.getElementById('consent-msg');
  msg.textContent = '';
  if(!consentAllChecked('gate-consent')){ msg.textContent = '확인 항목을 모두 체크해 주세요.'; return; }
  try{
    await saveConsent(auth.currentUser.uid);
    document.getElementById('consent-screen').classList.add('hidden');
    await enterApp(auth.currentUser);
  } catch(e){ msg.textContent = '저장 실패: ' + friendlyError(e); }
};
document.getElementById('btn-consent-logout').onclick = () => auth.signOut();

async function enterApp(user){
  currentUser = user;
  const userDoc = await db.collection('users').doc(user.uid).get();
  if(!userDoc.exists){
    // 명단 등록 수강생의 가입 대기 상태: 이메일 인증 → 명단 대조
    await showVerifyScreen(user);
    return;
  }
  document.getElementById('verify-screen').classList.add('hidden');
  const userData = userDoc.data();
  if(userData.status === 'withdrawn'){
    try{ await user.delete(); } catch(e){}
    await auth.signOut();
    showAuthMsg('탈퇴한 계정입니다. 다시 이용하려면 담당자에게 문의해 주세요.');
    return;
  }
  currentUserData = { id: user.uid, ...userData };
  clearCurriculumCache();
  currentRole = userData.role;
  currentCompanyId = userData.companyId || null;
  if(!ROLE_LABELS[currentRole]){
    showAuthMsg('사용이 중지된 계정 유형입니다. 담당 노무사에게 문의해 주세요.');
    auth.signOut();
    return;
  }
  if(currentRole !== 'admin'){
    await prepareLegalForUser(userData);
    if(!(await hasConsent(user.uid))){
      authScreen.classList.add('hidden');
      appScreen.classList.add('hidden');
      document.getElementById('consent-screen').classList.remove('hidden');
      return;
    }
  }
  document.getElementById('consent-screen').classList.add('hidden');
  document.getElementById('app-legal-links').style.display = '';
  lastActivityAt = Date.now();
  logAccess('login');

  authScreen.classList.add('hidden');
  appScreen.classList.remove('hidden');
  pushAppBaseState();
  const roleLabel = ROLE_LABELS[currentRole];
  document.getElementById('welcome-text').textContent = (userData.name || user.email) + ' · ' + roleLabel;

  traineeView.classList.add('hidden');
  adminView.classList.add('hidden');
  document.getElementById('hr-view').classList.add('hidden');

  if(currentRole === 'trainee'){
    traineeView.classList.remove('hidden');
    if(!currentCompanyId){
      await showCompanySelectGate(user.uid);
    } else {
      document.getElementById('company-select-gate').classList.add('hidden');
      loadTraineeView(user.uid);
    }
  } else if(currentRole === 'client_hr'){
    document.getElementById('hr-view').classList.remove('hidden');
    loadHrView();
  } else if(currentRole === 'admin'){
    adminView.classList.remove('hidden');
    resetCourseForm();
    loadAdminView();
  }
}

// ---------- 강의 목록 로드 (공통) ----------
// 강의 보관함 전체 (주차·순서는 과정(tracks)에서 정함)
let libraryById = {};
async function loadCourses(){
  const snap = await db.collection('courses').get();
  courseCache = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => ((a.createdAt && a.createdAt.seconds) || 0) - ((b.createdAt && b.createdAt.seconds) || 0));
  libraryById = {};
  courseCache.forEach(c => { libraryById[c.id] = c; });
  return courseCache;
}

// ---------- 커리큘럼 해석: 대상자 과정 → 없으면 회사 기본 과정 ----------
// tracks/{id}: { companyId, name, kind, items: [{ courseId, week, order }], createdAt, updatedAt }
let companyDocCache = {}, trackDocCache = {};
function clearCurriculumCache(){ companyDocCache = {}; trackDocCache = {}; }
async function getCompanyDoc(id){
  if(!id) return null;
  if(!(id in companyDocCache)){
    try{ const s = await db.collection('companies').doc(id).get(); companyDocCache[id] = s.exists ? { id: s.id, ...s.data() } : null; }
    catch(e){ companyDocCache[id] = null; }
  }
  return companyDocCache[id];
}
async function getTrackDoc(id){
  if(!id) return null;
  if(!(id in trackDocCache)){
    try{ const s = await db.collection('tracks').doc(id).get(); trackDocCache[id] = s.exists ? { id: s.id, ...s.data() } : null; }
    catch(e){ trackDocCache[id] = null; }
  }
  return trackDocCache[id];
}
function buildCurriculum(track, byId){
  if(!track) return [];
  return (track.items || [])
    .filter(it => byId[it.courseId])
    .map(it => ({ ...byId[it.courseId], week: it.week, order: it.order }))
    .sort((a, b) => (a.week - b.week) || (a.order - b.order));
}
// u: 사용자 문서 데이터(id 포함). 반환: { track, courses, isDefault }
async function curriculumForUser(u, library){
  const byId = {};
  (library || courseCache).forEach(c => { byId[c.id] = c; });
  let track = u.trackId ? await getTrackDoc(u.trackId) : null;
  let isDefault = false;
  if(!track){
    const co = await getCompanyDoc(u.companyId);
    track = co && co.defaultTrackId ? await getTrackDoc(co.defaultTrackId) : null;
    isDefault = !!track;
  }
  return { track, courses: buildCurriculum(track, byId), isDefault };
}
// ---------- 주차별 순차 공개 일정 ----------
// 시작일 우선순위: 대상자 개인 지정(users.startDate) → 과정 시작일(tracks.startDate) → 가입일
// N주차는 시작일 + 7×(N-1)일 00:00(한국 시간)에 열리고, 그 주 마지막 날 23:59까지가 이수 기한
const DAY_MS = 86400000;
function kstMidnight(ymd){ return ymd ? new Date(ymd + 'T00:00:00+09:00') : null; }
function ymdKST(d){ return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }); }
function scheduleFor(u, track){
  const paced = !!track && (track.pacing || 'weekly') === 'weekly';
  const joined = u.createdAt && u.createdAt.seconds != null ? ymdKST(new Date(u.createdAt.seconds * 1000)) : null;
  const ymd = u.startDate || (track && track.startDate) || joined || ymdKST(new Date());
  const source = u.startDate ? '개인 지정' : (track && track.startDate) ? '과정 시작일' : '가입일';
  const start = kstMidnight(ymd);
  return {
    paced, startYmd: ymd, start, source,
    openAt: w => new Date(start.getTime() + (w - 1) * 7 * DAY_MS),
    dueAt: w => new Date(start.getTime() + w * 7 * DAY_MS - 1000),
    isOpen: w => !paced || Date.now() >= start.getTime() + (w - 1) * 7 * DAY_MS
  };
}
// 주차별 현황: progMap = { courseId: 진도 문서 데이터 }
function weekSummary(courses, progMap, sch){
  const now = Date.now();
  const weeks = {};
  courses.forEach(c => {
    const w = weeks[c.week] = weeks[c.week] || { week: c.week, total: 0, done: 0, onTime: 0, late: 0 };
    w.total++;
    const p = progMap[c.id];
    if(lectureDone(c.id, p)){
      w.done++;
      const ca = lectureDoneAt(c.id, p);
      if(!sch.paced || !ca || ca <= sch.dueAt(c.week)) w.onTime++; else w.late++;
    }
  });
  return Object.values(weeks).sort((a, b) => a.week - b.week).map(w => {
    const openAt = sch.openAt(w.week), dueAt = sch.dueAt(w.week);
    const state = !sch.paced ? 'open' : now < openAt.getTime() ? 'locked' : now <= dueAt.getTime() ? 'current' : 'past';
    return { ...w, openAt, dueAt, state, overdue: state === 'past' && w.done < w.total };
  });
}
function mdKST(d){ return d.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', weekday: 'short' }); }
// 관리자·회사 관리자 표용 상태 배지
function paceBadge(weeks, sch, pct){
  if(!sch.paced){
    if(pct >= 100) return '<span class="badge ok">수료</span>';
    return pct < 30 ? '<span class="badge danger">진도 저조</span>' : pct < 60 ? '<span class="badge warn">점검 필요</span>' : '<span class="badge ok">정상</span>';
  }
  if(weeks.length && weeks.every(w => w.done === w.total)) return '<span class="badge ok">수료</span>';
  const overdue = weeks.filter(w => w.overdue);
  if(overdue.length) return '<span class="badge danger">' + overdue.map(w => w.week).join('·') + '주차 지연</span>';
  const cur = weeks.find(w => w.state === 'current');
  if(cur) return '<span class="badge ok">' + cur.week + '주차 진행 중</span>';
  if(weeks.length && weeks[0].state === 'locked') return '<span class="badge">' + mdKST(weeks[0].openAt) + ' 시작</span>';
  return '<span class="badge ok">정상</span>';
}

// ---------- 퀴즈 · 완료 판정 ----------
// quizzes/{courseId}: { questions: [{ q, options[] }], passPct, cooldownMin, version } — 정답은 quizKeys/{courseId}(관리자 전용)
let quizMeta = {};
async function loadQuizMeta(){
  try{
    const snap = await db.collection('quizzes').get();
    quizMeta = {};
    snap.docs.forEach(d => { quizMeta[d.id] = d.data(); });
  } catch(e){ quizMeta = {}; }
  return quizMeta;
}
function hasQuiz(cid){ const q = quizMeta[cid]; return !!(q && q.questions && q.questions.length); }
// 강의 완료 = 영상 시청(95%) + (퀴즈가 있으면) 퀴즈 합격
function lectureDone(cid, p){ return !!(p && p.watched === true && (!hasQuiz(cid) || p.quizPassed === true)); }
function lectureDoneAt(cid, p){
  const t = [p && p.completedAt, hasQuiz(cid) && p && p.quizPassedAt].filter(x => x && x.seconds != null).map(x => x.seconds);
  return t.length ? new Date(Math.max(...t) * 1000) : null;
}

function withdrawnBadge(u){
  return u.status === 'withdrawn' ? ' <span class="badge danger" title="' + escapeHtml(u.withdrawReason || '') + '">탈퇴 ' + (u.withdrawnAt ? kDate(tsDate(u.withdrawnAt)) : '') + '</span>' : '';
}
function trackLabel(cur){ return cur.track ? cur.track.name + (cur.isDefault ? ' (기본)' : '') : '미배정'; }

// ---------- 회사 목록 로드 (공통) ----------
async function loadCompanies(){
  const snap = await db.collection('companies').orderBy('name').get();
  companyCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return companyCache;
}

function companyName(companyId){
  const c = companyCache.find(c => c.id === companyId);
  return c ? c.name : '(미지정)';
}

// ---------- 수강생: 소속 회사 선택 게이트 ----------
async function showCompanySelectGate(uid){
  document.getElementById('company-select-gate').classList.remove('hidden');
}

document.getElementById('btn-confirm-company').onclick = async () => {
  const msgEl = document.getElementById('company-select-msg');
  msgEl.textContent = '';
  const code = normalizeCode(document.getElementById('gate-code').value);
  if(!code){ msgEl.textContent = '초대 코드를 입력하세요.'; return; }
  try{
    const snap = await db.collection('invites').doc(code).get();
    const inv = snap.exists ? snap.data() : null;
    if(!inv || inv.active !== true || inv.type !== 'trainee'){
      msgEl.textContent = '유효하지 않은 수강생 초대 코드입니다.'; return;
    }
    await db.collection('users').doc(currentUser.uid).update({ companyId: inv.companyId, inviteCode: code });
    currentCompanyId = inv.companyId;
    if(currentUserData) currentUserData.companyId = inv.companyId;
    document.getElementById('company-select-gate').classList.add('hidden');
    loadTraineeView(currentUser.uid);
  } catch(e){ msgEl.textContent = '등록 실패: ' + friendlyError(e); }
};

// ---------- 수강생 화면 ----------
async function loadTraineeView(uid){
  const [library] = await Promise.all([loadCourses(), loadQuizMeta()]);
  const cur = await curriculumForUser(currentUserData || { id: uid, companyId: currentCompanyId }, library);
  const courses = cur.courses;
  traineeCurriculum = courses;
  const [assignments] = await Promise.all([loadAssignments(cur.track && cur.track.id), loadMySubmissions(uid)]);
  const progressSnap = await db.collection('progress').doc(uid).collection('lectures').get();
  const doneMap = {}, progMap = {}, watchedMap = {};
  progressSnap.docs.forEach(d => { doneMap[d.id] = lectureDone(d.id, d.data()); watchedMap[d.id] = d.data().watched === true; progMap[d.id] = d.data(); });
  traineeProgMap = progMap;

  const total = courses.length;
  const done = courses.filter(c => doneMap[c.id]).length;
  const pct = total ? Math.round((done/total)*100) : 0;
  document.getElementById('t-progress').textContent = pct + '%';
  document.getElementById('t-done').textContent = done;
  document.getElementById('t-total').textContent = total;

  const sch = scheduleFor(currentUserData || {}, cur.track);
  const weeks = weekSummary(courses, progMap, sch);
  const weekInfo = {};
  weeks.forEach(w => { weekInfo[w.week] = w; });
  traineeLocked = new Set(courses.filter(c => weekInfo[c.week] && weekInfo[c.week].state === 'locked').map(c => c.id));

  const listEl = document.getElementById('t-lecture-list');
  if(!cur.track){
    listEl.innerHTML = '<p style="font-size:14px;color:var(--muted)">아직 배정된 과정이 없습니다. 회사 담당자에게 문의해 주세요.</p>';
  } else {
    const lastW = weeks.length ? weeks[weeks.length - 1] : null;
    const curW = weeks.find(w => w.state === 'current');
    const overdue = weeks.filter(w => w.overdue);
    listEl.innerHTML = '<p style="font-size:13px;color:var(--muted);margin:0 0 4px">수강 과정: <b style="color:var(--ink)">' + escapeHtml(cur.track.name) + '</b>' +
      (sch.paced && lastW ? ' · 기간 ' + mdKST(sch.start) + ' ~ ' + mdKST(lastW.dueAt) + (curW ? ' · 지금은 <b style="color:var(--ink)">' + curW.week + '주차</b>' : '') : '') + '</p>' +
      (overdue.length ? '<p style="font-size:13px;color:#b4531f;margin:4px 0 0">기한이 지났는데 마치지 못한 주차가 있습니다: ' + overdue.map(w => w.week + '주차').join(', ') + '</p>' : '') +
      (sch.paced && weeks.length && weeks[0].state === 'locked' ? '<p style="font-size:13px;color:var(--muted);margin:4px 0 0">과정은 ' + mdKST(weeks[0].openAt) + '에 시작됩니다.</p>' : '');
  }

  const asgByWeek = {};
  assignments.forEach(a => { (asgByWeek[a.week] = asgByWeek[a.week] || []).push(a); });
  const appendAsgRows = (week) => {
    (asgByWeek[week] || []).forEach(a => {
      const sub = mySubmissions[a.id];
      const st = asgStatusLabel(sub, a, sch);
      const locked = sch.paced && weekInfo[week] && weekInfo[week].state === 'locked';
      const row = document.createElement('div');
      row.className = 'lecture';
      if(locked) row.style.opacity = '.55';
      row.innerHTML =
        '<div><div class="title">📝 ' + escapeHtml(a.title) + '</div>' +
        '<div class="meta">과제' + (a.required === false ? ' (선택)' : '') + (st.due ? ' · 기한 ' + mdKST(st.due) : '') +
          ' · <span class="badge ' + st.cls + '">' + st.text + '</span></div></div>' +
        '<div class="row" style="gap:8px">' +
          (locked ? '<button class="ghost" disabled>공개 전</button>'
            : '<button class="' + (sub && sub.status === 'submitted' ? 'ghost' : 'primary') + '" data-asg="' + a.id + '">' +
              (sub && sub.status === 'submitted' ? '보기 · 수정' : sub ? '이어서 작성' : '작성하기') + '</button>') +
        '</div>';
      listEl.appendChild(row);
    });
  };

  let lastWeek = null;
  courses.forEach(c => {
    const wi = weekInfo[c.week];
    if(c.week !== lastWeek){
      if(lastWeek !== null) appendAsgRows(lastWeek); // 이전 주차 과제를 그 주차 끝에 표시
      lastWeek = c.week;
      const wpct = wi.total ? Math.round((wi.done / wi.total) * 100) : 0;
      let when = '';
      if(sch.paced){
        when = wi.state === 'locked' ? '🔒 ' + mdKST(wi.openAt) + ' 공개'
          : mdKST(wi.openAt) + ' ~ ' + mdKST(wi.dueAt) + (wi.state === 'current' ? ' · 이번 주' : wi.overdue ? ' · 기한 지남' : '');
      }
      const wk = document.createElement('div');
      wk.className = 'week-label';
      wk.style.display = 'flex';
      wk.style.justifyContent = 'space-between';
      wk.style.gap = '8px';
      wk.innerHTML = '<span>' + c.week + '주차' + (when ? ' <span style="font-weight:400;font-size:12px' + (wi.overdue ? ';color:#b4531f' : '') + '">' + when + '</span>' : '') + '</span>' +
        '<span>' + wi.done + '/' + wi.total + ' 완료 (' + wpct + '%)</span>';
      listEl.appendChild(wk);
    }
    const isDone = !!doneMap[c.id];
    const locked = traineeLocked.has(c.id);
    const row = document.createElement('div');
    row.className = 'lecture' + (isDone ? ' done' : '');
    if(locked) row.style.opacity = '.55';
    const q = hasQuiz(c.id);
    const pg = progMap[c.id] || {};
    const needQuiz = q && watchedMap[c.id] && !pg.quizPassed;
    let quizMeta2 = '';
    if(q) quizMeta2 = pg.quizPassed ? ' · <span style="color:var(--teal-dark)">퀴즈 합격</span>'
      : watchedMap[c.id] ? ' · <b style="color:#b4531f">퀴즈 응시 필요</b>' : ' · 퀴즈 ' + quizMeta[c.id].questions.length + '문항 (시청 후)';
    row.innerHTML =
      '<div>' +
        '<div class="title">' + escapeHtml(c.title) + '</div>' +
        '<div class="meta">' + (c.duration ? c.duration + '분' : '') + quizMeta2 + '</div>' +
      '</div>' +
      '<div class="row" style="gap:8px">' +
        (locked
          ? '<button class="ghost" disabled>공개 전</button>'
          : (needQuiz ? '<button class="primary" data-quiz="' + c.id + '">퀴즈 풀기</button>' : '') +
            '<button class="' + (isDone || needQuiz ? 'ghost' : 'primary') + '" data-play="' + c.id + '">' + (watchedMap[c.id] ? '다시 보기' : '영상 보기') + '</button>') +
      '</div>';
    listEl.appendChild(row);
  });

  if(lastWeek !== null) appendAsgRows(lastWeek);
  // 강의가 없는 주차의 과제도 빠뜨리지 않음
  Object.keys(asgByWeek).map(Number).sort((a, b) => a - b).forEach(w => {
    if(!courses.some(c => c.week === w)){
      const wk = document.createElement('div');
      wk.className = 'week-label';
      wk.textContent = w + '주차';
      listEl.appendChild(wk);
      appendAsgRows(w);
    }
  });

  listEl.querySelectorAll('button[data-asg]').forEach(btn => {
    btn.onclick = () => {
      const a = assignments.find(x => x.id === btn.getAttribute('data-asg'));
      if(a) openAssignment(a, sch);
    };
  });
  listEl.querySelectorAll('button[data-play]').forEach(btn => {
    btn.onclick = () => {
      const id = btn.getAttribute('data-play');
      const course = courses.find(c => c.id === id);
      if(course) openLecture(course, uid, !!watchedMap[id]);
    };
  });
  listEl.querySelectorAll('button[data-quiz]').forEach(btn => {
    btn.onclick = () => openQuiz(btn.getAttribute('data-quiz'));
  });
}

// ---------- 관리자/강사 화면: 강의 등록 · 수정 ----------
// 강의 영상은 Bunny Stream에 올립니다. 브라우저는 Bunny의 비밀 키를 알지 못하므로,
// 서버 함수(functions/index.js)에서 업로드 1회용 서명을 받아 그 서명으로 Bunny에 직접 올립니다.
let editingCourseId = null;
let pendingVideoId = null;      // 이번에 새로 업로드해서 아직 저장 전인 영상
let existingVideoId = null;     // 수정 중인 강의에 이미 연결된 Bunny 영상 (재업로드 전까지 유지)
let uploading = false;

let tusPromise = null;
function ensureTus(){
  if(window.tus) return Promise.resolve(window.tus);
  if(tusPromise) return tusPromise;
  tusPromise = new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = 'https://cdn.jsdelivr.net/npm/tus-js-client@4/dist/tus.min.js';
    el.onload = () => resolve(window.tus);
    el.onerror = () => reject(new Error('업로드 라이브러리를 불러오지 못했습니다.'));
    document.head.appendChild(el);
  });
  return tusPromise;
}

function setUploadUi(text, pct){
  document.getElementById('c-up-status').textContent = text || '';
  const bar = document.getElementById('c-up-bar');
  if(pct == null){ bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  document.getElementById('c-up-fill').style.width = Math.round(pct) + '%';
}
function refreshVideoStateText(){
  const el = document.getElementById('c-video-state');
  el.textContent = pendingVideoId ? '이번에 새로 업로드한 영상이 저장됩니다.'
    : existingVideoId ? '현재 이 강의에 연결된 영상이 있습니다 (그대로 두려면 파일을 다시 선택하지 않아도 됩니다).'
    : '';
}

document.getElementById('c-file').onchange = async (ev) => {
  const file = ev.target.files[0];
  if(!file) return;
  const msgEl = document.getElementById('course-msg');
  msgEl.textContent = '';
  if(!BUNNY_LIBRARY_ID || BUNNY_LIBRARY_ID.indexOf('여기에') === 0){
    msgEl.textContent = 'Bunny 라이브러리 ID가 아직 설정되지 않았습니다 (index.html 상단 BUNNY_LIBRARY_ID).';
    ev.target.value = '';
    return;
  }
  uploading = true;
  setUploadUi('업로드 준비 중…', 0);
  try{
    const tusLib = await ensureTus();
    const title = document.getElementById('c-title').value.trim() || file.name;
    const auth = await fx.httpsCallable('bunnyCreateUpload')({ title });
    const { videoId, libraryId, expirationTime, signature } = auth.data;
    await new Promise((resolve, reject) => {
      const upload = new tusLib.Upload(file, {
        endpoint: 'https://video.bunnycdn.com/tusupload',
        retryDelays: [0, 1000, 3000, 5000, 10000],
        headers: {
          AuthorizationSignature: signature,
          AuthorizationExpire: String(expirationTime),
          VideoId: videoId,
          LibraryId: String(libraryId)
        },
        metadata: { filetype: file.type, title },
        onError: (err) => reject(err),
        onProgress: (sent, total) => setUploadUi('업로드 중… (' + (Math.round(sent/1024/1024)) + 'MB / ' + Math.round(total/1024/1024) + 'MB)', sent / total * 100),
        onSuccess: () => resolve()
      });
      upload.start();
    });
    pendingVideoId = videoId;
    setUploadUi('업로드 완료 — 처리 중인 영상은 몇 분 뒤 재생 준비가 됩니다.', 100);
    refreshVideoStateText();
  } catch(e){
    setUploadUi('', null);
    msgEl.textContent = '업로드 실패: ' + (e && e.message ? e.message : e);
  } finally {
    uploading = false;
  }
};

function resetCourseForm(){
  editingCourseId = null;
  pendingVideoId = null;
  existingVideoId = null;
  document.getElementById('course-form-title').textContent = '강의 등록';
  document.getElementById('btn-add-course').textContent = '강의 추가';
  document.getElementById('btn-cancel-edit').classList.add('hidden');
  document.getElementById('c-title').value = '';
  document.getElementById('c-url').value = '';
  document.getElementById('c-duration').value = '';
  document.getElementById('c-category').value = '';
  document.getElementById('c-file').value = '';
  setUploadUi('', null);
  refreshVideoStateText();
}

function startEditCourse(course){
  editingCourseId = course.id;
  pendingVideoId = null;
  existingVideoId = course.videoId || null;
  document.getElementById('course-form-title').textContent = '강의 수정';
  document.getElementById('btn-add-course').textContent = '수정 저장';
  document.getElementById('btn-cancel-edit').classList.remove('hidden');
  document.getElementById('c-category').innerHTML = catOptionsHtml(course.category || '');
  document.getElementById('c-title').value = course.title || '';
  document.getElementById('c-url').value = course.youtubeUrl || '';
  document.getElementById('c-duration').value = course.duration || '';
  document.getElementById('c-file').value = '';
  setUploadUi('', null);
  refreshVideoStateText();
  document.getElementById('course-form-title').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

document.getElementById('btn-cancel-edit').onclick = resetCourseForm;

document.getElementById('btn-add-course').onclick = async () => {
  const msgEl = document.getElementById('course-msg');
  msgEl.textContent = '';
  if(uploading){ msgEl.textContent = '영상 업로드가 끝난 뒤 저장해 주세요.'; return; }
  const title = document.getElementById('c-title').value.trim();
  const youtubeUrl = document.getElementById('c-url').value.trim();
  const duration = parseFloat(document.getElementById('c-duration').value) || null;
  const category = document.getElementById('c-category').value.trim();
  const videoId = pendingVideoId || existingVideoId || null;
  if(!title){ msgEl.textContent = '제목은 필수입니다.'; return; }
  if(!category){ msgEl.textContent = '카테고리를 선택하세요.'; return; }
  if(!videoId && (!youtubeUrl || !extractYouTubeId(youtubeUrl))){
    msgEl.textContent = '영상 파일을 업로드하거나, YouTube 주소를 입력하세요.'; return;
  }
  if(!duration){ msgEl.textContent = '재생 시간(분)은 필수입니다 — 이 값을 기준으로 진도를 계산합니다.'; return; }
  const data = { title, duration, category };
  // 둘 중 실제로 쓰는 쪽만 저장 (videoId가 있으면 그쪽을 우선하고 youtubeUrl은 비움)
  if(videoId){ data.videoId = videoId; data.youtubeUrl = null; }
  else { data.youtubeUrl = youtubeUrl; data.videoId = null; }
  try{
    if(editingCourseId){
      await db.collection('courses').doc(editingCourseId).update(data);
    } else {
      await db.collection('courses').add({ ...data, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    }
    resetCourseForm();
    loadAdminView();
  } catch(e){ msgEl.textContent = (editingCourseId ? '수정 실패: ' : '등록 실패: ') + e.message; }
};

// ---------- 강의 보관함 일괄 등록 (표 입력) ----------
const GRID_COLS = ['title', 'url', 'duration', 'category'];
const gridBody = document.getElementById('course-grid');

function gridRows(){ return [...gridBody.querySelectorAll('tr.data')]; }

function addGridRow(values){
  const v = values || {};
  const tr = document.createElement('tr');
  tr.className = 'data';
  tr.innerHTML =
    '<td class="rn"></td>' +
    '<td><input type="text" data-col="title" placeholder="강의 제목"></td>' +
    '<td><input type="text" data-col="url" placeholder="https://youtu.be/…"></td>' +
    '<td><input type="number" step="0.5" min="0.5" data-col="duration" placeholder="40"></td>' +
    '<td><select data-col="category">' + catOptionsHtml('', '(선택)') + '</select></td>' +
    '<td class="del"><button title="이 행 삭제" tabindex="-1">×</button></td>';
  GRID_COLS.forEach(c => { if(v[c] != null) setGridCell(tr, c, v[c]); });
  // 카테고리는 바로 위 행과 같게 시작 (연속 입력 편의)
  if(!values){
    const rows = gridRows();
    if(rows.length) setGridCell(tr, 'category', rows[rows.length - 1].querySelector('[data-col="category"]').value);
  }
  tr.querySelector('.del button').onclick = () => {
    const n = tr.nextElementSibling;
    if(n && n.classList.contains('note-row')) n.remove();
    tr.remove();
    if(!gridRows().length) addGridRow();
    renumberGrid();
  };
  gridBody.appendChild(tr);
  renumberGrid();
  return tr;
}

// 칸에 값 넣기 — 카테고리는 이름(앞 번호 '3.' 등 무시)으로 목록에서 찾고, 없으면 '목록에 없음'으로 표시
function setGridCell(tr, col, val){
  const el = tr.querySelector('[data-col="' + col + '"]');
  if(col !== 'category'){ el.value = val; return; }
  const name = String(val == null ? '' : val).trim().replace(/^\d+\.\s*/, '');
  el.innerHTML = catOptionsHtml(name, '(선택)');
  el.value = name;
}

function renumberGrid(){
  const rows = gridRows();
  rows.forEach((tr, i) => { tr.querySelector('.rn').textContent = i + 1; });
  const filled = rows.filter(tr => !rowIsEmpty(tr)).length;
  document.getElementById('grid-count').textContent = filled ? '입력된 강의 ' + filled + '개' : '';
}

function rowIsEmpty(tr){
  // 카테고리만 골라진 행은 빈 행으로 봄
  return ['title', 'url', 'duration'].every(c => !tr.querySelector('[data-col="' + c + '"]').value.trim());
}

function resetGrid(n){
  gridRows().forEach(tr => tr.remove());
  gridBody.querySelectorAll('tr.note-row').forEach(r => r.remove());
  for(let i = 0; i < (n || 5); i++) addGridRow();
}

// 엑셀에서 복사한 여러 칸 붙여넣기: 커서가 있는 칸부터 오른쪽·아래로 채움
gridBody.addEventListener('paste', (ev) => {
  const input = ev.target.closest('input');
  if(!input) return;
  const text = (ev.clipboardData || window.clipboardData).getData('text');
  if(!/[\t\n]/.test(text.trim())) return; // 한 칸짜리 붙여넣기는 기본 동작
  ev.preventDefault();
  const lines = text.replace(/\r/g, '').replace(/\n+$/, '').split('\n').map(l => l.split('\t'));
  let tr = input.closest('tr');
  const startCol = GRID_COLS.indexOf(input.getAttribute('data-col'));
  lines.forEach((cells, li) => {
    if(li > 0){
      let n = tr.nextElementSibling;
      while(n && !n.classList.contains('data')) n = n.nextElementSibling;
      tr = n || addGridRow({});
    }
    cells.forEach((cell, ci) => {
      const idx = startCol + ci;
      if(idx < GRID_COLS.length) setGridCell(tr, GRID_COLS[idx], cell.trim());
    });
  });
  renumberGrid();
});
gridBody.addEventListener('change', (ev) => { if(ev.target.matches('select')) ev.target.dispatchEvent(new Event('input', { bubbles: true })); });
gridBody.addEventListener('input', (ev) => {
  const tr = ev.target.closest('tr.data');
  if(tr){ tr.classList.remove('bad'); tr.querySelectorAll('.err').forEach(i => i.classList.remove('err'));
    const note = tr.nextElementSibling; if(note && note.classList.contains('note-row')) note.remove(); }
  renumberGrid();
});
// Enter → 아래 칸 (마지막 행이면 새 행)
gridBody.addEventListener('keydown', (ev) => {
  if(ev.key !== 'Enter') return;
  const input = ev.target.closest('input');
  if(!input) return;
  ev.preventDefault();
  const tr = input.closest('tr');
  let next = tr.nextElementSibling;
  while(next && !next.classList.contains('data')) next = next.nextElementSibling;
  if(!next) next = addGridRow();
  next.querySelector('input[data-col="' + input.getAttribute('data-col') + '"]').focus();
});

document.getElementById('btn-grid-add1').onclick = () => addGridRow().querySelector('input[data-col="title"]').focus();
document.getElementById('btn-grid-add5').onclick = () => { for(let i = 0; i < 5; i++) addGridRow(); };
document.getElementById('btn-grid-clear').onclick = () => { if(confirm('표의 내용을 모두 지울까요?')) resetGrid(5); };

function markRow(tr, cols, note){
  tr.classList.add('bad');
  cols.forEach(c => tr.querySelector('[data-col="' + c + '"]').classList.add('err'));
  const old = tr.nextElementSibling;
  if(old && old.classList.contains('note-row')) old.remove();
  const nr = document.createElement('tr');
  nr.className = 'note-row';
  nr.innerHTML = '<td></td><td colspan="5" class="grid-note">' + escapeHtml(note) + '</td>';
  tr.after(nr);
}

document.getElementById('btn-bulk-add').onclick = async () => {
  const bulkMsg = document.getElementById('bulk-msg');
  bulkMsg.style.color = ''; bulkMsg.textContent = '';
  gridBody.querySelectorAll('tr.note-row').forEach(r => r.remove());
  gridRows().forEach(tr => { tr.classList.remove('bad'); tr.querySelectorAll('.err').forEach(i => i.classList.remove('err')); });

  // 같은 영상이 이미 보관함에 있으면 중복 등록 방지
  const existingVid = {};
  (courseCache || []).forEach(c => { const id = extractYouTubeId(c.youtubeUrl || ''); if(id) existingVid[id] = c.title; });
  const seenVid = {};
  const rows = [];
  let bad = 0;
  gridRows().forEach(tr => {
    if(rowIsEmpty(tr)) return;
    const cell = c => tr.querySelector('[data-col="' + c + '"]').value.trim();
    const title = cell('title');
    const youtubeUrl = cell('url');
    const duration = parseFloat(cell('duration'));
    const category = cell('category');
    const vid = extractYouTubeId(youtubeUrl || '');
    const errCols = [], notes = [];
    if(!title){ errCols.push('title'); notes.push('제목 필요'); }
    if(!vid){ errCols.push('url'); notes.push('YouTube 주소를 인식할 수 없음'); }
    else if(existingVid[vid]){ errCols.push('url'); notes.push('같은 영상이 이미 보관함에 있음: ' + existingVid[vid]); }
    else if(seenVid[vid]){ errCols.push('url'); notes.push('표 안에서 같은 영상이 중복됨'); }
    if(vid) seenVid[vid] = true;
    if(!(duration > 0)){ errCols.push('duration'); notes.push('재생 시간(분) 필요'); }
    if(!category){ errCols.push('category'); notes.push('카테고리 선택 필요'); }
    else if(!catNames().includes(category)){ errCols.push('category'); notes.push('"' + category + '"은(는) 카테고리 목록에 없음 — 다른 카테고리를 고르거나 카테고리 관리에서 추가'); }
    if(errCols.length){ bad++; markRow(tr, errCols, notes.join(' · ')); return; }
    rows.push({ title, youtubeUrl, duration, category });
  });

  if(bad){ bulkMsg.textContent = bad + '개 행을 확인해 주세요 (붉게 표시된 칸).'; return; }
  if(!rows.length){ bulkMsg.textContent = '입력된 강의가 없습니다.'; return; }
  if(!confirm(rows.length + '개 강의를 보관함에 등록할까요?')) return;

  const btn = document.getElementById('btn-bulk-add');
  btn.disabled = true;
  try{
    for(let i = 0; i < rows.length; i += 400){
      const batch = db.batch();
      rows.slice(i, i + 400).forEach(r => {
        batch.set(db.collection('courses').doc(), { ...r, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      });
      await batch.commit();
    }
    resetGrid(5);
    bulkMsg.style.color = 'var(--teal-dark)';
    bulkMsg.textContent = rows.length + '개 강의를 보관함에 등록했습니다. 아래 "과정(커리큘럼) 관리"에서 회사별 과정에 넣으세요.';
    loadAdminView();
  } catch(e){ bulkMsg.textContent = '일괄 등록 실패: ' + friendlyError(e); }
  finally{ btn.disabled = false; }
};

// 엑셀 양식: 1행 제목, 2행 입력 안내(불러올 때 자동으로 건너뜀), 3행 예시
document.getElementById('btn-grid-template').onclick = async () => {
  try{
    const XLSX = await ensureXLSX();
    const aoa = [
      ['강의 제목', 'YouTube 링크', '재생 시간(분)', '카테고리'],
      ['[안내] 수강생에게 보이는 강의명', '[안내] 일부 공개 영상 주소', '[안내] 분 단위, 0.5 가능 (예: 40)', '[안내] "카테고리" 시트의 이름 중 하나'],
      ['개선 목표 세우기', 'https://youtu.be/xxxxxxxxxxx', 40, (courseCategories[3] || courseCategories[0] || { name: '' }).name]
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 34 }, { wch: 38 }, { wch: 16 }, { wch: 22 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '강의목록');
    const cs = XLSX.utils.aoa_to_sheet([['카테고리', '설명']].concat(courseCategories.map(c => [c.name, c.desc || ''])));
    cs['!cols'] = [{ wch: 22 }, { wch: 44 }];
    XLSX.utils.book_append_sheet(wb, cs, '카테고리');
    XLSX.writeFile(wb, '강의보관함_일괄등록_양식.xlsx');
  } catch(e){ document.getElementById('bulk-msg').textContent = '양식 만들기 실패: ' + e.message; }
};

document.getElementById('grid-file').onchange = async (ev) => {
  const file = ev.target.files[0];
  const bulkMsg = document.getElementById('bulk-msg');
  bulkMsg.style.color = ''; bulkMsg.textContent = '';
  if(!file) return;
  try{
    const XLSX = await ensureXLSX();
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
    // 재생 시간 칸이 숫자인 행만 강의로 인식 (제목·안내 행 자동 제외)
    const data = aoa.filter(r => String(r[0]).trim() && !String(r[0]).startsWith('[안내]') && parseFloat(r[2]) > 0);
    if(!data.length){ bulkMsg.textContent = '강의 행을 찾지 못했습니다. 열 순서(제목, 링크, 시간, 카테고리)를 확인하세요.'; return; }
    gridRows().forEach(tr => tr.remove());
    data.forEach(r => addGridRow({ title: String(r[0]).trim(), url: String(r[1]).trim(), duration: r[2], category: String(r[3] || '').trim() }));
    bulkMsg.style.color = 'var(--teal-dark)';
    bulkMsg.textContent = file.name + '에서 ' + data.length + '개 강의를 불러왔습니다. 확인 후 [표의 강의를 보관함에 등록]을 누르세요.';
  } catch(e){ bulkMsg.textContent = '파일을 읽지 못했습니다: ' + e.message; }
  ev.target.value = '';
};

resetGrid(5);

// ---------- 회사 관리 ----------
document.getElementById('btn-add-company').onclick = async () => {
  const msgEl = document.getElementById('company-msg');
  const name = document.getElementById('co-name').value.trim();
  const contact = document.getElementById('co-contact').value.trim();
  if(!name){ msgEl.textContent = '회사명을 입력하세요.'; return; }
  try{
    const coRef = db.collection('companies').doc();
    const code = await genUniqueCode();
    const batch = db.batch();
    batch.set(coRef, { name, contact, traineeCode: code, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    batch.set(db.collection('invites').doc(code), {
      companyId: coRef.id, companyName: name, type: 'trainee', active: true,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await batch.commit();
    document.getElementById('co-name').value = '';
    document.getElementById('co-contact').value = '';
    msgEl.textContent = '';
    openAdminCompany(coRef.id, 'info'); // 새 회사 화면(코드 확인)으로 이동
  } catch(e){ msgEl.textContent = '등록 실패: ' + e.message; }
};

function renderCompanyList(companies, users, invites){
  const listEl = document.getElementById('company-list');
  listEl.innerHTML = companies.length ? '' : '<p style="font-size:13px;color:var(--muted);margin:0">등록된 회사가 없습니다.</p>';
  const userById = {};
  users.forEach(u => { userById[u.id] = u; });

  companies.forEach(c => {
    const trainees = users.filter(u => u.companyId === c.id && u.role === 'trainee').length;
    const managers = users.filter(u => u.companyId === c.id && u.role === 'client_hr');
    const mgrInvites = invites
      .filter(i => i.companyId === c.id && i.type === 'manager')
      .sort((a, b) => ((b.createdAt && b.createdAt.seconds) || 0) - ((a.createdAt && a.createdAt.seconds) || 0));

    const invRows = mgrInvites.map(i => {
      let status;
      if(i.usedBy){
        const u = userById[i.usedBy];
        status = '<span class="badge ok">사용됨</span> ' + escapeHtml(u ? (u.name + ' · ' + u.email) : '');
      } else if(i.active){
        status = '<span class="badge warn">미사용</span> ' +
          '<button class="ghost small-btn" data-act="copy" data-code="' + i.id + '">복사</button>' +
          '<button class="ghost small-btn" data-act="revoke" data-code="' + i.id + '">취소</button>';
      } else {
        status = '<span class="badge">취소됨</span>';
      }
      return '<div><span class="code">' + fmtCode(i.id) + '</span>' + status + '</div>';
    }).join('');

    const card = document.createElement('div');
    card.className = 'co-card';
    card.innerHTML =
      '<div class="co-head">' +
        '<div><div style="font-size:15px;font-weight:600">' + escapeHtml(c.name) + '</div>' +
        '<div style="font-size:12px;color:var(--muted);margin-top:2px">' +
          (c.contact ? '담당자: ' + escapeHtml(c.contact) + ' · ' : '') +
          '수강생 ' + trainees + '명 · 회사 관리자 ' + managers.length + '명' +
          (managers.length ? ' (' + managers.map(m => escapeHtml(m.name || m.email)).join(', ') + ')' : '') +
        '</div></div>' +
        '<button class="ghost small-btn" data-act="delete" data-co="' + c.id + '">삭제</button>' +
      '</div>' +
      '<div class="co-line">수강생 초대 코드 ' +
        (c.traineeCode
          ? '<span class="code">' + fmtCode(c.traineeCode) + '</span>' +
            '<button class="ghost small-btn" data-act="copy" data-code="' + c.traineeCode + '">복사</button>' +
            '<button class="ghost small-btn" data-act="regen" data-co="' + c.id + '">재발급</button>'
          : '<button class="primary small-btn" data-act="regen" data-co="' + c.id + '">코드 만들기</button>') +
      '</div>' +
      (function(){
        const list = adminPending.filter(x => x.companyId === c.id && (x.active || x.usedBy));
        if(!list.length) return '';
        const used = list.filter(x => x.usedBy).length;
        return '<div class="co-line" style="color:var(--muted)">수강생 명단 ' + list.length + '명 · 가입 완료 ' + used + '명 · 미가입 ' + (list.length - used) + '명</div>';
      })() +
      '<div class="co-line">회사 관리자 초대 ' +
        '<button class="ghost small-btn" data-act="mgr" data-co="' + c.id + '">관리자 코드 발급 (1회용)</button>' +
      '</div>' +
      (invRows ? '<div class="inv-list">' + invRows + '</div>' : '');
    listEl.appendChild(card);
  });

  listEl.onclick = async (ev) => {
    const btn = ev.target.closest('button[data-act]');
    if(!btn) return;
    const act = btn.getAttribute('data-act');
    const co = companies.find(c => c.id === btn.getAttribute('data-co'));
    const code = btn.getAttribute('data-code');
    const msgEl = document.getElementById('company-msg');
    msgEl.textContent = '';
    const ts = firebase.firestore.FieldValue.serverTimestamp();
    try{
      if(act === 'copy'){
        await navigator.clipboard.writeText(fmtCode(code));
        btn.textContent = '복사됨';
        setTimeout(() => { btn.textContent = '복사'; }, 1200);
        return;
      }
      if(act === 'regen'){
        if(co.traineeCode && !confirm('수강생 초대 코드를 새로 만들까요?\n기존 코드는 더 이상 가입에 쓸 수 없습니다 (이미 가입한 수강생은 영향 없음).')) return;
        const newCode = await genUniqueCode();
        const batch = db.batch();
        if(co.traineeCode) batch.update(db.collection('invites').doc(co.traineeCode), { active: false });
        batch.set(db.collection('invites').doc(newCode), { companyId: co.id, companyName: co.name, type: 'trainee', active: true, createdAt: ts });
        batch.update(db.collection('companies').doc(co.id), { traineeCode: newCode });
        await batch.commit();
      }
      if(act === 'mgr'){
        const newCode = await genUniqueCode();
        await db.collection('invites').doc(newCode).set({ companyId: co.id, companyName: co.name, type: 'manager', active: true, createdAt: ts });
        alert('[' + co.name + '] 회사 관리자 초대 코드: ' + fmtCode(newCode) + '\n\n1회용입니다. 해당 담당자에게만 전달하세요.');
      }
      if(act === 'revoke'){
        if(!confirm(fmtCode(code) + ' 코드를 취소할까요?')) return;
        await db.collection('invites').doc(code).update({ active: false });
      }
      if(act === 'delete'){
        if(!confirm('[' + co.name + '] 회사를 삭제할까요?\n이 회사의 초대 코드는 모두 비활성화되고, 이미 가입한 계정의 회사 지정은 그대로 남습니다.')) return;
        const batch = db.batch();
        invites.filter(i => i.companyId === co.id && i.active).forEach(i => {
          batch.update(db.collection('invites').doc(i.id), { active: false });
        });
        batch.delete(db.collection('companies').doc(co.id));
        await batch.commit();
        adminSelectedCompanyId = null;
      }
      loadAdminView();
    } catch(e){ msgEl.textContent = '처리 실패: ' + friendlyError(e); }
  };
}

// ---------- 계정 관리 (회사별 묶음) ----------
let userTableArgs = null;
const accOpenGroups = new Set();   // 펼쳐 둔 그룹
let accExpandAll = null;            // 모두 펼치기/접기 지시 (null = 그룹별 상태)
const ROLE_ORDER = { admin: 0, client_hr: 1, trainee: 2 };

function renderUserManageTable(users, companies){
  userTableArgs = [users, companies];
  // 회사 필터 옵션 (선택 유지)
  const cf = document.getElementById('user-company-filter');
  const prevCf = cf.value;
  cf.innerHTML = '<option value="">모든 회사</option><option value="__none__">회사 없음 (메인 관리자·미지정)</option>' +
    companies.slice().sort((x, y) => (x.name || '').localeCompare(y.name || '', 'ko'))
      .map(c => '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>').join('');
  cf.value = prevCf;

  const q = (document.getElementById('user-search').value || '').trim().toLowerCase();
  const rf = document.getElementById('user-role-filter').value;
  let list = users.filter(u =>
    (!q || (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q)) &&
    (!rf || u.role === rf) &&
    (!cf.value || (cf.value === '__none__' ? !companies.some(c => c.id === u.companyId) : u.companyId === cf.value)));

  // 그룹: 회사 없음(메인 관리자·미지정) → 회사명 순
  const groups = {};
  list.forEach(u => {
    const key = companies.some(c => c.id === u.companyId) ? u.companyId : '__none__';
    (groups[key] = groups[key] || []).push(u);
  });
  const keys = Object.keys(groups).sort((x, y) =>
    (x === '__none__' ? -1 : y === '__none__' ? 1 : companyName(x).localeCompare(companyName(y), 'ko')));
  // 검색·필터 중이거나 그룹이 하나뿐이면 자동으로 펼침
  const autoOpen = !!(q || rf || cf.value) || keys.length === 1;

  const tbody = document.getElementById('user-manage-table');
  tbody.innerHTML = keys.length ? '' : '<tr><td colspan="5" style="color:var(--muted)">해당하는 계정이 없습니다.</td></tr>';
  keys.forEach(key => {
    const members = groups[key].sort((x, y) => ((ROLE_ORDER[x.role] ?? 9) - (ROLE_ORDER[y.role] ?? 9)) || (x.name || '').localeCompare(y.name || '', 'ko'));
    const open = accExpandAll != null ? accExpandAll : (autoOpen || accOpenGroups.has(key));
    if(open) accOpenGroups.add(key); else accOpenGroups.delete(key);
    const nAdmin = members.filter(u => u.role === 'admin').length;
    const nHr = members.filter(u => u.role === 'client_hr').length;
    const nTr = members.filter(u => u.role === 'trainee').length;
    const head = document.createElement('tr');
    head.className = 'acc-group';
    head.innerHTML = '<td colspan="5">' + (open ? '▾ ' : '▸ ') +
      escapeHtml(key === '__none__' ? '회사 없음 (메인 관리자·미지정)' : companyName(key)) +
      '<span class="cnt">' + [nAdmin ? '메인 관리자 ' + nAdmin : '', nHr ? '회사 관리자 ' + nHr : '', nTr ? '수강생 ' + nTr : ''].filter(Boolean).join(' · ') + '</span>' +
      (key !== '__none__' ? ' <button class="ghost small-btn" data-open-co="' + key + '" style="margin-left:8px;font-weight:400">회사 화면 →</button>' : '') + '</td>';
    head.onclick = (ev) => {
      if(ev.target.closest('button[data-open-co]')) return openAdminCompany(key, 'accounts');
      accExpandAll = null;
      if(accOpenGroups.has(key)) accOpenGroups.delete(key); else accOpenGroups.add(key);
      renderUserManageTable(...userTableArgs);
    };
    tbody.appendChild(head);
    if(open) members.forEach(u => tbody.appendChild(accountRow(u, companies)));
  });
  accExpandAll = null;
}

// 계정 한 줄 (홈 계정 관리·회사 화면 공용)
function accountRow(u, companies){
  const tr = document.createElement('tr');
  let roleOptions = Object.keys(ROLE_LABELS).map(r => '<option value="' + r + '"' + (u.role === r ? ' selected' : '') + '>' + ROLE_LABELS[r] + '</option>').join('');
  if(!ROLE_LABELS[u.role]) roleOptions = '<option value="' + escapeHtml(u.role) + '" selected>' + escapeHtml(u.role) + ' (사용 중지)</option>' + roleOptions;
  const companyOptions = '<option value="">(없음)</option>' + companies.slice()
    .sort((x, y) => (x.name || '').localeCompare(y.name || '', 'ko'))
    .map(c => '<option value="' + c.id + '"' + (u.companyId === c.id ? ' selected' : '') + '>' + escapeHtml(c.name) + '</option>').join('');
  tr.innerHTML =
    '<td>' + escapeHtml(u.name || '-') + (u.id === (currentUser && currentUser.uid) ? ' <span class="badge">나</span>' : '') + withdrawnBadge(u) + '</td>' +
    '<td style="font-size:12px">' + escapeHtml(u.email || '-') + '</td>' +
    '<td><select data-f="role" style="margin:0;font-size:12px;padding:4px">' + roleOptions + '</select></td>' +
    '<td><select data-f="company" style="margin:0;font-size:12px;padding:4px;max-width:180px">' + companyOptions + '</select></td>' +
    '<td><button class="ghost small-btn" data-f="save">저장</button></td>';
  tr.querySelector('button[data-f="save"]').onclick = async (ev) => {
    const btn = ev.currentTarget;
    const newRole = tr.querySelector('select[data-f="role"]').value;
    const newCompanyId = tr.querySelector('select[data-f="company"]').value || null;
    if(newRole === u.role && newCompanyId === (u.companyId || null)){ btn.textContent = '변경 없음'; setTimeout(() => { btn.textContent = '저장'; }, 1000); return; }
    if(u.id === currentUser.uid && newRole !== 'admin'){ alert('본인 계정의 메인 관리자 권한은 여기서 해제할 수 없습니다.'); return; }
    if(newRole === 'admin' && u.role !== 'admin' && !confirm((u.name || u.email) + ' 님에게 메인 관리자 권한(모든 회사·강의 관리)을 줄까요?')) return;
    if(newRole === 'client_hr' && !newCompanyId){ alert('회사 관리자는 소속 회사를 지정해야 합니다.'); return; }
    const upd = { role: newRole, companyId: newCompanyId };
    // 회사가 바뀌면 이전 회사의 과정 배정은 해제 (새 회사의 기본 과정을 따름)
    if(newCompanyId !== (u.companyId || null) && u.trackId) upd.trackId = null;
    try{
      await db.collection('users').doc(u.id).update(upd);
      btn.textContent = '저장됨';
      clearCurriculumCache();
      setTimeout(loadAdminView, 400);
    } catch(e){ alert('저장 실패: ' + friendlyError(e)); }
  };
  return tr;
}

function renderCompanyAccounts(co, users, companies){
  const tbody = document.getElementById('co-account-table');
  const members = users.filter(u => u.companyId === co.id)
    .sort((x, y) => ((ROLE_ORDER[x.role] ?? 9) - (ROLE_ORDER[y.role] ?? 9)) || (x.name || '').localeCompare(y.name || '', 'ko'));
  tbody.innerHTML = members.length ? '' : '<tr><td colspan="5" style="color:var(--muted)">이 회사에 소속된 계정이 없습니다.</td></tr>';
  let lastRole = null;
  members.forEach(u => {
    if(u.role !== lastRole){
      lastRole = u.role;
      const h = document.createElement('tr');
      h.className = 'acc-group';
      h.style.cursor = 'default';
      h.innerHTML = '<td colspan="5">' + escapeHtml(ROLE_LABELS[u.role] || u.role) + '<span class="cnt">' + members.filter(m => m.role === u.role).length + '명</span></td>';
      tbody.appendChild(h);
    }
    tbody.appendChild(accountRow(u, companies));
  });
}

document.getElementById('user-company-filter').onchange = () => { if(userTableArgs) renderUserManageTable(...userTableArgs); };
document.getElementById('user-role-filter').onchange = () => { if(userTableArgs) renderUserManageTable(...userTableArgs); };
document.getElementById('btn-user-expand').onclick = () => { accExpandAll = true; if(userTableArgs) renderUserManageTable(...userTableArgs); };
document.getElementById('btn-user-collapse').onclick = () => { accExpandAll = false; if(userTableArgs) renderUserManageTable(...userTableArgs); };

async function loadAdminView(){
  await Promise.all([loadCategories(), loadQuizMeta()]);
  const [courses, companies, allUsersSnap, invitesSnap, pendingSnap, tracksSnap, templatesSnap] = await Promise.all([
    loadCourses(), loadCompanies(), db.collection('users').get(), db.collection('invites').get(),
    db.collection('pending').get(), db.collection('tracks').get(), db.collection('templates').get()
  ]);
  adminTracks = tracksSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  try{
    const rq = await db.collection('joinRequests').where('status', '==', 'pending').get();
    adminJoinReqs = rq.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch(e){ adminJoinReqs = []; }
  adminTemplates = templatesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  // 이미 읽은 문서로 커리큘럼 캐시를 채워 추가 읽기를 줄임
  clearCurriculumCache();
  companies.forEach(c => { companyDocCache[c.id] = c; });
  adminTracks.forEach(t => { trackDocCache[t.id] = t; });
  const allUsers = allUsersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const invites = invitesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  adminCompanies = companies;
  adminUsers = allUsers;
  adminInvites = invites;
  adminPending = pendingSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  // 홈 ↔ 회사 화면
  const selCo = companies.find(c => c.id === adminSelectedCompanyId) || null;
  if(!selCo) adminSelectedCompanyId = null;
  document.getElementById('admin-home').classList.toggle('hidden', !!selCo);
  document.getElementById('admin-company').classList.toggle('hidden', !selCo);
  renderCompanyTable();
  renderJoinRequests(selCo);
  if(selCo){
    renderCompanyHeader(selCo);
    showAdminCompanyTab(adminCompanyTab);
    renderRoster();
    renderCompanyList([selCo], allUsers, invites);
    renderCompanyAccounts(selCo, allUsers, companies);
  } else {
    showAdminHomeTab(adminHomeTab);
  }
  document.getElementById('course-count').textContent = courses.length;

  refreshCategorySelects();
  renderLibrary();
  renderCategoryManager();

  renderUserManageTable(allUsers, companies);

  const traineeUsers = allUsers.filter(u => u.role === 'trainee');
  if(selCo){
    // 진도 표는 회사 화면에서만 (수강생마다 진도 조회가 발생하므로)
    const tb = document.getElementById('trainee-table');
    tb.innerHTML = '<tr><td colspan="5" style="color:var(--muted)">불러오는 중…</td></tr>';
    renderTraineeTable(traineeUsers, courses, selCo.id).then(() => {
      if(!tb.children.length) tb.innerHTML = '<tr><td colspan="6" style="color:var(--muted)">가입한 수강생이 없습니다. \'명단·초대\' 탭에서 명단을 등록하세요.</td></tr>';
    });
  }
  renderCurriculumManager();
}

async function renderTraineeTable(traineeUsers, library, filterCompanyId){
  const tbody = document.getElementById('trainee-table');
  tbody.innerHTML = '';
  const filtered = filterCompanyId ? traineeUsers.filter(u => u.companyId === filterCompanyId) : traineeUsers;
  for(const u of filtered){
    const cur = await curriculumForUser(u, library);
    const courses = cur.courses;
    const totalCourses = courses.length;
    const progressSnap = await db.collection('progress').doc(u.id).collection('lectures').where('watched', '==', true).get();
    const courseIds = new Set(courses.map(c => c.id)); // 배정 과정에 포함된 강의만 집계
    const doneCount = progressSnap.docs.filter(d => courseIds.has(d.id) && lectureDone(d.id, d.data())).length;
    const pct = totalCourses ? Math.round((doneCount/totalCourses)*100) : 0;
    const progMap = {};
    progressSnap.docs.forEach(d => { progMap[d.id] = d.data(); });
    const sch = scheduleFor(u, cur.track);
    const weeks = weekSummary(courses, progMap, sch);
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    tr.innerHTML =
      '<td>' + escapeHtml(u.name || '-') + withdrawnBadge(u) + '</td>' +
      '<td style="font-size:12px">' + escapeHtml(u.email || '-') + '</td>' +
      '<td>' + trackSelectHtml(u) + '</td>' +
      '<td style="font-size:12px;white-space:nowrap">' + (sch.paced ? sch.startYmd.slice(5).replace('-', '/') + ' <span style="color:var(--muted)">(' + sch.source + ')</span>' : '<span style="color:var(--muted)">전체 공개</span>') +
        ' <button class="ghost small-btn" data-start style="padding:2px 6px">변경</button></td>' +
      '<td>' + pct + '% (' + doneCount + '/' + totalCourses + ')</td>' +
      '<td>' + paceBadge(weeks, sch, pct) + '</td>';
    tr.querySelector('button[data-start]').onclick = async (ev) => {
      ev.stopPropagation();
      const v = prompt((u.name || u.email) + ' 님의 개인 시작일 (예: 2026-10-05)\n비워 두고 확인하면 과정 시작일 또는 가입일 기준으로 돌아갑니다.', u.startDate || '');
      if(v === null) return;
      const val = v.trim();
      if(val && !/^\d{4}-\d{2}-\d{2}$/.test(val)){ alert('YYYY-MM-DD 형식으로 입력하세요.'); return; }
      try{ await db.collection('users').doc(u.id).update({ startDate: val || null }); loadAdminView(); }
      catch(e){ alert('변경 실패: ' + friendlyError(e)); }
    };
    const sel = tr.querySelector('select[data-assign]');
    sel.onclick = (ev) => ev.stopPropagation();
    sel.onchange = async (ev) => {
      ev.stopPropagation();
      const name = sel.options[sel.selectedIndex].text;
      if(!confirm((u.name || u.email) + ' 님의 과정을 "' + name + '"(으)로 바꿀까요?\n진도율이 새 과정 기준으로 다시 계산됩니다 (시청 기록은 그대로 유지).')){ sel.value = u.trackId || ''; return; }
      try{
        await db.collection('users').doc(u.id).update({ trackId: sel.value || null, trackAssignedAt: firebase.firestore.FieldValue.serverTimestamp() });
        clearCurriculumCache();
        loadAdminView();
      } catch(e){ alert('변경 실패: ' + friendlyError(e)); sel.value = u.trackId || ''; }
    };
    tr.onclick = () => showTraineeDetail(u.id, u.name || '-', u.email || '-', courses);
    tbody.appendChild(tr);
  }
}

// ---------- 회사 담당자(HR) 화면 ----------
async function loadHrView(){
  const [courses] = await Promise.all([loadCourses(), loadQuizMeta()]);
  const coSnap = currentCompanyId ? await db.collection('companies').doc(currentCompanyId).get() : null;
  const coName = coSnap && coSnap.exists ? coSnap.data().name : '(회사 정보 없음)';
  document.getElementById('hr-company-name').textContent = coName + ' 관리자 화면';

  const traineesSnap = await db.collection('users').where('role', '==', 'trainee').where('companyId', '==', currentCompanyId).get();
  const tbody = document.getElementById('hr-trainee-table');
  tbody.innerHTML = '';
  let sumPct = 0, doneAll = 0;
  const trainees = traineesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  for(const u of trainees){
    const cur = await curriculumForUser(u, courses);
    const myCourses = cur.courses;
    const totalCourses = myCourses.length;
    const progressSnap = await db.collection('progress').doc(u.id).collection('lectures').where('watched', '==', true).get();
    const courseIds = new Set(myCourses.map(c => c.id)); // 배정 과정에 포함된 강의만 집계
    const doneCount = progressSnap.docs.filter(d => courseIds.has(d.id) && lectureDone(d.id, d.data())).length;
    const pct = totalCourses ? Math.round((doneCount/totalCourses)*100) : 0;
    sumPct += pct;
    if(totalCourses > 0 && doneCount === totalCourses) doneAll++;
    const progMap = {};
    progressSnap.docs.forEach(d => { progMap[d.id] = d.data(); });
    const sch = scheduleFor(u, cur.track);
    const weeks = weekSummary(myCourses, progMap, sch);
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    tr.innerHTML =
      '<td>' + escapeHtml(u.name || '-') + withdrawnBadge(u) + '</td>' +
      '<td>' + escapeHtml(u.email || '-') + '</td>' +
      '<td>' + escapeHtml(trackLabel(cur)) + '</td>' +
      '<td>' + pct + '% (' + doneCount + '/' + totalCourses + ')</td>' +
      '<td>' + paceBadge(weeks, sch, pct) + '</td>';
    tr.onclick = () => showTraineeDetail(u.id, u.name || '-', u.email || '-', myCourses);
    tbody.appendChild(tr);
  }
  document.getElementById('hr-trainee-count').textContent = trainees.length;
  document.getElementById('hr-avg-progress').textContent = (trainees.length ? Math.round(sumPct / trainees.length) : 0) + '%';
  document.getElementById('hr-done-count').textContent = doneAll;
}




async function renderDetailAssignments(uid, name, trackId, sch){
  const box = document.getElementById('detail-asg-list');
  box.innerHTML = '';
  const list = trackId ? await loadAssignments(trackId) : [];
  if(!list.length){ document.getElementById('detail-asg-wrap').classList.add('hidden'); return; }
  document.getElementById('detail-asg-wrap').classList.remove('hidden');
  let subs = {};
  try{
    const snap = await db.collection('submissions').where('uid', '==', uid).get();
    snap.docs.forEach(d => { subs[d.data().aid] = { id: d.id, ...d.data() }; });
  } catch(e){}
  list.forEach(a => {
    const sub = subs[a.id];
    const st = asgStatusLabel(sub, a, sch);
    const readable = currentRole === 'admin' || a.visibleToHr !== false;
    const row = document.createElement('div');
    row.className = 'lecture';
    row.innerHTML =
      '<div><div class="title">' + a.week + '주차 · ' + escapeHtml(a.title) + '</div>' +
      '<div class="meta">' + (st.at ? kDateTime(st.at) + ' 제출' : st.due ? '기한 ' + kDate(st.due) : '') +
        (sub && sub.lastVersion > 1 ? ' · ' + sub.lastVersion + '차' : '') + '</div></div>' +
      '<div class="row" style="gap:8px"><span class="badge ' + st.cls + '">' + st.text + '</span>' +
      (sub && readable ? '<button class="ghost small-btn" data-sub="' + a.id + '">보기</button>' : '') + '</div>';
    box.appendChild(row);
  });
  box.querySelectorAll('button[data-sub]').forEach(btn => {
    btn.onclick = () => {
      const a = list.find(x => x.id === btn.getAttribute('data-sub'));
      if(a) openSubmission(uid + '_' + a.id, a, name);
    };
  });
}

let detailUid = null;
async function showTraineeDetail(uid, name, email, courses){
  detailUid = uid;
  logAccess('view_trainee', uid);
  document.getElementById('btn-detail-report').onclick = () => openTraineeReport(uid);
  document.getElementById('detail-name').textContent = name;
  document.getElementById('detail-email').textContent = email;
  document.getElementById('trainee-detail-modal').classList.remove('hidden');

  const progressSnap = await db.collection('progress').doc(uid).collection('lectures').get();
  const doneMap = {};
  progressSnap.docs.forEach(d => { doneMap[d.id] = lectureDone(d.id, d.data()); });

  const total = courses.length;
  const done = courses.filter(c => doneMap[c.id]).length;
  const pct = total ? Math.round((done/total)*100) : 0;
  document.getElementById('detail-progress').textContent = pct + '%';
  document.getElementById('detail-done').textContent = done;
  document.getElementById('detail-total').textContent = total;

  const weekStats = {};
  courses.forEach(c => {
    if(!weekStats[c.week]) weekStats[c.week] = { total: 0, done: 0 };
    weekStats[c.week].total++;
    if(doneMap[c.id]) weekStats[c.week].done++;
  });

  const listEl = document.getElementById('detail-lecture-list');
  listEl.innerHTML = '';
  let lastWeek = null;
  courses.forEach(c => {
    if(c.week !== lastWeek){
      lastWeek = c.week;
      const ws = weekStats[c.week];
      const wpct = ws.total ? Math.round((ws.done/ws.total)*100) : 0;
      const wk = document.createElement('div');
      wk.className = 'week-label';
      wk.style.display = 'flex';
      wk.style.justifyContent = 'space-between';
      wk.innerHTML = '<span>' + c.week + '주차</span><span>' + ws.done + '/' + ws.total + ' 완료 (' + wpct + '%)</span>';
      listEl.appendChild(wk);
    }
    const isDone = !!doneMap[c.id];
    const row = document.createElement('div');
    row.className = 'lecture' + (isDone ? ' done' : '');
    row.innerHTML =
      '<div><div class="title">' + escapeHtml(c.title) + '</div><div class="meta">' + (c.duration ? c.duration + '분' : '') + '</div></div>' +
      '<span class="badge ' + (isDone ? 'ok' : 'warn') + '">' + (isDone ? '완료' : '미완료') + '</span>';
    listEl.appendChild(row);
  });

  // 과제 제출 현황
  try{
    const uSnap = await db.collection('users').doc(uid).get();
    const u = { id: uid, ...(uSnap.data() || {}) };
    const cur = await curriculumForUser(u, courseCache);
    await renderDetailAssignments(uid, name, cur.track && cur.track.id, scheduleFor(u, cur.track));
  } catch(e){ document.getElementById('detail-asg-wrap').classList.add('hidden'); }
}

// ================= 이수확인서 =================
// 발급 조건: 배정 과정의 모든 강의 완료(시청 95% + 퀴즈 합격) + 필수 과제 제출.
// 미충족 시 발급하지 않고 부족한 항목을 안내합니다. 발급 번호는 연도별 일련번호로 매기고,
// 발급 기록(certificates)은 수정·삭제할 수 없습니다. 같은 과정은 재발급해도 번호가 유지됩니다.
const CERT_ISSUER = '노무법인 C&L';
const CERT_STAMP_DATA_URI = '../assets/seal.png';

function certRequirements(r, week){
  const lectures = week ? r.lectures.filter(l => l.week === week) : r.lectures;
  const asgs = (r.asgRows || []).filter(x => (!week || x.a.week === week) && x.a.required !== false);
  const missLectures = lectures.filter(l => !l.done);
  const missAsg = asgs.filter(x => !x.at);
  return {
    lectures, asgs, missLectures, missAsg,
    ok: lectures.length > 0 && !missLectures.length && !missAsg.length
  };
}

async function nextCertNo(){
  const ref = db.collection('settings').doc('certSeq');
  const year = new Date().getFullYear();
  const seq = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const cur = snap.exists ? snap.data() : { year, seq: 0 };
    const next = (cur.year === year ? (cur.seq || 0) : 0) + 1;
    tx.set(ref, { year, seq: next });
    return next;
  });
  return 'CNL-PIP-' + year + '-' + String(seq).padStart(4, '0');
}

async function issueCertificate(uid, week){
  logAccess('certificate', uid, week ? week + '주차' : '전체 과정');
  const btn = document.getElementById('btn-detail-cert');
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = '확인 중…';
  try{
    const [courses] = await Promise.all([loadCourses(), loadQuizMeta()]);
    const r = await collectTraineeRecord(uid, courses);
    const u = r.user;
    if(!r.cur.track){ alert('배정된 과정이 없어 발급할 수 없습니다.'); return; }
    const req = certRequirements(r, week);
    if(!req.ok){
      const lines = [];
      if(!req.lectures.length) lines.push('· 과정에 강의가 없습니다.');
      req.missLectures.forEach(l => lines.push('· 미완료 강의: ' + l.week + '주차 ' + l.title + (l.hasQuiz && !l.quizPassed && l.pct >= 95 ? ' (퀴즈 미합격)' : '')));
      req.missAsg.forEach(x => lines.push('· 미제출 과제: ' + x.a.week + '주차 ' + x.a.title));
      alert('이수 기준을 충족하지 않아 발급할 수 없습니다.\n\n' + lines.slice(0, 12).join('\n') + (lines.length > 12 ? '\n· 외 ' + (lines.length - 12) + '건' : ''));
      return;
    }
    const type = week ? 'week' : 'completion';
    // 같은 과정·범위로 이미 발급했으면 같은 번호로 재발급
    let cert = null;
    try{
      const snap = await db.collection('certificates')
        .where('companyId', '==', u.companyId || null)
        .where('uid', '==', uid).where('trackId', '==', r.cur.track.id).where('type', '==', type).get();
      cert = snap.docs.map(d => d.data()).filter(c => (c.week || null) === (week || null))[0] || null;
    } catch(e){}
    let reissue = false;
    if(cert){
      if(!confirm('이미 발급된 확인서가 있습니다 (' + cert.no + ', ' + kDate(tsDate(cert.issuedAt)) + ').\n같은 번호로 다시 출력할까요?')) return;
      reissue = true;
    } else {
      if(!confirm((week ? week + '주차 ' : '') + '이수확인서를 발급할까요?\n대상자: ' + (u.name || '') + '\n발급 기록이 남으며 취소할 수 없습니다.')) return;
      const no = await nextCertNo();
      cert = {
        no, uid, name: u.name || '', companyId: u.companyId || null, companyName: await companyNameById(u.companyId),
        trackId: r.cur.track.id, trackName: r.cur.track.name, type, week: week || null,
        lectureCount: req.lectures.length, assignmentCount: req.asgs.length,
        totalSec: Math.round(r.totalSec),
        issuedBy: currentUser.uid, issuedByName: (currentUserData && currentUserData.name) || currentUser.email,
        issuedAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      await db.collection('certificates').add(cert);
      cert.issuedAt = { seconds: Math.floor(Date.now() / 1000) };
    }
    printCertificate(cert, r, req, reissue);
  } catch(e){ alert('발급 실패: ' + friendlyError(e)); }
  finally{ btn.disabled = false; btn.textContent = label; }
}

function printCertificate(cert, r, req, reissue){
  const now = new Date();
  const sch = r.sch;
  const lastW = r.weeks.length ? r.weeks[r.weeks.length - 1] : null;
  const period = sch.paced && lastW ? kDate(sch.start) + ' ~ ' + kDate(lastW.dueAt) : '-';
  const quizDone = r.lectures.filter(l => l.hasQuiz && l.quizPassed).length;
  const quizTotal = r.lectures.filter(l => l.hasQuiz).length;
  const html =
    '<div style="text-align:center;margin:10px 0 26px">' +
      '<p style="font-size:13px;color:#6b6f68;margin:0">발급번호 ' + escapeHtml(cert.no) + (reissue ? ' (재발급)' : '') + '</p>' +
      '<h1 style="font-size:30px;letter-spacing:10px;margin:18px 0 6px">이수확인서</h1>' +
      '<p style="font-size:13px;color:#6b6f68;margin:0">' + (cert.week ? cert.week + '주차 과정' : 'CNL Works PIP 전 과정') + '</p>' +
    '</div>' +
    '<table class="kv">' +
      '<tr><td>성명</td><td>' + escapeHtml(cert.name || '-') + '</td></tr>' +
      '<tr><td>소속 회사</td><td>' + escapeHtml(cert.companyName || '-') + '</td></tr>' +
      '<tr><td>과정명</td><td>' + escapeHtml(cert.trackName || '-') + (cert.week ? ' (' + cert.week + '주차)' : '') + '</td></tr>' +
      '<tr><td>과정 기간</td><td>' + period + '</td></tr>' +
    '</table>' +
    '<h2>이수 내역</h2>' +
    '<table class="kv">' +
      '<tr><td>이수 강의</td><td>' + req.lectures.length + '강 (전 강의 이수)</td></tr>' +
      (quizTotal ? '<tr><td>퀴즈</td><td>' + quizDone + ' / ' + quizTotal + '강 합격</td></tr>' : '') +
      (req.asgs.length ? '<tr><td>필수 과제</td><td>' + req.asgs.length + '건 전부 제출</td></tr>' : '') +
      '<tr><td>총 시청 시간</td><td>' + fmtDur(r.totalSec) + '</td></tr>' +
    '</table>' +
    '<p style="font-size:14px;line-height:2;margin:26px 0 0;text-align:center">위 사람은 ' + escapeHtml(cert.companyName || '') + '의 ' +
      escapeHtml(cert.trackName || '') + (cert.week ? ' ' + cert.week + '주차' : ' 전') + ' 과정을<br>' +
      '아래 기준에 따라 이수하였음을 확인합니다.</p>' +
    '<p style="font-size:12px;color:#6b6f68;text-align:center;margin:10px 0 0">이수 기준: 강의별 시청 시간 95% 이상, 퀴즈가 있는 강의는 합격, 필수 과제 제출</p>' +
    '<div style="text-align:center;margin-top:34px">' +
      '<p style="font-size:15px;margin:0">' + kDate(tsDate(cert.issuedAt)) + '</p>' +
      '<p style="font-size:19px;font-weight:600;letter-spacing:2px;margin:14px 0 0;position:relative;display:inline-block">' + CERT_ISSUER +
        '<img src="' + CERT_STAMP_DATA_URI + '" alt="직인" style="width:64px;height:64px;vertical-align:middle;margin-left:6px;transform:translateY(-2px)">' +
      '</p>' +
    '</div>' +
    '<div class="foot">출력 일시: ' + kDateTime(now) + ' · 발급자: ' + escapeHtml(cert.issuedByName || '') +
      '<br>이 확인서의 이수 내역은 수강 기록(시청 시간·일시, 퀴즈 응시, 과제 제출)에 근거해 자동 판정되었으며, 상세 내역은 같은 대상자의 수강 기록 리포트에서 확인할 수 있습니다.</div>';
  openReportWindow('이수확인서_' + (cert.name || '') + '_' + cert.no, html);
}

document.getElementById('btn-detail-cert').onclick = () => {
  if(!detailUid) return;
  const week = prompt('전체 과정 이수확인서는 그대로 확인을 누르세요.\n특정 주차만 발급하려면 주차 번호를 입력하세요 (예: 3).', '');
  if(week === null) return;
  const w = week.trim() ? parseInt(week.trim(), 10) : null;
  if(week.trim() && !(w >= 1)){ alert('주차는 1 이상의 숫자로 입력하세요.'); return; }
  issueCertificate(detailUid, w);
};

// ================= 수강 기록 리포트 =================
// 브라우저 인쇄 기능으로 PDF 저장 (한글 글꼴 문제 없음). 엑셀은 회사 요약만 제공 (개인 리포트는 수정이 쉬운 형식을 피함)
const KST = { timeZone: 'Asia/Seoul' };
function tsDate(t){ return t && t.seconds != null ? new Date(t.seconds * 1000) : null; }
function kDate(d){ return d ? d.toLocaleDateString('ko-KR', KST) : '-'; }
function kTime(d){ return d ? d.toLocaleTimeString('ko-KR', { ...KST, hour: '2-digit', minute: '2-digit', hour12: false }) : '-'; }
function kDateTime(d){ return d ? kDate(d) + ' ' + kTime(d) : '-'; }
function kDayKey(d){ return d.toLocaleDateString('sv-SE', KST); } // YYYY-MM-DD (한국 시간)
function fmtDur(sec){
  sec = Math.round(sec || 0);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? h + '시간 ' : '') + (h || m ? m + '분 ' : '') + (h ? '' : s + '초');
}

// 수강생 1명의 전체 기록 수집
async function collectTraineeRecord(uid, library){
  const [userSnap, progSnap] = await Promise.all([
    db.collection('users').doc(uid).get(),
    db.collection('progress').doc(uid).collection('lectures').get()
  ]);
  const user = { id: uid, ...(userSnap.data() || {}) };
  const cur = await curriculumForUser(user, library);
  const courses = cur.courses;
  const courseById = {};
  library.forEach(c => { courseById[c.id] = c; });
  const progAll = {};
  progSnap.docs.forEach(d => { progAll[d.id] = d.data(); });
  const sch = scheduleFor(user, cur.track);
  const weeks = weekSummary(courses, progAll, sch);
  const weekById = {};
  courses.forEach(c => { weekById[c.id] = c.week; });
  const prog = {};
  progSnap.docs.forEach(d => { prog[d.id] = d.data(); });

  const lectures = courses.map(c => {
    const p = prog[c.id] || {};
    const durSec = (c.duration || 0) * 60;
    return {
      week: c.week, order: c.order, title: c.title, durationMin: c.duration || 0,
      watchedSec: p.watchedSeconds || 0,
      pct: durSec ? Math.min(100, Math.round(((p.watchedSeconds || 0) / durSec) * 100)) : 0,
      done: lectureDone(c.id, p), completedAt: lectureDoneAt(c.id, p), id: c.id,
      hasQuiz: hasQuiz(c.id), quizPassed: p.quizPassed === true
    };
  });

  const sessions = [];
  Object.keys(prog).forEach(cid => {
    const map = prog[cid].sessions || {};
    Object.keys(map).forEach(k => {
      const e = map[k];
      const first = tsDate(e.first), last = tsDate(e.last);
      if(!first) return;
      sessions.push({ first, last, sec: e.s || 0, title: courseById[cid] ? courseById[cid].title : '(삭제된 강의)',
        week: weekById[cid] != null ? weekById[cid] + '주' : '과정 외' });
    });
  });
  sessions.sort((a, b) => a.first - b.first);

  const totalSec = sessions.reduce((a, x) => a + x.sec, 0) || lectures.reduce((a, x) => a + x.watchedSec, 0);
  const days = [...new Set(sessions.map(x => kDayKey(x.first)))];
  const lastActive = sessions.length ? sessions[sessions.length - 1].last || sessions[sessions.length - 1].first : null;
  // 퀴즈 응시 기록 (회사 관리자는 자기 회사 기록만 조회 가능)
  let attempts = [];
  try{
    let aq = db.collection('quizAttempts').where('uid', '==', uid);
    if(currentRole === 'client_hr') aq = aq.where('companyId', '==', currentCompanyId);
    const as = await aq.get();
    attempts = as.docs.map(d => d.data()).sort((a, b) => ((a.at && a.at.seconds) || 0) - ((b.at && b.at.seconds) || 0));
  } catch(e){ console.warn('퀴즈 기록 조회 실패', e.code); }

  // 과제 제출·피드백 (회사 관리자는 공개 설정된 과제만 열람 가능)
  let asgRows = [];
  try{
    const list = cur.track ? await loadAssignments(cur.track.id) : [];
    const subsSnap = await db.collection('submissions').where('uid', '==', uid).get();
    const subs = {};
    subsSnap.docs.forEach(x => { subs[x.data().aid] = { id: x.id, ...x.data() }; });
    for(const a of list){
      const sub = subs[a.id];
      let feedback = [];
      if(sub){
        try{
          const fs = await db.collection('submissions').doc(sub.id).collection('feedback').get();
          feedback = fs.docs.map(x => x.data()).sort((x, y) => ((x.at && x.at.seconds) || 0) - ((y.at && y.at.seconds) || 0));
        } catch(e){}
      }
      const due = sch.paced ? sch.dueAt(a.week) : null;
      const at = sub && sub.status === 'submitted' ? tsDate(sub.submittedAt) : null;
      asgRows.push({ a, sub, feedback, due, at, late: !!(due && at && at > due) });
    }
  } catch(e){ console.warn('과제 조회 실패', e.code); }
  const doneCount = lectures.filter(l => l.done).length;
  return {
    user, cur, sch, weeks, lectures, sessions, totalSec, days, lastActive, doneCount, attempts, asgRows,
    pct: lectures.length ? Math.round((doneCount / lectures.length) * 100) : 0
  };
}

async function reporterLabel(){
  const snap = await db.collection('users').doc(currentUser.uid).get();
  const u = snap.data() || {};
  return (u.name || '') + ' (' + (u.email || currentUser.email) + ', ' + (ROLE_LABELS[currentRole] || currentRole) + ')';
}

async function companyNameById(id){
  if(!id) return '-';
  try{ const s = await db.collection('companies').doc(id).get(); return s.exists ? s.data().name : '(삭제된 회사)'; }
  catch(e){ return '-'; }
}

const REPORT_CSS = `
  *{box-sizing:border-box} body{font-family:'Pretendard','Noto Sans KR','Malgun Gothic',sans-serif;color:#1b2430;margin:0;padding:28px;font-size:12px;line-height:1.55}
  h1{font-size:19px;margin:0 0 4px} h2{font-size:14px;margin:22px 0 8px;padding-bottom:4px;border-bottom:2px solid #1f7a6d}
  .sub{color:#6b6f68;font-size:11px;margin:0 0 14px}
  table{width:100%;border-collapse:collapse;margin-top:4px} th,td{border:1px solid #cfd4cc;padding:5px 7px;text-align:left;vertical-align:top}
  th{background:#eef3f0;font-weight:600;white-space:nowrap} td.n{text-align:right;white-space:nowrap}
  .kv td:first-child{width:130px;background:#f6f8f6;font-weight:600}
  .sum{display:flex;gap:10px;margin-top:6px} .sum div{flex:1;border:1px solid #cfd4cc;border-radius:6px;padding:8px;text-align:center}
  .sum b{display:block;font-size:17px;color:#1f7a6d}
  .day td{background:#f6f8f6;font-weight:600}
  .foot{margin-top:24px;padding-top:10px;border-top:1px solid #cfd4cc;color:#6b6f68;font-size:10.5px}
  .noprint{margin-bottom:16px} .noprint button{padding:8px 16px;font-size:13px;cursor:pointer}
  @media print{ .noprint{display:none} body{padding:0} @page{size:A4;margin:14mm} tr{page-break-inside:avoid} h2{page-break-after:avoid} }
`;
const REPORT_NOTE =
  '※ 시청 시간과 시각은 수강생이 영상을 실제로 재생한 시간을 기준으로 서버 시각에 따라 자동 기록되었으며, 웹사이트를 통해서는 수강생·관리자 누구도 수정하거나 삭제할 수 없도록 설정되어 있습니다. ' +
  '강의 완료는 누적 시청 시간이 강의 길이의 95% 이상일 때 처리됩니다. 시각은 한국 표준시(KST) 기준입니다.';

function openReportWindow(title, bodyHtml){
  const w = window.open('', '_blank');
  if(!w){ alert('팝업이 차단되었습니다. 이 사이트의 팝업을 허용한 뒤 다시 시도해 주세요.'); return; }
  w.document.write('<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>' + escapeHtml(title) + '</title><style>' + REPORT_CSS + '</style></head><body>' +
    '<div class="noprint"><button onclick="window.print()">PDF로 저장 / 인쇄</button> <span style="color:#6b6f68;font-size:12px">인쇄 창에서 대상(프린터)을 "PDF로 저장"으로 고르세요.</span></div>' +
    bodyHtml + '</body></html>');
  w.document.close();
  setTimeout(() => { try{ w.focus(); w.print(); } catch(e){} }, 400);
}

function quizCell(r, l){
  if(!l.hasQuiz) return '-';
  const mine = r.attempts.filter(a => a.courseId === l.id);
  if(!mine.length) return '미응시';
  const best = mine.reduce((m, a) => a.score > m.score ? a : m, mine[0]);
  return (l.quizPassed ? '합격' : '<span style="color:#b4531f">불합격</span>') + ' · 최고 ' + best.score + '/' + best.total + ' · ' + mine.length + '회';
}
async function openTraineeReport(uid){
  logAccess('trainee_report', uid);
  const btn = document.getElementById('btn-detail-report');
  btn.disabled = true; btn.textContent = '리포트 만드는 중…';
  try{
    const [courses] = await Promise.all([loadCourses(), loadQuizMeta()]);
    const r = await collectTraineeRecord(uid, courses);
    const u = r.user;
    const coName = await companyNameById(u.companyId);
    const by = await reporterLabel();
    const now = new Date();
    let consentText = '기록 없음';
    try{
      const cs = await db.collection('consents').doc(consentDocId(uid)).get();
      if(cs.exists){
        const d = cs.data();
        consentText = '이용약관 동의 · 개인정보 처리 안내 확인 — ' + kDateTime(tsDate(d.agreedAt)) +
          ' (문서 버전 ' + escapeHtml(d.version) + ')';
      }
    } catch(e){}
    const joinPath = u.inviteEmail
      ? (u.joinVia === 'approval'
          ? '수강생 명단 등록 → 관리자 승인으로 가입 (회사 메일 수신 불가로 이메일 인증 대체' + (u.approvedAt ? ', 승인 ' + kDateTime(tsDate(u.approvedAt)) : '') + ')'
          : '수강생 명단 등록 → 본인 이메일 인증 후 가입')
      : u.inviteCode ? '초대 코드로 가입' : '관리자 지정';

    let html =
      '<h1>CNL Works PIP 수강 기록</h1><p class="sub">대상자: ' + escapeHtml(u.name || '-') + ' · ' + escapeHtml(coName) + '</p>' +
      '<h2>1. 대상자 정보</h2><table class="kv">' +
      '<tr><td>성명</td><td>' + escapeHtml(u.name || '-') + '</td></tr>' +
      '<tr><td>이메일</td><td>' + escapeHtml(u.email || '-') + '</td></tr>' +
      '<tr><td>소속 회사</td><td>' + escapeHtml(coName) + '</td></tr>' +
      (u.rosteredAt ? '<tr><td>대상자 명단 등록</td><td>' + kDateTime(tsDate(u.rosteredAt)) + '</td></tr>' : '') +
      '<tr><td>가입 일시</td><td>' + kDateTime(tsDate(u.createdAt)) + '</td></tr>' +
      '<tr><td>가입 경로</td><td>' + joinPath + '</td></tr>' +
      (u.status === 'withdrawn' ? '<tr><td>회원 탈퇴</td><td>' + kDateTime(tsDate(u.withdrawnAt)) + (u.withdrawReason ? ' (사유: ' + escapeHtml(u.withdrawReason) + ')' : '') + '</td></tr>' : '') +
      '<tr><td>개인정보 동의</td><td>' + consentText + '</td></tr>' +
      '<tr><td>수강 과정</td><td>' + (r.cur.track ? escapeHtml(r.cur.track.name) + ' (' + escapeHtml(r.cur.track.kind || '') + (r.cur.isDefault ? ', 회사 기본 과정' : '') + ')' : '미배정') + '</td></tr>' +
      (u.trackAssignedAt ? '<tr><td>과정 배정 변경</td><td>' + kDateTime(tsDate(u.trackAssignedAt)) + '</td></tr>' : '') +
      '<tr><td>진행 방식</td><td>' + (r.sch.paced
        ? '주차별 순차 공개 · 시작일 ' + kDate(r.sch.start) + ' (' + r.sch.source + ' 기준)' + (r.weeks.length ? ' · 종료 예정 ' + kDate(r.weeks[r.weeks.length - 1].dueAt) : '')
        : '처음부터 전체 공개') + '</td></tr>' +
      '</table>' +

      '<h2>2. 요약</h2><div class="sum">' +
      '<div><b>' + r.pct + '%</b>진도율</div>' +
      '<div><b>' + r.doneCount + ' / ' + r.lectures.length + '</b>완료 강의</div>' +
      '<div><b>' + fmtDur(r.totalSec) + '</b>총 시청 시간</div>' +
      '<div><b>' + r.days.length + '일</b>수강일수</div></div>' +
      '<p class="sub" style="margin-top:6px">첫 수강: ' + (r.sessions.length ? kDateTime(r.sessions[0].first) : '-') +
      ' · 마지막 수강: ' + kDateTime(r.lastActive) + '</p>' +

      (r.sch.paced && r.weeks.length ? '<h2>3. 주차별 이수 현황</h2><table><thead><tr><th>주차</th><th>공개일</th><th>이수 기한</th><th>강의</th><th>기한 내 완료</th><th>기한 후 완료</th><th>미완료</th><th>상태</th></tr></thead><tbody>' +
        r.weeks.map(w => '<tr><td class="n">' + w.week + '주</td><td>' + kDate(w.openAt) + '</td><td>' + kDate(w.dueAt) + '</td><td class="n">' + w.total + '</td>' +
          '<td class="n">' + w.onTime + '</td><td class="n">' + (w.late || '') + '</td><td class="n">' + ((w.total - w.done) || '') + '</td>' +
          '<td>' + (w.state === 'locked' ? '공개 전' : w.state === 'current' ? '진행 중' : w.done === w.total ? (w.late ? '기한 후 완료' : '기한 내 완료') : '<b style="color:#b4531f">기한 경과·미완료</b>') + '</td></tr>').join('') +
        '</tbody></table>' : '') +
      '<h2>' + (r.sch.paced ? '4' : '3') + '. 강의별 이수 현황</h2><table><thead><tr><th>주차</th><th>강의명</th><th>길이</th><th>누적 시청</th><th>진도</th><th>퀴즈</th><th>완료 일시</th></tr></thead><tbody>' +
      r.lectures.map(l => '<tr><td class="n">' + l.week + '주</td><td>' + escapeHtml(l.title) + '</td><td class="n">' + l.durationMin + '분</td>' +
        '<td class="n">' + fmtDur(l.watchedSec) + '</td><td class="n">' + l.pct + '%</td><td>' + quizCell(r, l) + '</td>' +
        '<td>' + (l.done ? kDateTime(l.completedAt) + (r.sch.paced && l.completedAt && l.completedAt > r.sch.dueAt(l.week) ? ' <span style="color:#b4531f">(기한 후)</span>' : '') : '<span style="color:#b4531f">미완료</span>') + '</td></tr>').join('') +
      '</tbody></table>' +

      '<h2>' + (r.sch.paced ? '5' : '4') + '. 일자별 수강 기록</h2>';
    if(!r.sessions.length){
      html += '<p class="sub">기록된 수강 이력이 없습니다.' + (r.totalSec ? ' (일자별 기록 기능 도입 이전의 시청 시간은 강의별 누적 시청에만 반영되어 있습니다.)' : '') + '</p>';
    } else {
      html += '<table><thead><tr><th>시작</th><th>마지막 기록</th><th>주차</th><th>강의명</th><th>시청 시간</th></tr></thead><tbody>';
      let curDay = null, daySum = 0, rowsHtml = '';
      const flushDay = () => { if(curDay) html += '<tr class="day"><td colspan="4">' + curDay + '</td><td class="n">' + fmtDur(daySum) + '</td></tr>' + rowsHtml; };
      r.sessions.forEach(x => {
        const d = kDate(x.first);
        if(d !== curDay){ flushDay(); curDay = d; daySum = 0; rowsHtml = ''; }
        daySum += x.sec;
        rowsHtml += '<tr><td>' + kTime(x.first) + '</td><td>' + kTime(x.last) + '</td><td class="n">' + x.week + '</td><td>' + escapeHtml(x.title) + '</td><td class="n">' + fmtDur(x.sec) + '</td></tr>';
      });
      flushDay();
      html += '</tbody></table><p class="sub" style="margin-top:4px">"마지막 기록"은 해당 시청 중 시청 시간이 마지막으로 저장된 시각입니다 (1분 단위 저장).</p>';
    }
    let secNo = r.sch.paced ? 6 : 5;
    if(r.asgRows.length){
      html += '<h2>' + (secNo++) + '. 과제 제출 현황</h2><table><thead><tr><th>주차</th><th>과제</th><th>제출 기한</th><th>제출 일시</th><th>제출 횟수</th><th>피드백</th><th>상태</th></tr></thead><tbody>' +
        r.asgRows.map(x => '<tr><td class="n">' + x.a.week + '주</td><td>' + escapeHtml(x.a.title) + (x.a.required === false ? ' (선택)' : '') + '</td>' +
          '<td>' + (x.due ? kDate(x.due) : '-') + '</td><td>' + (x.at ? kDateTime(x.at) : '-') + '</td>' +
          '<td class="n">' + ((x.sub && x.sub.lastVersion) || 0) + '</td><td class="n">' + (x.feedback.length || '') + '</td>' +
          '<td>' + (x.at ? (x.late ? '<span style="color:#b4531f">기한 후 제출</span>' : '기한 내 제출')
            : x.sub ? '작성 중(미제출)' : '<b style="color:#b4531f">미제출</b>') + '</td></tr>').join('') +
        '</tbody></table>';
      // 제출문 전문은 메인 관리자가 출력할 때만 포함 (개인적 내용이 포함될 수 있음)
      const full = r.asgRows.filter(x => x.sub && x.sub.text && (currentRole === 'admin' || x.a.visibleToHr !== false));
      if(full.length){
        html += '<h2>' + (secNo++) + '. 과제 제출문 및 피드백</h2>' +
          full.map(x => '<div style="page-break-inside:auto;margin-bottom:14px">' +
            '<p style="font-weight:600;margin:12px 0 4px">' + x.a.week + '주차 · ' + escapeHtml(x.a.title) +
            ' <span style="font-weight:400;color:#6b6f68;font-size:11px">' + (x.at ? kDateTime(x.at) + ' 제출' : '미제출(작성 중)') + '</span></p>' +
            '<div style="white-space:pre-wrap;border:1px solid #cfd4cc;border-radius:6px;padding:10px;font-size:11.5px;line-height:1.7">' + escapeHtml(x.sub.text) + '</div>' +
            x.feedback.map(f => '<div style="white-space:pre-wrap;border:1px solid #1f7a6d;border-radius:6px;padding:10px;font-size:11.5px;line-height:1.7;margin-top:6px;background:#eef3f0">' +
              '<b>피드백 — ' + escapeHtml(f.byName || '') + ' · ' + kDateTime(tsDate(f.at)) + '</b><br>' + escapeHtml(f.text) + '</div>').join('') +
            '</div>').join('');
      }
    }
    if(r.attempts.length){
      const titleOf = cid => (libraryById[cid] && libraryById[cid].title) || '(삭제된 강의)';
      html += '<h2>' + (secNo++) + '. 퀴즈 응시 기록</h2><table><thead><tr><th>응시 일시</th><th>강의</th><th>회차</th><th>점수</th><th>결과</th></tr></thead><tbody>' +
        r.attempts.map(a => '<tr><td>' + kDateTime(tsDate(a.at)) + '</td><td>' + escapeHtml(titleOf(a.courseId)) + '</td><td class="n">' + a.n + '회</td>' +
          '<td class="n">' + a.score + '/' + a.total + '</td><td>' + (a.passed ? '합격' : '불합격') + '</td></tr>').join('') +
        '</tbody></table><p class="sub" style="margin-top:4px">점수는 서버 규칙으로 정답과 대조해 검증된 값이며, 응시 기록은 수정·삭제할 수 없습니다.</p>';
    }
    if(r.cur.track){
      try{
        const hs = await db.collection('tracks').doc(r.cur.track.id).collection('history').orderBy('at').get();
        if(!hs.empty){
          html += '<h2>' + (secNo++) + '. 수강 과정 구성 이력</h2><table><thead><tr><th>일시</th><th>내용</th><th>강의 수</th><th>총 길이</th><th>사유</th></tr></thead><tbody>' +
            hs.docs.map(h => { const d = h.data(); return '<tr><td>' + kDateTime(tsDate(d.at)) + '</td><td>' + escapeHtml(d.action || '') + '</td><td class="n">' + (d.itemCount || 0) + '강</td><td class="n">' + fmtDur((d.totalMin || 0) * 60) + '</td><td>' + escapeHtml(d.note || '') + '</td></tr>'; }).join('') +
            '</tbody></table>';
        }
      } catch(e){}
    }
    html += '<div class="foot">출력 일시: ' + kDateTime(now) + ' · 출력자: ' + escapeHtml(by) + '<br>진도율은 대상자에게 배정된 과정 기준입니다. ' + REPORT_NOTE + '</div>';
    openReportWindow('수강기록_' + (u.name || uid) + '_' + kDayKey(now), html);
  } catch(e){ alert('리포트 생성 실패: ' + friendlyError(e)); }
  finally{ btn.disabled = false; btn.textContent = '수강 기록 리포트 (PDF)'; }
}

// 회사 단위 요약
async function collectCompanySummary(companyId){
  const [courses] = await Promise.all([loadCourses(), loadQuizMeta()]);
  const tSnap = await db.collection('users').where('role', '==', 'trainee').where('companyId', '==', companyId).get();
  const trainees = tSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const rows = [];
  for(const t of trainees){
    const r = await collectTraineeRecord(t.id, courses);
    const idle = r.lastActive ? Math.floor((Date.now() - r.lastActive.getTime()) / 86400000) : null;
    rows.push({ name: t.name || '-', email: t.email || '-', track: trackLabel(r.cur), joined: tsDate(t.createdAt), pct: r.pct,
      start: r.sch.paced ? r.sch.startYmd : '전체 공개', overdue: r.weeks.filter(w => w.overdue).map(w => w.week + '주').join(', '), done: r.doneCount,
      total: r.lectures.length, totalSec: r.totalSec, days: r.days.length, lastActive: r.lastActive, idle });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  return { rows, courseCount: courses.length };
}

async function companySummaryReport(companyId, format, btn){
  if(!companyId){ alert('회사를 먼저 선택하세요.'); return; }
  logAccess('company_summary_' + format, null);
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = '만드는 중…';
  try{
    const coName = await companyNameById(companyId);
    const { rows, courseCount } = await collectCompanySummary(companyId);
    const now = new Date();
    const idleText = x => x.idle == null ? '수강 이력 없음' : x.idle + '일';
    if(format === 'xlsx'){
      const XLSX = await ensureXLSX();
      const aoa = [['이름', '이메일', '과정', '시작일', '지연 주차', '가입일', '진도율(%)', '완료 강의', '전체 강의', '총 시청(분)', '수강일수', '마지막 수강', '미접속 경과']]
        .concat(rows.map(x => [x.name, x.email, x.track, x.start, x.overdue || '-', kDate(x.joined), x.pct, x.done, x.total, Math.round(x.totalSec / 60), x.days, kDateTime(x.lastActive), idleText(x)]));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '수강 요약');
      XLSX.writeFile(wb, coName + '_수강요약_' + kDayKey(now) + '.xlsx');
    } else {
      const by = await reporterLabel();
      const avg = rows.length ? Math.round(rows.reduce((a, x) => a + x.pct, 0) / rows.length) : 0;
      const html =
        '<h1>CNL Works PIP 수강 현황 요약</h1><p class="sub">' + escapeHtml(coName) + ' · 기준 시각 ' + kDateTime(now) + '</p>' +
        '<div class="sum"><div><b>' + rows.length + '명</b>대상자</div><div><b>' + avg + '%</b>평균 진도율</div>' +
        '<div><b>' + rows.filter(x => x.total && x.done === x.total).length + '명</b>전 과정 완료</div>' +
        '<div><b>' + rows.filter(x => x.idle == null || x.idle >= 3).length + '명</b>3일 이상 미수강</div></div>' +
        '<h2>대상자별 현황</h2><table><thead><tr><th>이름</th><th>이메일</th><th>과정</th><th>시작일</th><th>지연 주차</th><th>가입일</th><th>진도율</th><th>완료</th><th>총 시청</th><th>수강일수</th><th>마지막 수강</th><th>미접속</th></tr></thead><tbody>' +
        rows.map(x => '<tr><td>' + escapeHtml(x.name) + '</td><td>' + escapeHtml(x.email) + '</td><td>' + escapeHtml(x.track) + '</td><td>' + escapeHtml(x.start) + '</td><td' + (x.overdue ? ' style="color:#b4531f;font-weight:600"' : '') + '>' + escapeHtml(x.overdue || '-') + '</td><td>' + kDate(x.joined) + '</td>' +
          '<td class="n">' + x.pct + '%</td><td class="n">' + x.done + '/' + x.total + '</td><td class="n">' + fmtDur(x.totalSec) + '</td>' +
          '<td class="n">' + x.days + '일</td><td>' + kDateTime(x.lastActive) + '</td>' +
          '<td class="n"' + (x.idle == null || x.idle >= 3 ? ' style="color:#b4531f;font-weight:600"' : '') + '>' + idleText(x) + '</td></tr>').join('') +
        '</tbody></table>' +
        '<div class="foot">출력 일시: ' + kDateTime(now) + ' · 출력자: ' + escapeHtml(by) + ' · 진도율은 대상자별 배정 과정 기준<br>' + REPORT_NOTE + '</div>';
      openReportWindow(coName + '_수강요약_' + kDayKey(now), html);
    }
  } catch(e){ alert('리포트 생성 실패: ' + friendlyError(e)); }
  finally{ btn.disabled = false; btn.textContent = label; }
}

document.getElementById('btn-admin-summary-pdf').onclick = (e) => companySummaryReport(adminSelectedCompanyId, 'pdf', e.currentTarget);
document.getElementById('btn-admin-summary-xlsx').onclick = (e) => companySummaryReport(adminSelectedCompanyId, 'xlsx', e.currentTarget);
document.getElementById('btn-hr-summary-pdf').onclick = (e) => companySummaryReport(currentCompanyId, 'pdf', e.currentTarget);
document.getElementById('btn-hr-summary-xlsx').onclick = (e) => companySummaryReport(currentCompanyId, 'xlsx', e.currentTarget);

document.getElementById('btn-close-detail').onclick = () => {
  document.getElementById('trainee-detail-modal').classList.add('hidden');
};

// ================= 강의 카테고리 =================
// settings/courseCategories: { items: [{ name, desc }] } — 강의(courses)의 category 필드에는 이름이 저장됨

async function loadCategories(){
  try{
    const snap = await db.collection('settings').doc('courseCategories').get();
    if(snap.exists && Array.isArray(snap.data().items)) courseCategories = snap.data().items;
    else {
      // 최초 1회: 기본 카테고리안을 저장 (이후 '카테고리 관리'에서 수정)
      courseCategories = DEFAULT_CATEGORIES.slice();
      await db.collection('settings').doc('courseCategories').set({ items: courseCategories, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    }
  } catch(e){ courseCategories = DEFAULT_CATEGORIES.slice(); }
  return courseCategories;
}
function fmtMin(m){ m = Math.round(m || 0); const h = Math.floor(m / 60); return (h ? h + '시간' + (m % 60 ? ' ' : '') : '') + (m % 60 || !h ? (m % 60) + '분' : ''); }
function catNames(){ return courseCategories.map(c => c.name); }
function catIndex(name){ const i = catNames().indexOf(name); return i < 0 ? (name ? 900 : 999) : i; }
// select 옵션: 목록에 없는 기존 값도 표시해 둠
function catOptionsHtml(selected, firstLabel){
  let html = '<option value="">' + (firstLabel || '(카테고리 선택)') + '</option>';
  if(selected && !catNames().includes(selected)) html += '<option value="' + escapeHtml(selected) + '" selected>' + escapeHtml(selected) + ' (목록에 없음)</option>';
  courseCategories.forEach((c, i) => { html += '<option value="' + escapeHtml(c.name) + '"' + (c.name === selected ? ' selected' : '') + '>' + (i + 1) + '. ' + escapeHtml(c.name) + '</option>'; });
  return html;
}
function refreshCategorySelects(){
  const one = document.getElementById('c-category');
  one.innerHTML = catOptionsHtml(one.value);
  const lf = document.getElementById('lib-cat-filter');
  const lv = lf.value;
  lf.innerHTML = '<option value="">모든 카테고리</option>' + courseCategories.map(c => '<option value="' + escapeHtml(c.name) + '">' + escapeHtml(c.name) + '</option>').join('') + '<option value="__none__">' + UNCAT + '·목록에 없음</option>';
  lf.value = lv;
  const cf = document.getElementById('cur-cat-filter');
  const cv = cf.value;
  cf.innerHTML = '<option value="">모든 카테고리</option>' + courseCategories.map(c => '<option value="' + escapeHtml(c.name) + '">' + escapeHtml(c.name) + '</option>').join('') + '<option value="__none__">' + UNCAT + '</option>';
  cf.value = cv;
  gridRows().forEach(tr => { const sel = tr.querySelector('select[data-col="category"]'); sel.innerHTML = catOptionsHtml(sel.value, '(선택)'); });
}

// ---------- 보관함 목록 (카테고리별 묶음) ----------
const libOpen = new Set();
let libExpandAll = null;
function renderLibrary(){
  const courses = courseCache;
  document.getElementById('course-count').textContent = courses.length;
  const q = (document.getElementById('lib-search').value || '').trim().toLowerCase();
  const cf = document.getElementById('lib-cat-filter').value;
  const listEl = document.getElementById('admin-course-list');
  const usage = courseUsage();
  const known = new Set(catNames());
  const list = courses.filter(c => (!q || (c.title || '').toLowerCase().includes(q)) &&
    (!cf || (cf === '__none__' ? !known.has(c.category) : c.category === cf)));
  const groups = {};
  list.forEach(c => { const k = known.has(c.category) ? c.category : (c.category ? c.category : UNCAT); (groups[k] = groups[k] || []).push(c); });
  // 카테고리 목록 순서대로, 강의가 없는 카테고리도 표시 (필터·검색 중에는 결과 있는 것만)
  let keys = (q || cf) ? Object.keys(groups) : Array.from(new Set(catNames().concat(Object.keys(groups))));
  keys.sort((a, b) => catIndex(a) - catIndex(b) || a.localeCompare(b, 'ko'));
  const autoOpen = !!(q || cf);
  listEl.innerHTML = keys.length ? '' : '<p style="font-size:13px;color:var(--muted);margin:0">' + (courses.length ? '찾는 강의가 없습니다.' : '보관함에 강의가 없습니다.') + '</p>';
  keys.forEach(k => {
    const items = (groups[k] || []).slice().sort((a, b) => (a.title || '').localeCompare(b.title || '', 'ko'));
    const open = libExpandAll != null ? libExpandAll : (autoOpen || libOpen.has(k));
    if(open) libOpen.add(k); else libOpen.delete(k);
    const meta = courseCategories.find(c => c.name === k);
    const min = items.reduce((a, c) => a + (c.duration || 0), 0);
    const head = document.createElement('div');
    head.className = 'cat-head';
    head.innerHTML = '<span>' + (open ? '▾ ' : '▸ ') + escapeHtml(k) +
      (meta && meta.desc ? ' <span class="cat-desc">— ' + escapeHtml(meta.desc) + '</span>' : '') +
      (!meta && k !== UNCAT ? ' <span class="badge warn">목록에 없음</span>' : '') + '</span>' +
      '<span class="cnt">' + items.length + '강' + (min ? ' · ' + fmtMin(min) : '') + '</span>';
    head.onclick = () => { libExpandAll = null; if(libOpen.has(k)) libOpen.delete(k); else libOpen.add(k); renderLibrary(); };
    listEl.appendChild(head);
    if(!open) return;
    if(!items.length){ const p = document.createElement('p'); p.style.cssText = 'font-size:12px;color:var(--muted);margin:6px 12px'; p.textContent = '이 카테고리에 등록된 강의가 없습니다.'; listEl.appendChild(p); }
    items.forEach(c => {
      const used = usage[c.id] || [];
      const row = document.createElement('div');
      row.className = 'lecture';
      const srcTag = c.videoId ? ' · Bunny 영상' : c.youtubeUrl ? ' · YouTube' : ' · 영상 미등록';
      row.innerHTML =
        '<div><div class="title">' + escapeHtml(c.title) + '</div><div class="meta">' + (c.duration ? c.duration + '분' : '') + srcTag +
          (used.length ? ' · <span title="' + escapeHtml(used.join(', ')) + '">' + used.length + '개 과정에서 사용</span>' : ' · 미사용') + '</div></div>' +
        '<div class="row" style="gap:8px">' +
          '<button class="ghost" data-quiz-edit="' + c.id + '">' + (hasQuiz(c.id) ? '퀴즈 ' + quizMeta[c.id].questions.length + '문항' : '퀴즈 추가') + '</button>' +
          '<button class="ghost" data-edit="' + c.id + '">수정</button>' +
          '<button class="ghost" data-del="' + c.id + '">삭제</button>' +
        '</div>';
      listEl.appendChild(row);
    });
  });
  libExpandAll = null;
  listEl.querySelectorAll('button[data-edit]').forEach(btn => {
    btn.onclick = () => { const course = courses.find(c => c.id === btn.getAttribute('data-edit')); if(course) startEditCourse(course); };
  });
  listEl.querySelectorAll('button[data-quiz-edit]').forEach(btn => {
    btn.onclick = () => openQuizEditor(btn.getAttribute('data-quiz-edit'));
  });
  listEl.querySelectorAll('button[data-del]').forEach(btn => {
    btn.onclick = async () => {
      const cid = btn.getAttribute('data-del');
      const used = courseUsage()[cid] || [];
      if(used.length){ alert('이 강의는 다음 과정·템플릿에서 사용 중이라 삭제할 수 없습니다. 먼저 과정에서 빼 주세요.\n\n' + used.join('\n')); return; }
      if(!confirm('이 강의를 보관함에서 삭제할까요?')) return;
      const target = courses.find(x => x.id === cid);
      await db.collection('courses').doc(cid).delete();
      if(target && target.videoId){
        // 영상 파일까지 지웁니다. 결과를 확인해 실패하면 알려 줍니다.
        try{
          const r = (await fx.httpsCallable('bunnyDeleteVideo')({ videoId: target.videoId })).data;
          if(!r || !r.ok) alert('강의는 삭제했지만 영상 파일을 지우지 못했습니다.\n' + ((r && r.message) || '잠시 후 다시 시도하거나 Bunny 대시보드에서 지워 주세요.'));
        } catch(err){
          alert('강의는 삭제했지만 영상 파일을 지우지 못했습니다.\n' + (err && err.message ? err.message : '') + '\nBunny 대시보드에서 지워 주세요.');
        }
      }
      loadAdminView();
    };
  });
}
document.getElementById('lib-search').oninput = renderLibrary;
document.getElementById('lib-cat-filter').onchange = renderLibrary;
document.getElementById('btn-lib-expand').onclick = () => { libExpandAll = true; renderLibrary(); };
document.getElementById('btn-lib-collapse').onclick = () => { libExpandAll = false; renderLibrary(); };

// ---------- 카테고리 관리 ----------
let catDraft = null; // 편집 중인 목록 [{ name, desc, orig }]
function renderCategoryManager(){
  if(!catDraft) catDraft = courseCategories.map(c => ({ name: c.name, desc: c.desc || '', orig: c.name }));
  const counts = {};
  courseCache.forEach(c => { counts[c.category || ''] = (counts[c.category || ''] || 0) + 1; });
  const el = document.getElementById('cat-list');
  el.innerHTML = '';
  catDraft.forEach((c, i) => {
    const row = document.createElement('div');
    row.className = 'cat-row';
    row.innerHTML =
      '<span style="width:22px;font-size:12px;color:var(--muted);text-align:right">' + (i + 1) + '.</span>' +
      '<input type="text" data-k="name" value="' + escapeHtml(c.name) + '" style="flex:1;min-width:120px">' +
      '<input type="text" data-k="desc" value="' + escapeHtml(c.desc) + '" placeholder="설명" style="flex:2;min-width:160px">' +
      '<span style="font-size:12px;color:var(--muted);width:44px;text-align:right">' + (counts[c.orig] || 0) + '강</span>' +
      '<button class="ghost small-btn" data-mv="-1" title="위로">↑</button><button class="ghost small-btn" data-mv="1" title="아래로">↓</button>' +
      '<button class="ghost small-btn" data-rm="1" title="삭제">×</button>';
    row.querySelectorAll('input').forEach(inp => { inp.oninput = () => { catDraft[i][inp.dataset.k] = inp.value; }; });
    row.querySelector('[data-mv="-1"]').onclick = () => { if(i > 0){ [catDraft[i - 1], catDraft[i]] = [catDraft[i], catDraft[i - 1]]; renderCategoryManager(); } };
    row.querySelector('[data-mv="1"]').onclick = () => { if(i < catDraft.length - 1){ [catDraft[i + 1], catDraft[i]] = [catDraft[i], catDraft[i + 1]]; renderCategoryManager(); } };
    row.querySelector('[data-rm]').onclick = () => {
      const n = counts[c.orig] || 0;
      if(n && !confirm('"' + c.name + '" 카테고리의 강의 ' + n + '개는 저장 시 "' + UNCAT + '"로 바뀝니다. 삭제할까요?')) return;
      catDraft.splice(i, 1); renderCategoryManager();
    };
    el.appendChild(row);
  });
}
document.getElementById('btn-cat-add').onclick = () => {
  const name = document.getElementById('cat-new-name').value.trim();
  const desc = document.getElementById('cat-new-desc').value.trim();
  if(!name) return;
  if(!catDraft) renderCategoryManager();
  if(catDraft.some(c => c.name === name)){ document.getElementById('cat-msg').textContent = '같은 이름의 카테고리가 있습니다.'; return; }
  catDraft.push({ name, desc, orig: null });
  document.getElementById('cat-new-name').value = ''; document.getElementById('cat-new-desc').value = '';
  document.getElementById('cat-msg').textContent = '';
  renderCategoryManager();
};
document.getElementById('btn-cat-save').onclick = async () => {
  const msg = document.getElementById('cat-msg');
  msg.style.color = ''; msg.textContent = '';
  const items = catDraft.map(c => ({ name: c.name.trim(), desc: (c.desc || '').trim(), orig: c.orig }));
  if(items.some(c => !c.name)){ msg.textContent = '이름이 빈 카테고리가 있습니다.'; return; }
  if(new Set(items.map(c => c.name)).size !== items.length){ msg.textContent = '이름이 겹치는 카테고리가 있습니다.'; return; }
  // 이름 변경·삭제를 강의에 반영
  const renames = {};
  items.forEach(c => { if(c.orig && c.orig !== c.name) renames[c.orig] = c.name; });
  const kept = new Set(items.map(c => c.orig).filter(Boolean));
  const removed = courseCategories.map(c => c.name).filter(n => !kept.has(n));
  const updates = [];
  courseCache.forEach(c => {
    if(renames[c.category]) updates.push([c.id, renames[c.category]]);
    else if(removed.includes(c.category)) updates.push([c.id, '']);
  });
  if(updates.length && !confirm('강의 ' + updates.length + '개의 카테고리가 함께 바뀝니다. 저장할까요?')) return;
  const btn = document.getElementById('btn-cat-save');
  btn.disabled = true;
  try{
    const list = items.map(c => ({ name: c.name, desc: c.desc }));
    for(let i = 0; i < Math.max(updates.length, 1); i += 400){
      const batch = db.batch();
      if(i === 0) batch.set(db.collection('settings').doc('courseCategories'), { items: list, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      updates.slice(i, i + 400).forEach(([id, cat]) => batch.update(db.collection('courses').doc(id), { category: cat }));
      await batch.commit();
    }
    catDraft = null;
    msg.style.color = 'var(--teal-dark)'; msg.textContent = '저장했습니다.';
    loadAdminView();
  } catch(e){ msg.textContent = '저장 실패: ' + friendlyError(e); }
  finally{ btn.disabled = false; }
};

// ================= 메인 관리자 화면 내비게이션 =================
let adminSelectedCompanyId = null;
let adminHomeTab = 'companies', adminCompanyTab = 'progress';

function showAdminHomeTab(tab){
  adminHomeTab = tab;
  document.querySelectorAll('#admin-home-tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  document.querySelectorAll('#admin-home [data-panel]').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== tab));
}
function showAdminCompanyTab(tab){
  adminCompanyTab = tab;
  document.querySelectorAll('#admin-company-tabs button').forEach(b => b.classList.toggle('on', b.dataset.ctab === tab));
  document.querySelectorAll('#admin-company [data-cpanel]').forEach(p => p.classList.toggle('hidden', p.dataset.cpanel !== tab));
}
document.getElementById('admin-home-tabs').onclick = (ev) => { const b = ev.target.closest('button[data-tab]'); if(b) showAdminHomeTab(b.dataset.tab); };
document.getElementById('admin-company-tabs').onclick = (ev) => { const b = ev.target.closest('button[data-ctab]'); if(b) showAdminCompanyTab(b.dataset.ctab); };

function openAdminCompany(id, tab){
  if(curEdit) closeCurEditor();
  if(id !== adminSelectedCompanyId){ resetRg(5); document.getElementById('inv-msg').textContent = ''; }
  adminSelectedCompanyId = id;
  adminCompanyTab = tab || 'progress';
  window.scrollTo(0, 0);
  loadAdminView();
}
function closeAdminCompany(){
  if(curEdit) closeCurEditor();
  adminSelectedCompanyId = null;
  window.scrollTo(0, 0);
  loadAdminView();
}
document.getElementById('btn-company-back').onclick = closeAdminCompany;

function companyStats(cid){
  const trainees = adminUsers.filter(u => u.role === 'trainee' && u.companyId === cid && u.status !== 'withdrawn').length;
  const managers = adminUsers.filter(u => u.role === 'client_hr' && u.companyId === cid).length;
  const waiting = adminPending.filter(x => x.companyId === cid && x.active && !x.usedBy).length;
  const tracks = adminTracks.filter(t => t.companyId === cid).length;
  const requests = adminJoinReqs.filter(r => { const p = adminPending.find(x => x.id === r.email); return p && p.companyId === cid && p.active && !p.usedBy; }).length;
  return { trainees, managers, waiting, tracks, requests };
}

function renderCompanyTable(){
  const q = (document.getElementById('company-search').value || '').trim().toLowerCase();
  const list = adminCompanies
    .filter(c => !q || (c.name || '').toLowerCase().includes(q) || (c.contact || '').toLowerCase().includes(q))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'));
  document.getElementById('company-count').textContent = '(' + adminCompanies.length + '곳)';
  const tbody = document.getElementById('company-table');
  tbody.innerHTML = list.length ? '' : '<tr><td colspan="7" style="color:var(--muted);cursor:default">' + (adminCompanies.length ? '찾는 회사가 없습니다.' : '등록된 회사가 없습니다. 아래에서 회사를 추가하세요.') + '</td></tr>';
  list.forEach(c => {
    const st = companyStats(c.id);
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td style="font-weight:600">' + escapeHtml(c.name) + '</td>' +
      '<td>' + escapeHtml(c.contact || '-') + '</td>' +
      '<td>' + st.trainees + '명</td>' +
      '<td>' + (st.waiting ? '<span class="badge warn">' + st.waiting + '명</span>' : '-') +
        (st.requests ? ' <span class="badge danger">승인 요청 ' + st.requests + '</span>' : '') + '</td>' +
      '<td>' + (st.tracks ? st.tracks + '개' : '') + (c.defaultTrackId ? '' : ' <span class="badge danger">기본 과정 없음</span>') + '</td>' +
      '<td>' + (st.managers ? st.managers + '명' : '-') + '</td>' +
      '<td style="color:var(--teal-dark);white-space:nowrap">관리 →</td>';
    tr.onclick = () => openAdminCompany(c.id);
    tbody.appendChild(tr);
  });
}
document.getElementById('company-search').oninput = renderCompanyTable;
document.getElementById('user-search').oninput = () => { if(userTableArgs) renderUserManageTable(...userTableArgs); };

// ---------- 이메일 인증 대체 승인 ----------
let adminJoinReqs = [];
function renderJoinRequests(selCo){
  const match = r => adminPending.find(x => x.id === r.email && x.active && !x.usedBy);
  // 홈: 어느 명단에도 없는 요청
  const orphans = adminJoinReqs.filter(r => !match(r));
  document.getElementById('orphan-req-card').classList.toggle('hidden', !orphans.length);
  document.getElementById('orphan-req-table').innerHTML = orphans.map(r =>
    '<tr><td>' + escapeHtml(r.name || '-') + '</td><td style="font-size:12px">' + escapeHtml(r.email) + '</td><td style="font-size:12px">' + kDateTime(tsDate(r.requestedAt)) + '</td>' +
    '<td><button class="ghost small-btn" data-jr-reject="' + r.id + '">반려</button></td></tr>').join('');
  // 회사 화면: 이 회사 명단과 일치하는 요청
  const mine = selCo ? adminJoinReqs.filter(r => { const p = match(r); return p && p.companyId === selCo.id; }) : [];
  document.getElementById('join-req-box').classList.toggle('hidden', !mine.length);
  document.getElementById('join-req-table').innerHTML = mine.map(r => {
    const p = match(r);
    return '<tr><td>' + escapeHtml(r.name || '-') + '</td><td style="font-size:12px">' + escapeHtml(r.email) + '</td><td>' + escapeHtml(p.inviteeName || '-') + '</td>' +
      '<td style="font-size:12px">' + kDateTime(tsDate(r.requestedAt)) + '</td>' +
      '<td style="white-space:nowrap"><button class="primary small-btn" data-jr-approve="' + r.id + '">승인</button> <button class="ghost small-btn" data-jr-reject="' + r.id + '">반려</button></td></tr>';
  }).join('');
}
document.addEventListener('click', async (ev) => {
  const b = ev.target.closest('button[data-jr-approve], button[data-jr-reject]');
  if(!b) return;
  const approve = !!b.dataset.jrApprove;
  const r = adminJoinReqs.find(x => x.id === (b.dataset.jrApprove || b.dataset.jrReject));
  if(!r) return;
  const p = adminPending.find(x => x.id === r.email && x.active && !x.usedBy);
  if(approve && !p){ alert('명단에서 이 이메일을 찾을 수 없습니다.'); return; }
  if(!confirm(approve
    ? r.email + ' (명단 이름: ' + (p.inviteeName || '-') + ')\n이메일 인증 없이 ' + p.companyName + ' 수강생으로 연결되도록 승인할까요?\n본인 여부를 회사 담당자에게 확인한 경우에만 승인하세요.'
    : r.email + ' 님의 승인 요청을 반려할까요?')) return;
  const TS = firebase.firestore.FieldValue.serverTimestamp();
  const by = { by: currentUser.uid, byName: (currentUserData && currentUserData.name) || currentUser.email };
  try{
    const batch = db.batch();
    batch.update(db.collection('joinRequests').doc(r.id), { status: approve ? 'approved' : 'rejected', decidedAt: TS, decidedBy: by.by, decidedByName: by.byName });
    if(approve) batch.update(db.collection('pending').doc(r.email), { approvedUid: r.id, approvedAt: TS, approvedBy: by.by, approvedByName: by.byName });
    await batch.commit();
    loadAdminView();
  } catch(e){ alert('처리 실패: ' + friendlyError(e)); }
});

function renderCompanyHeader(co){
  const st = companyStats(co.id);
  const def = co.defaultTrackId ? adminTracks.find(t => t.id === co.defaultTrackId) : null;
  document.getElementById('ac-name').textContent = co.name;
  document.getElementById('ac-meta').innerHTML =
    (co.contact ? '담당자 ' + escapeHtml(co.contact) + ' · ' : '') +
    '수강생 ' + st.trainees + '명 · 가입 대기 ' + st.waiting + '명 · 과정 ' + st.tracks + '개 · ' +
    (def ? '기본 과정: ' + escapeHtml(def.name) : '<span style="color:#b4531f">기본 과정 없음 — \'과정(커리큘럼)\' 탭에서 만드세요</span>');
}

// ================= 개인정보 파기 (메인 관리자) =================
// 서버 함수 purgeCompanyData가 실제 삭제를 담당 — 먼저 '파기 대상 확인'으로 건수를 본 뒤에만 실행 가능
const PURGE_LABELS = { accounts: '계정', progress: '강의 진도', submissions: '과제 제출', quizAttempts: '퀴즈 응시', quizState: '퀴즈 상태',
  consents: '동의 기록', joinRequests: '승인 요청', certificates: '이수확인서 발급', pending: '명단', invites: '초대 코드', tracks: '과정' };
let purgeCheckedFor = null;
function purgeCountsText(c){ return Object.keys(PURGE_LABELS).map(k => PURGE_LABELS[k] + ' ' + (c[k] || 0) + '건').join(' · '); }
document.getElementById('btn-purge-check').onclick = async (e) => {
  const btn = e.currentTarget, msg = document.getElementById('purge-msg');
  const cid = adminSelectedCompanyId;
  if(!cid){ msg.textContent = '회사를 먼저 선택하세요.'; return; }
  btn.disabled = true; msg.textContent = '확인 중…';
  try{
    const r = (await fx.httpsCallable('purgeCompanyData')({ companyId: cid, dryRun: true })).data;
    purgeCheckedFor = cid;
    document.getElementById('btn-purge-run').disabled = false;
    msg.textContent = '[' + r.companyName + '] 파기 대상\n' + purgeCountsText(r.counts);
  } catch(err){ msg.textContent = '확인 실패: ' + friendlyError(err); }
  finally{ btn.disabled = false; }
};
document.getElementById('btn-purge-run').onclick = async (e) => {
  const btn = e.currentTarget, msg = document.getElementById('purge-msg');
  const cid = adminSelectedCompanyId;
  if(!cid || purgeCheckedFor !== cid){ msg.textContent = "먼저 '파기 대상 확인'을 눌러 주세요."; btn.disabled = true; return; }
  const co = (typeof adminCompanies !== 'undefined' && adminCompanies.find(c => c.id === cid)) || {};
  const typed = prompt('되돌릴 수 없습니다. 확인을 위해 회사명을 정확히 입력하세요.\n\n' + (co.name || ''));
  if(typed === null) return;
  const reason = prompt('파기 사유를 적어 주세요 (예: 위탁계약 종료, 고객사 요청). 파기 기록에 남습니다.', '위탁계약 종료') || '';
  btn.disabled = true; msg.textContent = '파기 중… 창을 닫지 마세요.';
  try{
    const r = (await fx.httpsCallable('purgeCompanyData')({ companyId: cid, dryRun: false, confirmName: typed, reason })).data;
    purgeCheckedFor = null;
    alert('[' + r.companyName + '] 파기를 완료했습니다.\n' + purgeCountsText(r.counts) + '\n\n고객사에 파기 결과를 통지해 주세요 (위탁계약서 제8조 제3항).');
    adminSelectedCompanyId = null;
    loadAdminView();
  } catch(err){ msg.textContent = '파기 실패: ' + friendlyError(err); btn.disabled = false; }
};

// ================= 과정(커리큘럼) 관리 =================
let adminTracks = [], adminTemplates = [];
let curEdit = null; // { type: 'track' | 'template', id, companyId }
const TS_NOW = () => firebase.firestore.FieldValue.serverTimestamp();

function tracksOfCompany(cid){
  return adminTracks.filter(t => t.companyId === cid)
    .sort((a, b) => ((a.createdAt && a.createdAt.seconds) || 0) - ((b.createdAt && b.createdAt.seconds) || 0));
}
function courseUsage(){
  const u = {};
  const add = (cid, label) => { (u[cid] = u[cid] || []); if(!u[cid].includes(label)) u[cid].push(label); };
  adminTracks.forEach(t => (t.items || []).forEach(it => add(it.courseId, '[과정] ' + companyName(t.companyId) + ' · ' + t.name)));
  adminTemplates.forEach(t => (t.items || []).forEach(it => add(it.courseId, '[템플릿] ' + t.name)));
  return u;
}
function itemsStats(items){
  let min = 0; const weeks = {};
  (items || []).forEach(it => { const c = libraryById[it.courseId]; if(c) min += c.duration || 0; weeks[it.week] = (weeks[it.week] || 0) + 1; });
  return { count: (items || []).length, min, weeks };
}
function trackSelectHtml(u){
  const co = adminCompanies.find(c => c.id === u.companyId);
  const def = co && co.defaultTrackId ? adminTracks.find(t => t.id === co.defaultTrackId) : null;
  return '<select data-assign="' + u.id + '" style="margin:0;font-size:12px;padding:4px;max-width:160px">' +
    '<option value="">' + (def ? '기본: ' + escapeHtml(def.name) : '(기본 과정 없음)') + '</option>' +
    tracksOfCompany(u.companyId).map(t => '<option value="' + t.id + '"' + (u.trackId === t.id ? ' selected' : '') + '>' + escapeHtml(t.name) + '</option>').join('') +
    '</select>';
}

function renderCurriculumManager(){
  const sel = document.getElementById('cur-company');
  const prev = sel.value;
  sel.innerHTML = adminCompanies.length
    ? adminCompanies.map(c => '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>').join('')
    : '<option value="">먼저 회사를 추가하세요</option>';
  if(adminSelectedCompanyId) sel.value = adminSelectedCompanyId;
  else if(prev && adminCompanies.some(c => c.id === prev)) sel.value = prev;
  sel.onchange = renderCurriculumManager;
  const co = adminCompanies.find(c => c.id === sel.value);

  // 기존(주차·순서가 있는) 강의 → 기본 과정 전환 안내
  const legacy = courseCache.filter(c => c.week && c.order);
  document.getElementById('cur-migrate').classList.toggle('hidden',
    !(legacy.length && !adminTemplates.length && adminCompanies.some(c => !c.defaultTrackId)));

  // 회사의 과정 목록
  const listEl = document.getElementById('cur-track-list');
  const tracks = co ? tracksOfCompany(co.id) : [];
  listEl.innerHTML = tracks.length ? '' : '<p style="font-size:13px;color:var(--muted);margin:4px 0">이 회사에는 아직 과정이 없습니다. 첫 과정을 만들면 자동으로 기본 과정이 됩니다.</p>';
  tracks.forEach(t => {
    const isDef = co.defaultTrackId === t.id;
    const st = itemsStats(t.items);
    const direct = adminUsers.filter(u => u.role === 'trainee' && u.trackId === t.id).length;
    const viaDefault = isDef ? adminUsers.filter(u => u.role === 'trainee' && u.companyId === co.id && (!u.trackId || !adminTracks.some(x => x.id === u.trackId))).length : 0;
    const row = document.createElement('div');
    row.className = 'lecture';
    row.innerHTML =
      '<div><div class="title">' + escapeHtml(t.name) + ' <span class="badge">' + escapeHtml(t.kind || '') + '</span>' + (isDef ? ' <span class="badge ok">기본 과정</span>' : '') + '</div>' +
      '<div class="meta">' + st.count + '강 · ' + Object.keys(st.weeks).length + '주 · 총 ' + fmtDur(st.min * 60) + ' · 수강생 ' + (direct + viaDefault) + '명</div></div>' +
      '<div class="row" style="gap:6px">' +
        '<button class="ghost small-btn" data-tr-edit="' + t.id + '">편집</button>' +
        (isDef ? '' : '<button class="ghost small-btn" data-tr-default="' + t.id + '">기본으로 지정</button>') +
        '<button class="ghost small-btn" data-tr-del="' + t.id + '">삭제</button>' +
      '</div>';
    listEl.appendChild(row);
  });
  listEl.onclick = async (ev) => {
    const b = ev.target.closest('button');
    if(!b) return;
    const t = adminTracks.find(x => x.id === (b.dataset.trEdit || b.dataset.trDefault || b.dataset.trDel));
    if(!t) return;
    if(b.dataset.trEdit) return openCurEditor('track', t, t.companyId);
    if(b.dataset.trDefault){
      if(!confirm('"' + t.name + '"을(를) ' + co.name + '의 기본 과정으로 지정할까요?\n따로 과정이 배정되지 않은 수강생은 모두 이 과정을 수강하게 됩니다.')) return;
      const batch = db.batch();
      batch.update(db.collection('companies').doc(co.id), { defaultTrackId: t.id });
      batch.set(db.collection('tracks').doc(t.id).collection('history').doc(), historyEntry('회사 기본 과정으로 지정', t.name, t.kind, t.items, ''));
      await batch.commit();
      return loadAdminView();
    }
    if(b.dataset.trDel){
      const direct = adminUsers.filter(u => u.trackId === t.id).length;
      const pend = adminPending.filter(x => x.trackId === t.id && x.active).length;
      if(co.defaultTrackId === t.id){ alert('기본 과정은 삭제할 수 없습니다. 다른 과정을 기본으로 지정한 뒤 삭제하세요.'); return; }
      if(direct || pend){ alert('이 과정에 배정된 수강생 ' + direct + '명, 가입 대기 ' + pend + '명이 있어 삭제할 수 없습니다. 먼저 다른 과정으로 옮겨 주세요.'); return; }
      if(!confirm('"' + t.name + '" 과정을 삭제할까요? (구성 이력은 보존됩니다)')) return;
      await db.collection('tracks').doc(t.id).delete();
      if(curEdit && curEdit.id === t.id) closeCurEditor();
      return loadAdminView();
    }
  };

  // 템플릿 목록
  const tplSrc = document.getElementById('tpl-week-src');
  tplSrc.innerHTML = adminTemplates.map(t => '<option value="' + t.id + '">' + escapeHtml(t.name) + ' (' + ((t.items || []).length) + '강)</option>').join('');
  document.getElementById('tpl-week-wrap').classList.toggle('hidden', !adminTemplates.length);
  document.getElementById('btn-tpl-week-set').classList.toggle('hidden', !adminTemplates.length);
  const tplEl = document.getElementById('cur-template-list');
  tplEl.innerHTML = adminTemplates.length ? '' : '<p style="font-size:13px;color:var(--muted);margin:4px 0">템플릿이 없습니다.</p>';
  adminTemplates.forEach(t => {
    const st = itemsStats(t.items);
    const row = document.createElement('div');
    row.className = 'lecture';
    row.innerHTML = '<div><div class="title">' + escapeHtml(t.name) + (t.publicOnSite ? ' <span class="badge-pub">홈페이지 공개</span>' : '') + '</div><div class="meta">' + st.count + '강 · ' + Object.keys(st.weeks).length + '주 · 총 ' + fmtDur(st.min * 60) + (t.sampleFree ? ' · 샘플 공개' : '') + '</div></div>' +
      '<div class="row" style="gap:6px"><button class="ghost small-btn" data-tp-edit="' + t.id + '">편집</button><button class="ghost small-btn" data-tp-del="' + t.id + '">삭제</button></div>';
    tplEl.appendChild(row);
  });
  tplEl.onclick = async (ev) => {
    const b = ev.target.closest('button');
    if(!b) return;
    const t = adminTemplates.find(x => x.id === (b.dataset.tpEdit || b.dataset.tpDel));
    if(!t) return;
    if(b.dataset.tpEdit) return openCurEditor('template', t, null);
    if(!confirm('"' + t.name + '" 템플릿을 삭제할까요? (이미 만든 과정에는 영향 없음)')) return;
    await db.collection('templates').doc(t.id).delete();
    if(curEdit && curEdit.id === t.id) closeCurEditor();
    loadAdminView();
  };

  if(curEdit) renderPicker();
}

// 같은 강의 구성을 4주·6주·8주로 나눈 템플릿 3개를 한 번에 만듭니다
document.getElementById('btn-tpl-week-set').onclick = async (ev) => {
  const btn = ev.currentTarget, msg = document.getElementById('tpl-week-msg');
  msg.textContent = '';
  const src = adminTemplates.find(t => t.id === document.getElementById('tpl-week-src').value);
  if(!src || !(src.items || []).length){ msg.textContent = '강의가 들어 있는 템플릿을 골라 주세요.'; return; }
  const base = src.name.replace(/\s*\(\d+주\)\s*$/, '');
  if(!confirm('"' + base + '" 구성으로 4주·6주·8주 템플릿 3개를 만들까요?')) return;
  btn.disabled = true;
  try{
    const ordered = (src.items || []).slice().sort((a, b) => (a.week - b.week) || (a.order - b.order));
    for(const weeks of [4, 6, 8]){
      const per = Math.ceil(ordered.length / weeks);
      const items = ordered.map((it, i) => {
        const week = Math.min(weeks, Math.floor(i / per) + 1);
        return { courseId: it.courseId, week, order: i % per };
      });
      await db.collection('templates').add({ name: base + ' (' + weeks + '주)', items, createdAt: TS_NOW() });
    }
    msg.className = 'msg ok';
    msg.textContent = '4주·6주·8주 템플릿을 만들었습니다. 회사 화면의 과정 탭에서 불러와 쓰세요.';
    loadAdminView();
  } catch(err){ msg.className = 'msg'; msg.textContent = '만들지 못했습니다: ' + (err && err.message ? err.message : err); }
  finally{ btn.disabled = false; }
};

function historyEntry(action, name, kind, items, note){
  const st = itemsStats(items);
  return {
    at: TS_NOW(), by: currentUser.uid, byName: (currentUserData && currentUserData.name) || currentUser.email,
    action, name, kind: kind || '', itemCount: st.count, totalMin: st.min,
    items: (items || []).map(it => ({ courseId: it.courseId, week: it.week, order: it.order, title: libraryById[it.courseId] ? libraryById[it.courseId].title : '' })),
    note: note || ''
  };
}

// ---------- 과정/템플릿 편집기 ----------
const curItemsBody = document.getElementById('cur-items');
function curRows(){ return [...curItemsBody.querySelectorAll('tr')]; }
function rowWeek(r){ return parseInt(r.querySelector('input').value, 10) || 1; }

// 지금 목록의 강의를 고른 주 수에 고르게 나눠 배치합니다 (4·6·8주 과정)
function spreadWeeks(weeks){
  const rows = curRows();
  if(!rows.length) return 0;
  const per = Math.ceil(rows.length / weeks);
  rows.forEach((r, i) => { r.querySelector('input').value = Math.min(weeks, Math.floor(i / per) + 1); });
  curNormalize();
  return per;
}
document.getElementById('btn-cur-spread').onclick = () => {
  const weeks = parseInt(document.getElementById('cur-weeks').value, 10) || 4;
  const rows = curRows();
  if(!rows.length){ document.getElementById('cur-msg').textContent = '먼저 강의를 추가해 주세요.'; return; }
  const per = spreadWeeks(weeks);
  document.getElementById('cur-msg').textContent = weeks + '주 과정으로 다시 나눴습니다 (주당 최대 ' + per + '강). 저장을 눌러 주세요.';
};

function openCurEditor(type, doc, companyId){
  document.getElementById(type === 'track' ? 'editor-slot-track' : 'editor-slot-template').appendChild(document.getElementById('cur-editor'));
  curEdit = { type, id: doc ? doc.id : null, companyId };
  const isTrack = type === 'track';
  const firstTrack = isTrack && !doc && !tracksOfCompany(companyId).length;
  document.getElementById('cur-editor-title').textContent = isTrack
    ? (doc ? '과정 편집' : '새 과정') + ' — ' + companyName(companyId)
    : (doc ? '템플릿 편집' : '새 템플릿');
  document.getElementById('cur-name').value = doc ? doc.name : (firstTrack ? '기본 과정' : '');
  document.getElementById('cur-kind').value = doc && doc.kind ? doc.kind : '회사 공통';
  document.getElementById('cur-pacing').value = doc && doc.pacing === 'open' ? 'open' : 'weekly';
  document.getElementById('cur-start').value = (doc && doc.startDate) || '';
  document.getElementById('cur-pace-wrap').classList.toggle('hidden', type !== 'track');
  document.getElementById('cur-pace-help').classList.toggle('hidden', type !== 'track');
  document.getElementById('cur-kind-wrap').classList.toggle('hidden', !isTrack);
  document.getElementById('cur-note-wrap').classList.toggle('hidden', !isTrack);
  document.getElementById('btn-cur-save-as-template').classList.toggle('hidden', !isTrack);
  const fromWrap = document.getElementById('cur-from-template-wrap');
  fromWrap.classList.toggle('hidden', !isTrack || !adminTemplates.length);
  document.getElementById('cur-from-template').innerHTML = adminTemplates.map(t => '<option value="' + t.id + '">' + escapeHtml(t.name) + ' (' + (t.items || []).length + '강)</option>').join('');
  document.getElementById('cur-public-wrap').classList.toggle('hidden', isTrack);
  document.getElementById('cur-public').checked = !!(doc && doc.publicOnSite);
  document.getElementById('cur-sample').checked = !!(doc && doc.sampleFree);
  document.getElementById('cur-note').value = doc ? '' : '최초 구성';
  document.getElementById('cur-msg').textContent = '';
  curItemsBody.innerHTML = '';
  ((doc && doc.items) || []).slice().sort((a, b) => (a.week - b.week) || (a.order - b.order))
    .forEach(it => addCurItem(it.courseId, it.week, true));
  curNormalize();
  const maxWeek = Math.max(1, ...curRows().map(rowWeek));
  document.getElementById('cur-weeks').value = [4, 6, 8].includes(maxWeek) ? String(maxWeek) : '4';
  renderCurAssignments();
  document.getElementById('cur-editor').classList.remove('hidden');
  document.getElementById('cur-editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function closeCurEditor(){ curEdit = null; document.getElementById('cur-editor').classList.add('hidden'); }

function addCurItem(courseId, week, silent){
  const c = libraryById[courseId];
  const tr = document.createElement('tr');
  tr.dataset.course = courseId;
  tr.innerHTML =
    '<td><input type="number" min="1" value="' + (week || 1) + '"></td>' +
    '<td class="ord" style="text-align:center;padding-top:9px;font-size:13px"></td>' +
    '<td style="padding:8px;font-size:13px">' + (c ? escapeHtml(c.title) + (c.category ? ' <span style="color:var(--muted);font-size:11px">' + escapeHtml(c.category) + '</span>' : '') : '<span style="color:#b4531f">(보관함에서 삭제된 강의)</span>') + '</td>' +
    '<td style="padding:8px;font-size:12px;white-space:nowrap">' + (c && c.duration ? c.duration + '분' : '-') + '</td>' +
    '<td class="del" style="white-space:nowrap;width:96px"><button data-mv="-1" title="위로">↑</button><button data-mv="1" title="아래로">↓</button><button data-rm="1" title="빼기">×</button></td>';
  curItemsBody.appendChild(tr);
  if(!silent) curNormalize();
}

// 주차 순으로 정렬(같은 주차 안에서는 현재 순서 유지) 후 순서 번호를 다시 매김
function curNormalize(){
  const rows = curRows();
  rows.forEach((r, i) => { r._i = i; });
  rows.sort((a, b) => (rowWeek(a) - rowWeek(b)) || (a._i - b._i)).forEach(r => curItemsBody.appendChild(r));
  let lastW = null, o = 0;
  rows.forEach(r => { const w = rowWeek(r); if(w !== lastW){ lastW = w; o = 0; } o++; r.querySelector('.ord').textContent = o; });
  const st = itemsStats(curCollectItems());
  document.getElementById('cur-summary').textContent = st.count
    ? '총 ' + st.count + '강 · ' + fmtDur(st.min * 60) + ' — ' + Object.keys(st.weeks).sort((a, b) => a - b).map(w => w + '주 ' + st.weeks[w] + '강').join(' · ')
    : '아래 보관함에서 강의를 골라 추가하세요.';
  renderPicker();
}
function curCollectItems(){
  return curRows().map(r => ({ courseId: r.dataset.course, week: rowWeek(r), order: parseInt(r.querySelector('.ord').textContent, 10) || 1 }));
}

curItemsBody.addEventListener('change', (ev) => { if(ev.target.matches('input')) curNormalize(); });
curItemsBody.addEventListener('click', (ev) => {
  const b = ev.target.closest('button');
  if(!b) return;
  const tr = b.closest('tr');
  if(b.dataset.rm){ tr.remove(); return curNormalize(); }
  const dir = parseInt(b.dataset.mv, 10);
  const other = dir < 0 ? tr.previousElementSibling : tr.nextElementSibling;
  if(!other || rowWeek(other) !== rowWeek(tr)) return; // 같은 주차 안에서만 이동 (주차 변경은 주차 칸 수정)
  if(dir < 0) curItemsBody.insertBefore(tr, other); else curItemsBody.insertBefore(other, tr);
  curNormalize();
});

function renderPicker(){
  const q = document.getElementById('cur-search').value.trim().toLowerCase();
  const cf = document.getElementById('cur-cat-filter').value;
  const inTrack = new Set(curRows().map(r => r.dataset.course));
  const box = document.getElementById('cur-picker');
  const known = new Set(catNames());
  const list = courseCache.filter(c => (!q || (c.title || '').toLowerCase().includes(q)) &&
    (!cf || (cf === '__none__' ? !known.has(c.category) : c.category === cf)))
    .sort((a, b) => catIndex(a.category) - catIndex(b.category) || (a.title || '').localeCompare(b.title || '', 'ko'));
  if(!list.length){
    box.innerHTML = '<p style="font-size:13px;color:var(--muted);padding:8px 10px;margin:0">' + (courseCache.length ? '찾는 강의가 없습니다.' : '보관함에 강의를 먼저 등록하세요.') + '</p>';
    return;
  }
  let html = '', last = null;
  list.forEach(c => {
    const g = known.has(c.category) ? c.category : UNCAT;
    if(g !== last){
      last = g;
      html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background:var(--paper);font-size:12px;font-weight:600;position:sticky;top:0">' +
        '<span>' + escapeHtml(g) + '</span><button class="ghost small-btn" data-pick-all="' + escapeHtml(g) + '" style="padding:2px 8px">이 카테고리 전체 선택</button></div>';
    }
    html += '<label data-g="' + escapeHtml(g) + '" style="display:flex;gap:8px;align-items:center;padding:6px 10px;border-bottom:1px solid var(--line);margin:0;font-size:13px;color:var(--ink);cursor:pointer' + (inTrack.has(c.id) ? ';opacity:.45' : '') + '">' +
      '<input type="checkbox" data-pick="' + c.id + '" style="width:auto;margin:0"' + (inTrack.has(c.id) ? ' disabled' : '') + '>' +
      '<span style="flex:1">' + escapeHtml(c.title) + (inTrack.has(c.id) ? ' <span style="font-size:11px">(이미 포함)</span>' : '') + '</span>' +
      '<span style="font-size:11px;color:var(--muted);width:44px;text-align:right">' + (c.duration || '-') + '분</span></label>';
  });
  box.innerHTML = html;
  box.querySelectorAll('button[data-pick-all]').forEach(b => {
    b.onclick = (ev) => {
      ev.preventDefault();
      box.querySelectorAll('label[data-g="' + CSS.escape(b.dataset.pickAll) + '"] input:not(:disabled)').forEach(i => { i.checked = true; });
    };
  });
}
document.getElementById('cur-cat-filter').onchange = renderPicker;
document.getElementById('cur-search').oninput = renderPicker;

document.getElementById('btn-cur-add-selected').onclick = () => {
  const week = parseInt(document.getElementById('cur-add-week').value, 10) || 1;
  const picked = [...document.querySelectorAll('#cur-picker input[data-pick]:checked')].map(i => i.dataset.pick);
  if(!picked.length){ document.getElementById('cur-msg').textContent = '추가할 강의를 선택하세요.'; return; }
  document.getElementById('cur-msg').textContent = '';
  picked.forEach(id => addCurItem(id, week, true));
  curNormalize();
};

document.getElementById('btn-cur-load-template').onclick = () => {
  const t = adminTemplates.find(x => x.id === document.getElementById('cur-from-template').value);
  if(!t) return;
  if(curRows().length && !confirm('현재 구성을 지우고 "' + t.name + '" 템플릿 구성으로 바꿀까요?')) return;
  curItemsBody.innerHTML = '';
  (t.items || []).slice().sort((a, b) => (a.week - b.week) || (a.order - b.order)).forEach(it => addCurItem(it.courseId, it.week, true));
  if(!document.getElementById('cur-name').value.trim()) document.getElementById('cur-name').value = t.name;
  const note = document.getElementById('cur-note');
  note.value = (note.value ? note.value + ' / ' : '') + '템플릿 "' + t.name + '" 적용';
  curNormalize();
};

document.getElementById('btn-cur-cancel').onclick = closeCurEditor;
document.getElementById('btn-cur-new-track').onclick = () => {
  const cid = document.getElementById('cur-company').value;
  if(!cid){ alert('회사를 먼저 추가·선택하세요.'); return; }
  openCurEditor('track', null, cid);
};
document.getElementById('btn-cur-new-template').onclick = () => openCurEditor('template', null, null);

document.getElementById('btn-cur-save').onclick = async () => {
  const msgEl = document.getElementById('cur-msg');
  msgEl.style.color = ''; msgEl.textContent = '';
  if(!curEdit) return;
  const name = document.getElementById('cur-name').value.trim();
  const kind = document.getElementById('cur-kind').value;
  const items = curCollectItems();
  if(!name){ msgEl.textContent = '이름을 입력하세요.'; return; }
  if(!items.length){ msgEl.textContent = '강의를 1개 이상 넣어 주세요.'; return; }
  if(items.some(it => !libraryById[it.courseId])){ msgEl.textContent = '보관함에서 삭제된 강의가 있습니다. ×로 빼 주세요.'; return; }
  const btn = document.getElementById('btn-cur-save');
  btn.disabled = true;
  try{
    const batch = db.batch();
    if(curEdit.type === 'track'){
      const isNew = !curEdit.id;
      const ref = isNew ? db.collection('tracks').doc() : db.collection('tracks').doc(curEdit.id);
      const pacing = document.getElementById('cur-pacing').value;
      const startDate = document.getElementById('cur-start').value || null;
      const data = { companyId: curEdit.companyId, name, kind, items, pacing, startDate, updatedAt: TS_NOW() };
      if(isNew) data.createdAt = TS_NOW();
      batch.set(ref, data, { merge: true });
      batch.set(ref.collection('history').doc(), Object.assign(
        historyEntry(isNew ? '과정 생성' : '과정 수정', name, kind, items, document.getElementById('cur-note').value.trim()),
        { pacing, startDate }));
      const co = adminCompanies.find(c => c.id === curEdit.companyId);
      if(isNew && co && !co.defaultTrackId) batch.update(db.collection('companies').doc(co.id), { defaultTrackId: ref.id });
      await batch.commit();
      curEdit.id = ref.id;
      document.getElementById('cur-editor-title').textContent = '과정 편집 — ' + companyName(curEdit.companyId);
      renderCurAssignments();
    } else {
      const ref = curEdit.id ? db.collection('templates').doc(curEdit.id) : db.collection('templates').doc();
      const publicOnSite = document.getElementById('cur-public').checked;
      const data = { name, items, publicOnSite, sampleFree: document.getElementById('cur-sample').checked, updatedAt: TS_NOW() };
      // 홈페이지에 공개되는 구성은 하나만 두도록, 다른 템플릿의 공개 표시는 내립니다
      if(publicOnSite) adminTemplates.filter(t => t.publicOnSite && t.id !== ref.id)
        .forEach(t => batch.update(db.collection('templates').doc(t.id), { publicOnSite: false }));
      if(!curEdit.id) data.createdAt = TS_NOW();
      await ref.set(data, { merge: true });
      curEdit.id = ref.id;
      document.getElementById('cur-editor-title').textContent = '템플릿 편집';
    }
    document.getElementById('cur-note').value = '';
    msgEl.style.color = 'var(--teal-dark)';
    msgEl.textContent = '저장했습니다.';
    loadAdminView();
  } catch(e){ msgEl.textContent = '저장 실패: ' + friendlyError(e); }
  finally{ btn.disabled = false; }
};

document.getElementById('btn-cur-save-as-template').onclick = async () => {
  const items = curCollectItems();
  if(!items.length) return;
  const name = prompt('템플릿 이름', document.getElementById('cur-name').value.trim());
  if(!name) return;
  try{
    await db.collection('templates').add({ name: name.trim(), items, createdAt: TS_NOW(), updatedAt: TS_NOW() });
    const m = document.getElementById('cur-msg'); m.style.color = 'var(--teal-dark)'; m.textContent = '템플릿 "' + name.trim() + '"으로 저장했습니다.';
    loadAdminView();
  } catch(e){ document.getElementById('cur-msg').textContent = '저장 실패: ' + friendlyError(e); }
};

// 기존 강의(주차·순서 포함) → 기본 과정 템플릿 + 기본 과정이 없는 모든 회사에 적용
document.getElementById('btn-cur-migrate').onclick = async () => {
  const legacy = courseCache.filter(c => c.week && c.order).sort((a, b) => (a.week - b.week) || (a.order - b.order));
  const items = legacy.map(c => ({ courseId: c.id, week: c.week, order: c.order }));
  const targets = adminCompanies.filter(c => !c.defaultTrackId);
  if(!confirm('기존 ' + items.length + '개 강의 구성으로 "기본 과정" 템플릿을 만들고, ' + targets.length + '개 회사에 기본 과정으로 적용할까요?')) return;
  const btn = document.getElementById('btn-cur-migrate');
  btn.disabled = true;
  try{
    const batch = db.batch();
    batch.set(db.collection('templates').doc(), { name: '기본 과정', items, createdAt: TS_NOW(), updatedAt: TS_NOW() });
    targets.forEach(co => {
      const ref = db.collection('tracks').doc();
      batch.set(ref, { companyId: co.id, name: '기본 과정', kind: '회사 공통', items, createdAt: TS_NOW(), updatedAt: TS_NOW() });
      batch.set(ref.collection('history').doc(), historyEntry('과정 생성', '기본 과정', '회사 공통', items, '기존 강의 구성으로 자동 생성'));
      batch.update(db.collection('companies').doc(co.id), { defaultTrackId: ref.id });
    });
    await batch.commit();
    loadAdminView();
  } catch(e){ alert('처리 실패: ' + friendlyError(e)); }
  finally{ btn.disabled = false; }
};

// ---------- 메인 관리자: 수강생 명단 등록 ----------
// pending/{이메일(소문자)}: { companyId, companyName, inviteeName, email, active, createdAt, createdBy, usedBy?, usedAt? }
let adminCompanies = [], adminUsers = [], adminInvites = [], adminPending = [];
const SITE_URL = APP_URL;
// Firebase 인증 메일 발신 주소 (Authentication → 템플릿 → SMTP 설정과 같게 유지)
const VERIFY_SENDER = 'sh.lee@cnlcg.co.kr';

// 네이버웍스로 일괄 발송할 안내 메일 — 모든 대상자에게 같은 내용
function rosterMailText(companyName){
  const subject = '[' + companyName + '] CNL Works PIP 수강 안내';
  const body =
    '안녕하십니까.\n\n' +
    companyName + '에서 귀하를 CNL Works PIP 수강 대상자로 등록하였습니다.\n' +
    '아래 순서에 따라 가입하신 뒤 수강을 시작해 주시기 바랍니다.\n\n' +
    '1. 접속: ' + SITE_URL + '\n' +
    '2. [회원가입]에서 이름, 이 메일을 받으신 이메일 주소, 비밀번호를 입력 (초대 코드 칸은 비워 두세요)\n' +
    '3. 가입 직후 ' + VERIFY_SENDER + ' 주소에서 발송되는 인증 메일의 링크를 누른 뒤, 사이트로 돌아와 [인증 완료했어요]를 누르면 수강 화면이 열립니다.\n' +
    '   (인증 메일이 오지 않으면 인증 화면의 [인증 메일이 오지 않아요] 버튼으로 승인을 요청해 주세요.)\n\n' +
    '※ 회사에 등록된 이메일 주소로만 가입할 수 있습니다.\n' +
    '※ 가입 이후에는 같은 주소에서 이메일과 비밀번호로 로그인하시면 됩니다.\n\n' +
    '문의: 회사 인사 담당자';
  return { subject, body };
}

function loadScriptOnce(src){
  return new Promise((resolve, reject) => {
    if(document.querySelector('script[src="' + src + '"]')) return resolve();
    const el = document.createElement('script');
    el.src = src; el.onload = resolve; el.onerror = () => reject(new Error('라이브러리를 불러오지 못했습니다.'));
    document.head.appendChild(el);
  });
}
async function ensureXLSX(){
  if(!window.XLSX) await loadScriptOnce('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
  return window.XLSX;
}

function selectedCompany(){ return adminCompanies.find(c => c.id === document.getElementById('inv-company').value); }
function rosterOf(companyId){
  return adminPending.filter(x => x.companyId === companyId)
    .sort((a, b) => ((b.createdAt && b.createdAt.seconds) || 0) - ((a.createdAt && a.createdAt.seconds) || 0));
}
function rosterStatus(x){ return x.usedBy ? 'joined' : x.active ? 'waiting' : 'canceled'; }
const ROSTER_LABEL = { joined: '가입 완료', waiting: '미가입', canceled: '취소됨' };
function fmtDate(t){ return t && t.seconds ? new Date(t.seconds * 1000).toLocaleString('ko-KR') : ''; }

function renderRoster(){
  const sel = document.getElementById('inv-company');
  const prev = sel.value;
  sel.innerHTML = adminCompanies.length
    ? adminCompanies.map(c => '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>').join('')
    : '<option value="">먼저 회사를 추가하세요</option>';
  if(adminSelectedCompanyId) sel.value = adminSelectedCompanyId;
  else if(prev && adminCompanies.some(c => c.id === prev)) sel.value = prev;
  sel.onchange = renderRoster;

  // 배정할 과정 (비우면 회사 기본 과정)
  const trackSel = document.getElementById('inv-track');
  const prevTrack = trackSel.value;
  const co = adminCompanies.find(c => c.id === sel.value);
  const def = co && co.defaultTrackId ? adminTracks.find(t => t.id === co.defaultTrackId) : null;
  const ctracks = tracksOfCompany(sel.value);
  trackSel.innerHTML = '<option value="">' + (def ? '회사 기본 과정 (' + escapeHtml(def.name) + ')' : '회사 기본 과정 (아직 없음)') + '</option>' +
    ctracks.map(t => '<option value="' + t.id + '">' + escapeHtml(t.name) + ' · ' + escapeHtml(t.kind || '') + '</option>').join('');
  if(prevTrack && ctracks.some(t => t.id === prevTrack)) trackSel.value = prevTrack;
  const trackName = id => { const t = adminTracks.find(x => x.id === id); return t ? t.name : (def ? '기본: ' + def.name : '기본'); };

  const tbody = document.getElementById('inv-table');
  const list = rosterOf(sel.value);
  tbody.innerHTML = list.length ? '' : '<tr><td colspan="6" style="color:var(--muted)">등록된 명단이 없습니다.</td></tr>';
  list.forEach(x => {
    const st = rosterStatus(x);
    const badge = st === 'joined' ? 'ok' : st === 'waiting' ? 'warn' : '';
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' + escapeHtml(x.inviteeName || '-') + '</td>' +
      '<td style="font-size:12px">' + escapeHtml(x.email || x.id) + '</td>' +
      '<td style="font-size:12px">' + (st === 'waiting'
        ? '<select data-ptrack="' + escapeHtml(x.id) + '" style="margin:0;font-size:12px;padding:4px"><option value="">' + (def ? '기본: ' + escapeHtml(def.name) : '기본') + '</option>' +
          ctracks.map(t => '<option value="' + t.id + '"' + (x.trackId === t.id ? ' selected' : '') + '>' + escapeHtml(t.name) + '</option>').join('') + '</select>'
        : escapeHtml(trackName(x.trackId))) + '</td>' +
      '<td><span class="badge ' + badge + '">' + ROSTER_LABEL[st] + '</span>' +
        (st === 'joined' ? '<div style="font-size:11px;color:var(--muted)">' + fmtDate(x.usedAt) + '</div>' : '') + '</td>' +
      '<td style="font-size:12px">' + fmtDate(x.createdAt).split(' ').slice(0, 3).join(' ') + '</td>' +
      '<td>' + (st === 'waiting' ? '<button class="ghost small-btn" data-roster="cancel" data-email="' + escapeHtml(x.id) + '">취소</button>' : '') + '</td>';
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('select[data-ptrack]').forEach(ps => {
    ps.onchange = async () => {
      try{ await db.collection('pending').doc(ps.getAttribute('data-ptrack')).update({ trackId: ps.value || null }); loadAdminView(); }
      catch(e){ document.getElementById('inv-msg').textContent = '과정 변경 실패: ' + friendlyError(e); }
    };
  });
}

// ---------- 명단 입력 표 (이름 / 이메일) ----------
const rgBody = document.getElementById('roster-grid');
const RG_COLS = ['name', 'email'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function rgRows(){ return [...rgBody.querySelectorAll('tr.data')]; }
function rgEmpty(tr){ const i = tr.querySelectorAll('input'); return !i[0].value.trim() && !i[1].value.trim(); }

function addRgRow(v){
  v = v || {};
  const tr = document.createElement('tr');
  tr.className = 'data';
  tr.innerHTML =
    '<td class="rn"></td>' +
    '<td><input type="text" data-col="name" placeholder="이름"></td>' +
    '<td><input type="email" data-col="email" placeholder="name@company.com"></td>' +
    '<td class="del"><button title="이 행 삭제" tabindex="-1">×</button></td>';
  if(v.name != null) tr.querySelector('input[data-col="name"]').value = v.name;
  if(v.email != null) tr.querySelector('input[data-col="email"]').value = v.email;
  tr.querySelector('.del button').onclick = () => {
    const n = tr.nextElementSibling;
    if(n && n.classList.contains('note-row')) n.remove();
    tr.remove();
    if(!rgRows().length) addRgRow();
    rgRenumber();
  };
  rgBody.appendChild(tr);
  rgRenumber();
  return tr;
}
function rgRenumber(){
  const rows = rgRows();
  rows.forEach((tr, i) => { tr.querySelector('.rn').textContent = i + 1; });
  const n = rows.filter(tr => !rgEmpty(tr)).length;
  document.getElementById('rg-count').textContent = n ? '입력된 인원 ' + n + '명' : '';
}
function resetRg(n){
  rgBody.querySelectorAll('tr.data, tr.note-row').forEach(r => r.remove());
  for(let i = 0; i < (n || 5); i++) addRgRow();
}
function clearRgMarks(){
  rgBody.querySelectorAll('tr.note-row').forEach(r => r.remove());
  rgRows().forEach(tr => { tr.classList.remove('bad'); tr.style.background = ''; tr.querySelectorAll('input.err').forEach(i => i.classList.remove('err')); });
}
function markRg(tr, cols, note, warnOnly){
  if(!warnOnly) tr.classList.add('bad');
  cols.forEach(c => tr.querySelector('input[data-col="' + c + '"]').classList.add('err'));
  const nr = document.createElement('tr');
  nr.className = 'note-row';
  nr.innerHTML = '<td></td><td colspan="3" class="grid-note"' + (warnOnly ? ' style="color:var(--muted)"' : '') + '>' + escapeHtml(note) + '</td>';
  tr.after(nr);
}

// 엑셀에서 여러 칸 붙여넣기 (이메일·이름 순서가 바뀌어 있어도 자동 인식)
rgBody.addEventListener('paste', (ev) => {
  const input = ev.target.closest('input');
  if(!input) return;
  const text = (ev.clipboardData || window.clipboardData).getData('text');
  if(!/[\t\n]/.test(text.trim())) return;
  ev.preventDefault();
  const lines = text.replace(/\r/g, '').replace(/\n+$/, '').split('\n').map(l => l.split('\t').map(x => x.trim()));
  let tr = input.closest('tr');
  const startCol = RG_COLS.indexOf(input.getAttribute('data-col'));
  lines.forEach((cells, li) => {
    if(li > 0){
      let n = tr.nextElementSibling;
      while(n && !n.classList.contains('data')) n = n.nextElementSibling;
      tr = n || addRgRow();
    }
    const ins = tr.querySelectorAll('input');
    if(startCol === 0 && cells.length >= 2){
      const emailCell = cells.find(c => c.includes('@')) || '';
      const nameCell = cells.find(c => c && !c.includes('@') && !/^\d+$/.test(c)) || '';
      ins[0].value = nameCell; ins[1].value = emailCell;
    } else {
      cells.forEach((c, ci) => { const idx = startCol + ci; if(idx < ins.length) ins[idx].value = c; });
    }
  });
  rgRenumber();
});
rgBody.addEventListener('input', (ev) => {
  const tr = ev.target.closest('tr.data');
  if(tr){ tr.classList.remove('bad'); tr.querySelectorAll('input.err').forEach(i => i.classList.remove('err'));
    const n = tr.nextElementSibling; if(n && n.classList.contains('note-row')) n.remove(); }
  rgRenumber();
});
rgBody.addEventListener('keydown', (ev) => {
  if(ev.key !== 'Enter') return;
  const input = ev.target.closest('input');
  if(!input) return;
  ev.preventDefault();
  const tr = input.closest('tr');
  // 이름 칸에서 Enter → 같은 줄 이메일, 이메일 칸에서 Enter → 다음 줄 이름
  if(input.dataset.col === 'name') return tr.querySelector('input[data-col="email"]').focus();
  let next = tr.nextElementSibling;
  while(next && !next.classList.contains('data')) next = next.nextElementSibling;
  if(!next) next = addRgRow();
  next.querySelector('input[data-col="name"]').focus();
});
document.getElementById('btn-rg-add5').onclick = () => { for(let i = 0; i < 5; i++) addRgRow(); };
document.getElementById('btn-rg-clear').onclick = () => { if(confirm('표의 내용을 모두 지울까요?')) resetRg(5); };
document.getElementById('btn-rg-template').onclick = async () => {
  try{
    const XLSX = await ensureXLSX();
    const ws = XLSX.utils.aoa_to_sheet([
      ['이름', '이메일'],
      ['[안내] 대상자 실명', '[안내] 회사 이메일 (이 주소로만 가입 가능)'],
      ['홍길동', 'hong@company.com']
    ]);
    ws['!cols'] = [{ wch: 18 }, { wch: 40 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '명단');
    XLSX.writeFile(wb, '수강생_명단_양식.xlsx');
  } catch(e){ document.getElementById('inv-msg').textContent = '양식 만들기 실패: ' + e.message; }
};

// 엑셀/CSV: 이메일이 들어 있는 행만 골라 표에 채움 (등록 전 확인용)
document.getElementById('inv-file').onchange = async (ev) => {
  const file = ev.target.files[0];
  const msgEl = document.getElementById('inv-msg');
  msgEl.style.color = ''; msgEl.textContent = '';
  if(!file) return;
  try{
    const XLSX = await ensureXLSX();
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
    const people = [];
    rows.forEach(r => {
      const cells = r.map(v => String(v).trim()).filter(Boolean);
      const email = cells.find(v => v.includes('@'));
      if(!email || cells[0].startsWith('[안내]')) return; // 머리글·안내 행 건너뜀
      const name = cells.find(v => !v.includes('@') && !/^\d+$/.test(v)) || '';
      people.push({ name, email });
    });
    if(!people.length){ msgEl.textContent = '이메일이 들어 있는 행을 찾지 못했습니다.'; return; }
    rgBody.querySelectorAll('tr.data, tr.note-row').forEach(r => r.remove());
    people.forEach(p => addRgRow(p));
    msgEl.style.color = 'var(--teal-dark)';
    msgEl.textContent = file.name + '에서 ' + people.length + '명을 읽었습니다. 표를 확인한 뒤 [명단 등록]을 누르세요.';
  } catch(e){ msgEl.textContent = '파일을 읽지 못했습니다: ' + e.message; }
  ev.target.value = '';
};

resetRg(5);

document.getElementById('btn-inv-create').onclick = async () => {
  const msgEl = document.getElementById('inv-msg');
  msgEl.style.color = ''; msgEl.textContent = '';
  const co = selectedCompany();
  if(!co){ msgEl.textContent = '회사를 선택하세요.'; return; }
  clearRgMarks();

  // 1) 형식 검사 — 틀린 칸은 붉게 표시하고 등록 중단
  const rows = [];
  let bad = 0;
  const seenInTable = {};
  rgRows().forEach(tr => {
    if(rgEmpty(tr)) return;
    const name = tr.querySelector('input[data-col="name"]').value.trim();
    const email = tr.querySelector('input[data-col="email"]').value.trim().toLowerCase();
    const cols = [], notes = [];
    if(!name){ cols.push('name'); notes.push('이름 필요'); }
    if(!EMAIL_RE.test(email)){ cols.push('email'); notes.push('이메일 형식이 올바르지 않음'); }
    else if(seenInTable[email]){ cols.push('email'); notes.push('표 안에서 같은 이메일이 중복됨'); }
    if(email) seenInTable[email] = true;
    if(cols.length){ bad++; markRg(tr, cols, notes.join(' · ')); return; }
    rows.push({ name, email, tr });
  });
  if(bad){ msgEl.textContent = bad + '개 행을 확인해 주세요 (붉게 표시된 칸).'; return; }
  if(!rows.length){ msgEl.textContent = '이름과 이메일을 입력하세요.'; return; }
  if(rows.length > 500){ msgEl.textContent = '한 번에 500명까지 가능합니다.'; return; }

  const activeUsers = adminUsers.filter(u => u.status !== 'withdrawn');
  const withdrawnUids = new Set(adminUsers.filter(u => u.status === 'withdrawn').map(u => u.id));
  const userEmails = new Set(activeUsers.map(u => (u.email || '').toLowerCase()));
  const byEmail = {};
  adminPending.forEach(x => { byEmail[x.id] = x; });
  const skipped = [], targets = [];
  rows.forEach(r => {
    const ex = byEmail[r.email];
    let why = '';
    if(userEmails.has(r.email) || (ex && ex.usedBy && !withdrawnUids.has(ex.usedBy))) why = '이미 가입한 계정';
    else if(ex && ex.active) why = ex.companyId === co.id ? '이미 이 회사 명단에 있음' : '다른 회사 명단에 등록됨: ' + ex.companyName;
    if(why){ skipped.push(r.email + '(' + why + ')'); markRg(r.tr, ['email'], '제외: ' + why, true); }
    else targets.push(r); // 신규 또는 취소됐던 명단은 다시 등록
  });
  if(!targets.length){ msgEl.textContent = '새로 등록할 대상이 없습니다: ' + skipped.join(', '); return; }
  if(!confirm('[' + co.name + '] ' + targets.length + '명을 수강생 명단에 등록합니다.' +
    (skipped.length ? '\n제외 ' + skipped.length + '명: ' + skipped.slice(0, 5).join(', ') + (skipped.length > 5 ? ' 등' : '') : '') + '\n계속할까요?')) return;

  const btn = document.getElementById('btn-inv-create');
  btn.disabled = true;
  let done = 0;
  try{
    for(let i = 0; i < targets.length; i += 100){
      const batch = db.batch();
      targets.slice(i, i + 100).forEach(t => {
        batch.set(db.collection('pending').doc(t.email), {
          companyId: co.id, companyName: co.name, inviteeName: t.name, email: t.email, active: true,
          trackId: document.getElementById('inv-track').value || null,
          createdBy: currentUser.uid, createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      });
      await batch.commit();
      done += Math.min(100, targets.length - i);
    }
    resetRg(5);
    msgEl.style.color = 'var(--teal-dark)';
    msgEl.textContent = done + '명 등록 완료. 아래 ①② 버튼으로 네이버웍스 안내 메일을 보내세요.' + (skipped.length ? ' (제외: ' + skipped.join(', ') + ')' : '');
  } catch(e){
    msgEl.textContent = '등록 실패 (' + done + '명까지 완료): ' + friendlyError(e);
  } finally {
    btn.disabled = false;
    loadAdminView();
  }
};

document.getElementById('inv-table').onclick = async (ev) => {
  const btn = ev.target.closest('button[data-roster]');
  if(!btn) return;
  const email = btn.getAttribute('data-email');
  const x = adminPending.find(p => p.id === email);
  if(!x || !confirm((x.inviteeName || email) + ' 님을 명단에서 취소할까요? 이 이메일로는 가입해도 회사에 연결되지 않습니다.')) return;
  try{
    await db.collection('pending').doc(email).update({ active: false });
    loadAdminView();
  } catch(e){ document.getElementById('inv-msg').textContent = '취소 실패: ' + friendlyError(e); }
};

async function copyWithNotice(text, okMsg){
  const msgEl = document.getElementById('inv-msg');
  await navigator.clipboard.writeText(text);
  msgEl.style.color = 'var(--teal-dark)';
  msgEl.textContent = okMsg;
  setTimeout(() => { msgEl.style.color = ''; msgEl.textContent = ''; }, 5000);
}

document.getElementById('btn-inv-copy-to').onclick = async () => {
  const co = selectedCompany();
  if(!co) return;
  const waiting = rosterOf(co.id).filter(x => rosterStatus(x) === 'waiting');
  if(!waiting.length){ document.getElementById('inv-msg').textContent = '미가입 상태인 대상자가 없습니다.'; return; }
  await copyWithNotice(waiting.map(x => x.email || x.id).join(', '),
    waiting.length + '명의 주소를 복사했습니다. 네이버웍스 받는 사람 칸에 붙여넣고, 개인별 발송을 켜세요.');
};

document.getElementById('btn-inv-copy-mail').onclick = async () => {
  const co = selectedCompany();
  if(!co) return;
  const m = rosterMailText(co.name);
  await copyWithNotice('제목: ' + m.subject + '\n\n' + m.body, '안내 메일 문안(제목 포함)을 복사했습니다.');
};

async function downloadRosterXlsx(onlyWaiting){
  const co = selectedCompany();
  if(!co) return;
  try{
    const XLSX = await ensureXLSX();
    const list = rosterOf(co.id).filter(x => !onlyWaiting || rosterStatus(x) === 'waiting');
    const rows = onlyWaiting
      ? [['이름', '이메일']].concat(list.map(x => [x.inviteeName || '', x.email || x.id]))
      : [['이름', '이메일', '상태', '명단 등록일시', '가입일시']].concat(list.map(x =>
          [x.inviteeName || '', x.email || x.id, ROSTER_LABEL[rosterStatus(x)], fmtDate(x.createdAt), fmtDate(x.usedAt)]));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), onlyWaiting ? '주소록' : '수강생 현황');
    XLSX.writeFile(wb, co.name + (onlyWaiting ? '_미가입자_주소록.xlsx' : '_수강생_명단현황.xlsx'));
  } catch(e){ document.getElementById('inv-msg').textContent = '다운로드 실패: ' + e.message; }
}
document.getElementById('btn-inv-xlsx-book').onclick = () => downloadRosterXlsx(true);
document.getElementById('btn-inv-xlsx-all').onclick = () => downloadRosterXlsx(false);

function escapeHtml(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function escapeAttr(s){ return escapeHtml(s); }
