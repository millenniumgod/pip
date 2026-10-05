// =====================================================================
// 교육센터 공통 — 과정·수료증·수강 정보를 다루는 도우미
// =====================================================================
const { HttpsError, admin, crypto, db, oneLine } = require("./core");

const EDU_COMPLETE_RATIO = 0.95; // 영상별 95% 이상 시청 시 완료

function eduName(v) { return oneLine(v, 30); }
function eduCodeNorm(v) { return String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16); }
async function eduIsAdmin(uid) {
  if (!uid) return false;
  const s = await db.collection("users").doc(uid).get();
  return s.exists && s.data().role === "admin";
}
async function eduRequireAdmin(auth) {
  if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  if (!(await eduIsAdmin(auth.uid))) throw new HttpsError("permission-denied", "메인 관리자만 이용할 수 있습니다.");
}
function eduMask(name) {
  const n = String(name || "");
  if (n.length <= 1) return n;
  if (n.length === 2) return n[0] + "*";
  return n[0] + "*".repeat(n.length - 2) + n[n.length - 1];
}
function eduKstDate(d) {
  const t = new Date((d ? d.getTime() : Date.now()) + 9 * 3600 * 1000);
  return t.toISOString().slice(0, 10);
}

// 수료번호 n개를 한 번에 예약: CNLW-{과정코드}-{연도}-{4자리}
async function eduReserveNumbers(n, prefix) {
  const year = eduKstDate().slice(0, 4);
  const ref = db.collection("eduCounters").doc("cert-" + year);
  const start = await db.runTransaction(async (t) => {
    const s = await t.get(ref);
    const cur = s.exists ? (s.data().seq || 0) : 0;
    t.set(ref, { seq: cur + n, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return cur + 1;
  });
  return Array.from({ length: n }, (_, i) => `CNLW-${prefix}-${year}-${String(start + i).padStart(4, "0")}`);
}
function eduPrefix(course) {
  const p = course.program === "sexual" ? "S" : "H";
  const t = course.track === "offender" ? "R" : (course.track === "investigator" ? "I" : "G");
  return p + t;
}
function eduCertBase(course) {
  return {
    courseId: course.id, courseTitle: course.title || "", certTitle: course.certTitle || course.title || "",
    program: course.program || "harassment", track: course.track || "general", hoursLabel: course.hoursLabel || "",
    issuedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}
async function eduGetCourse(courseId) {
  const s = await db.collection("eduCourses").doc(String(courseId || "")).get();
  if (!s.exists) throw new HttpsError("not-found", "과정을 찾을 수 없습니다.");
  return { id: s.id, ...s.data() };
}

const EDU_QUIZ_COOLDOWN_SEC = 60;   // 평가 재응시 간격
const EDU_REPORT_MIN_CHARS = 300;   // 보고서 최소 분량

async function eduVideosDone(uid, course) {
  const videos = course.videos || [];
  if (!videos.length) return { ok: false, missing: "과정에 영상이 없습니다." };
  for (let i = 0; i < videos.length; i++) {
    const p = await db.collection("eduProgress").doc(`${uid}_${course.id}_${i}`).get();
    const sec = p.exists ? (p.data().sec || 0) : 0;
    if (!videos[i].durationSec || sec < Math.floor(videos[i].durationSec * EDU_COMPLETE_RATIO)) {
      return { ok: false, missing: videos[i].title || (i + 1) + "번 영상" };
    }
  }
  return { ok: true };
}
async function eduMyInvEnrollment(auth, enrollmentId) {
  if (!auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  const ref = db.collection("eduEnrollments").doc(String(enrollmentId || ""));
  const s = await ref.get();
  if (!s.exists || s.data().uid !== auth.uid) throw new HttpsError("not-found", "수강 정보를 찾을 수 없습니다.");
  const en = s.data();
  const course = await eduGetCourse(en.courseId);
  if (course.track !== "investigator") throw new HttpsError("failed-precondition", "조사관 과정이 아닙니다.");
  return { ref, en, course };
}
async function eduLearnerEmail(uid, fallback) {
  try {
    const l = await db.collection("eduLearners").doc(uid).get();
    if (l.exists && l.data().email) return l.data().email;
  } catch (e) { /* 아래 fallback 사용 */ }
  if (fallback) return fallback;
  try { return (await admin.auth().getUser(uid)).email || ""; } catch (e) { return ""; }
}

const ORDER_KEYS = {
  "harassment-offender": { program: "harassment", track: "offender" },
  "sexual-offender": { program: "sexual", track: "offender" },
  "harassment-investigator": { program: "harassment", track: "investigator" },
  "sexual-investigator": { program: "sexual", track: "investigator" },
};

// 판매 중인 과정 하나 찾기 (운영 중 + 개인 신청 허용 + 가격 설정됨)
async function findSellableCourse(key) {
  const k = ORDER_KEYS[key];
  if (!k) throw new HttpsError("invalid-argument", "잘못된 과정입니다.");
  const snap = await db.collection("eduCourses").where("track", "==", k.track).get();
  const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .filter((c) => (c.program || "harassment") === k.program && c.active !== false && c.allowApply !== false);
  return list.find((c) => Number(c.priceKrw) > 0) || list[0] || null;
}
function orderName(course) { return String(course.title || "CNL Works 교육").slice(0, 100); }

module.exports = {
  EDU_COMPLETE_RATIO, EDU_QUIZ_COOLDOWN_SEC, EDU_REPORT_MIN_CHARS, ORDER_KEYS,
  eduName, eduCodeNorm, eduIsAdmin, eduRequireAdmin, eduMask, eduKstDate,
  eduReserveNumbers, eduPrefix, eduCertBase, eduGetCourse,
  eduVideosDone, eduMyInvEnrollment, eduLearnerEmail, findSellableCourse, orderName,
};
