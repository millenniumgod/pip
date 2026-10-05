// =====================================================================
// 공통 기반 — 모든 서버 함수 모듈이 함께 쓰는 것들
//   Firebase 초기화, 비밀 값, 관리자 확인, 입력값 다듬기, 메일 발송, 요청 수 제한
// =====================================================================
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

admin.initializeApp();
const db = admin.firestore();
const now = () => admin.firestore.FieldValue.serverTimestamp();

// 비밀 값 — .env가 아니라 `firebase functions:secrets:set`으로 등록합니다 (README 참고)
const BUNNY_API_KEY = defineSecret("BUNNY_API_KEY");     // Bunny Stream 라이브러리 API 키
const BUNNY_TOKEN_KEY = defineSecret("BUNNY_TOKEN_KEY"); // Bunny Stream 토큰 인증 키
const SMTP_PASSWORD = defineSecret("SMTP_PASSWORD");     // 네이버웍스 외부 앱 비밀번호
const TOSS_SECRET_KEY = defineSecret("TOSS_SECRET_KEY"); // 토스페이먼츠 시크릿 키 (결제 승인용)

// 비밀이 아닌 값 — functions/.env 파일의 BUNNY_LIBRARY_ID로 넣습니다
function libraryId() {
  const id = process.env.BUNNY_LIBRARY_ID;
  if (!id) throw new HttpsError("failed-precondition", "BUNNY_LIBRARY_ID가 설정되어 있지 않습니다 (functions/.env).");
  return id;
}

async function requireAdmin(auth) {
  if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  const snap = await db.collection("users").doc(auth.uid).get();
  const role = snap.exists ? snap.data().role : null;
  if (role !== "admin") throw new HttpsError("permission-denied", "메인 관리자만 이용할 수 있습니다.");
}

// ---------- 입력값 다듬기 ----------
function oneLine(v, max) { return String(v == null ? "" : v).replace(/[\r\n\t]+/g, " ").trim().slice(0, max); }
function multiLine(v, max) { return String(v == null ? "" : v).replace(/\r\n?/g, "\n").trim().slice(0, max); }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------- 요청 허용 주소 · 요청 수 제한 ----------
const RATE_PER_HOUR = 5;      // 같은 접속지에서 1시간에 보낼 수 있는 문의 수
const RATE_PER_DAY_ALL = 200; // 전체 하루 상한 (자동 발송 공격 대비)

function allowedOrigin(origin) {
  if (!origin) return false;
  const pid = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "";
  const list = [`https://${pid}.web.app`, `https://${pid}.firebaseapp.com`]
    .concat((process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean));
  return list.includes(origin);
}

async function checkRate(ip) {
  const now = Date.now();
  const hour = 60 * 60 * 1000;
  const ipKey = crypto.createHash("sha256").update("cnlworks-inquiry:" + ip).digest("hex").slice(0, 32); // IP 원문은 저장하지 않음
  const day = new Date(now + 9 * hour).toISOString().slice(0, 10).replace(/-/g, "");
  const ipRef = db.collection("inquiryRate").doc(ipKey);
  const dayRef = db.collection("inquiryRate").doc("day_" + day);
  return db.runTransaction(async (t) => {
    const [a, b] = await Promise.all([t.get(ipRef), t.get(dayRef)]);
    let ipData = a.exists ? a.data() : { count: 0, windowStart: now };
    if (now - ipData.windowStart > hour) ipData = { count: 0, windowStart: now };
    const dayCount = b.exists ? b.data().count : 0;
    if (ipData.count >= RATE_PER_HOUR || dayCount >= RATE_PER_DAY_ALL) return false;
    const expireAt = admin.firestore.Timestamp.fromMillis(now + 2 * 24 * hour); // TTL 정책을 켜면 자동 삭제
    t.set(ipRef, { count: ipData.count + 1, windowStart: ipData.windowStart, expireAt });
    t.set(dayRef, { count: dayCount + 1, expireAt });
    return true;
  });
}

// ---------- 메일 발송 ----------
async function mailSend({ to, subject, text, replyTo, fromName }) {
  const user = process.env.SMTP_USER;
  if (!user) throw new Error("SMTP_USER not set");
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.worksmobile.com", port: Number(process.env.SMTP_PORT || 465),
    secure: Number(process.env.SMTP_PORT || 465) === 465, auth: { user, pass: SMTP_PASSWORD.value() },
  });
  await transporter.sendMail({
    from: { name: fromName || "CNL Works", address: user }, to: to || process.env.INQUIRY_TO || user,
    replyTo, subject: String(subject).replace(/[\r\n]+/g, " ").slice(0, 150), text,
  });
}

// 사이트 주소 (메일 안내 링크 등에 사용)
function siteBaseUrl(req) {
  const origin = req.get("origin");
  return allowedOrigin(origin) ? origin : `https://${process.env.GCLOUD_PROJECT || "pip-growth-program"}.web.app`;
}

module.exports = {
  onCall, onRequest, HttpsError, defineSecret, admin, crypto, nodemailer, db, now,
  BUNNY_API_KEY, BUNNY_TOKEN_KEY, SMTP_PASSWORD, TOSS_SECRET_KEY,
  libraryId, requireAdmin, oneLine, multiLine, EMAIL_RE,
  RATE_PER_HOUR, RATE_PER_DAY_ALL, allowedOrigin, checkRate, mailSend, siteBaseUrl,
};
