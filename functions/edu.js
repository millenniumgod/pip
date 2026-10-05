// 교육센터 — 수강 참여·신청, 영상 재생, 수료증 발급
const { onCall, HttpsError, admin, crypto, db, nodemailer, oneLine, multiLine,
        BUNNY_TOKEN_KEY, SMTP_PASSWORD } = require("./core");
const { EDU_COMPLETE_RATIO, eduName, eduCodeNorm, eduIsAdmin, eduRequireAdmin, eduKstDate,
        eduReserveNumbers, eduPrefix, eduCertBase, eduGetCourse } = require("./edu-core");

// ---------- 교육 코드로 참여 (회사 공용 코드 또는 개인별 지정 코드) ----------
exports.eduJoin = onCall(async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  const uid = req.auth.uid;
  const code = eduCodeNorm(req.data && req.data.code);
  const name = eduName(req.data && req.data.name);
  const empNo = oneLine(req.data && req.data.empNo, 30);
  const dept = oneLine(req.data && req.data.dept, 50);
  if (!code) throw new HttpsError("invalid-argument", "교육 코드를 입력해 주세요.");
  if (name.length < 2) throw new HttpsError("invalid-argument", "수료증에 들어갈 성명을 정확히 입력해 주세요.");

  const joinSnap = await db.collection("eduJoinCodes").doc(code).get();
  const invRef = db.collection("eduInvites").doc(code);
  const invSnap = joinSnap.exists ? null : await invRef.get();
  if (!joinSnap.exists && !(invSnap && invSnap.exists)) throw new HttpsError("not-found", "교육 코드를 확인해 주세요.");

  let orgId = null, orgName = "", courseId, source, mode = "online";
  if (joinSnap.exists) {
    const j = joinSnap.data();
    if (j.active === false) throw new HttpsError("failed-precondition", "사용이 종료된 교육 코드입니다.");
    orgId = j.orgId; orgName = j.orgName || ""; courseId = j.courseId; source = "code";
  } else {
    const iv = invSnap.data();
    if (iv.usedBy && iv.usedBy !== uid) throw new HttpsError("failed-precondition", "이미 사용된 코드입니다.");
    orgId = iv.orgId || null; orgName = iv.orgName || ""; courseId = iv.courseId; source = "invite"; mode = iv.mode || "online";
  }
  const course = await eduGetCourse(courseId);
  if (course.active === false) throw new HttpsError("failed-precondition", "현재 운영하지 않는 과정입니다.");

  const enrollId = `${uid}_${course.id}`;
  const enrollRef = db.collection("eduEnrollments").doc(enrollId);
  const learnerRef = db.collection("eduLearners").doc(uid);
  await db.runTransaction(async (t) => {
    const e = await t.get(enrollRef);
    if (e.exists) return; // 이미 참여 중이면 그대로
    if (source === "invite") {
      const iv = await t.get(invRef);
      if (iv.data().usedBy && iv.data().usedBy !== uid) throw new HttpsError("failed-precondition", "이미 사용된 코드입니다.");
      t.update(invRef, { usedBy: uid, usedAt: admin.firestore.FieldValue.serverTimestamp() });
    }
    t.set(learnerRef, {
      name, email: req.auth.token.email || "", empNo, dept,
      orgId, orgName, updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    t.set(enrollRef, {
      uid, name, empNo, dept, courseId: course.id, courseTitle: course.title || "", track: course.track || "general",
      program: course.program || "harassment", orgId, orgName, status: "active", mode, source,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });
  return { ok: true, enrollmentId: enrollId };
});

// ---------- 개인 직접 신청 (재발방지 교육) → 관리자 승인 후 수강 ----------
const EDU_REASONS = ["징계 절차 진행 중(개선 노력 자료)", "징계 후 회사의 교육 지시", "기타"];
const EDU_INV_REASONS = ["회사에서 조사 업무를 맡고 있음(또는 맡을 예정)", "인사·노무 실무 역량 강화", "기타"];
exports.eduApply = onCall({ secrets: [SMTP_PASSWORD] }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  const uid = req.auth.uid;
  const d = req.data || {};
  const name = eduName(d.name);
  const phone = oneLine(d.phone, 30);
  const orgText = oneLine(d.orgText, 60);
  const course = await eduGetCourse(d.courseId);
  const isInv = course.track === "investigator";
  const reason = (isInv ? EDU_INV_REASONS : EDU_REASONS).includes(d.reason) ? d.reason : "";
  const mode = !isInv && d.mode === "offline" ? "offline" : "online"; // 조사관 과정은 온라인 수강
  if (name.length < 2) throw new HttpsError("invalid-argument", "성명을 정확히 입력해 주세요.");
  if (!/^[0-9+\-() ]{7,30}$/.test(phone)) throw new HttpsError("invalid-argument", "연락처를 확인해 주세요.");
  if (!reason) throw new HttpsError("invalid-argument", "신청 사유를 선택해 주세요.");
  if (d.consent !== true) throw new HttpsError("invalid-argument", "개인정보 수집·이용에 동의해 주세요.");
  if ((course.track !== "offender" && !isInv) || course.active === false || course.allowApply === false) {
    throw new HttpsError("failed-precondition", "개인 신청을 받지 않는 과정입니다.");
  }
  const enrollRef = db.collection("eduEnrollments").doc(`${uid}_${course.id}`);
  const exists = await enrollRef.get();
  if (exists.exists) throw new HttpsError("already-exists", "이미 신청한 과정입니다.");
  await db.collection("eduLearners").doc(uid).set({
    name, email: req.auth.token.email || "", phone, orgText, updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  await enrollRef.set({
    uid, name, phone, orgText, reason, courseId: course.id, courseTitle: course.title || "", track: course.track,
    program: course.program || "harassment", orgId: null, orgName: "", status: "pending", mode, source: "apply",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  // 관리자에게 접수 알림 (실패해도 신청은 완료)
  try {
    const user = process.env.SMTP_USER;
    if (user) {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || "smtp.worksmobile.com", port: Number(process.env.SMTP_PORT || 465),
        secure: Number(process.env.SMTP_PORT || 465) === 465, auth: { user, pass: SMTP_PASSWORD.value() },
      });
      await transporter.sendMail({
        from: { name: "CNL Works 교육센터", address: user },
        to: process.env.INQUIRY_TO || user,
        subject: `[교육센터 개인 신청] ${course.title || ""} ${name}`.slice(0, 150),
        text: [
          "교육센터에 개인 신청이 접수되었습니다. 관리자 화면의 '신청 승인'에서 확인해 주세요.",
          "", "과정     : " + (course.title || ""), "성명     : " + name, "연락처   : " + phone,
          "소속     : " + (orgText || "-"), "신청 사유: " + reason, "희망 방식: " + (mode === "offline" ? "대면" : "온라인"),
          "로그인 이메일: " + (req.auth.token.email || "-"),
        ].join("\n"),
      });
    }
  } catch (e) { console.error("edu apply notice failed:", e && e.code); }
  return { ok: true };
});

// ---------- 영상 재생 인증 (교육센터용) ----------
exports.eduPlaybackAuth = onCall({ secrets: [BUNNY_TOKEN_KEY] }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  const videoId = String((req.data && req.data.videoId) || "");
  if (!/^[0-9a-fA-F-]{20,50}$/.test(videoId)) throw new HttpsError("invalid-argument", "잘못된 영상 ID입니다.");
  let allowed = await eduIsAdmin(req.auth.uid);
  if (!allowed) {
    const es = await db.collection("eduEnrollments").where("uid", "==", req.auth.uid).get();
    for (const e of es.docs) {
      const st = e.data().status;
      if (st !== "active" && st !== "done") continue;
      const c = await db.collection("eduCourses").doc(e.data().courseId).get();
      if (c.exists && (c.data().videos || []).some((v) => v.videoId === videoId)) { allowed = true; break; }
    }
  }
  if (!allowed) throw new HttpsError("permission-denied", "수강 권한이 없는 영상입니다.");
  const expires = Math.floor(Date.now() / 1000) + 300;
  const token = crypto.createHash("sha256").update(`${BUNNY_TOKEN_KEY.value()}${videoId}${expires}`).digest("hex");
  return { token, expires, libraryId: process.env.BUNNY_LIBRARY_ID || "" };
});

// ---------- 온라인 수료증 발급 (모든 영상 95% 이상 시청 확인) ----------
exports.eduIssueCertificate = onCall(async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  const enrollRef = db.collection("eduEnrollments").doc(String((req.data && req.data.enrollmentId) || ""));
  const es = await enrollRef.get();
  if (!es.exists || es.data().uid !== req.auth.uid) throw new HttpsError("not-found", "수강 정보를 찾을 수 없습니다.");
  const en = es.data();
  if (en.certNo) return { certNo: en.certNo };
  if (en.status !== "active") throw new HttpsError("failed-precondition", "수강이 시작되지 않은 과정입니다.");
  if (en.mode === "offline") throw new HttpsError("failed-precondition", "대면 과정은 교육 후 관리자가 수료 처리합니다.");
  const course = await eduGetCourse(en.courseId);
  if (course.track === "investigator") {
    throw new HttpsError("failed-precondition", "조사관 과정은 평가와 보고서 검토를 마친 뒤 수료증이 발급됩니다.");
  }
  const videos = course.videos || [];
  if (!videos.length) throw new HttpsError("failed-precondition", "과정에 영상이 없습니다.");
  for (let i = 0; i < videos.length; i++) {
    const p = await db.collection("eduProgress").doc(`${req.auth.uid}_${course.id}_${i}`).get();
    const sec = p.exists ? (p.data().sec || 0) : 0;
    const need = Math.floor((videos[i].durationSec || 0) * EDU_COMPLETE_RATIO);
    if (!videos[i].durationSec || sec < need) {
      throw new HttpsError("failed-precondition", `아직 시청을 마치지 않은 영상이 있습니다: ${videos[i].title || (i + 1) + "번 영상"}`);
    }
  }
  const [no] = await eduReserveNumbers(1, eduPrefix(course));
  const learner = await db.collection("eduLearners").doc(req.auth.uid).get();
  const L = learner.exists ? learner.data() : {};
  await db.collection("eduCertificates").doc(no).set({
    ...eduCertBase(course), no, uid: req.auth.uid, enrollmentId: enrollRef.id,
    name: L.name || en.name || "", empNo: L.empNo || en.empNo || "", dept: L.dept || en.dept || "",
    orgId: en.orgId || null, orgName: en.orgName || "", mode: "online", completedDate: eduKstDate(),
  });
  await enrollRef.update({ status: "done", certNo: no, completedAt: admin.firestore.FieldValue.serverTimestamp() });
  return { certNo: no };
});

// ---------- 대면(집합) 교육 수료 처리 (메인 관리자) ----------
//   · enrollmentId: 신청·지정 대상자 1명 수료 처리
//   · people[]: 집합교육 명단 일괄 발급 (계정 없이 명단 기준)
exports.eduIssueOffline = onCall({ timeoutSeconds: 120 }, async (req) => {
  await eduRequireAdmin(req.auth);
  const d = req.data || {};
  const date = /^\d{4}-\d{2}-\d{2}$/.test(d.date || "") ? d.date : eduKstDate();
  const place = oneLine(d.place, 60);
  if (d.enrollmentId) {
    const ref = db.collection("eduEnrollments").doc(String(d.enrollmentId));
    const s = await ref.get();
    if (!s.exists) throw new HttpsError("not-found", "수강 정보를 찾을 수 없습니다.");
    const en = s.data();
    if (en.certNo) return { certNos: [en.certNo] };
    const course = await eduGetCourse(en.courseId);
    const [no] = await eduReserveNumbers(1, eduPrefix(course));
    await db.collection("eduCertificates").doc(no).set({
      ...eduCertBase(course), no, uid: en.uid, enrollmentId: ref.id, name: en.name || "", empNo: en.empNo || "",
      dept: en.dept || "", orgId: en.orgId || null, orgName: en.orgName || "", mode: "offline", place, completedDate: date,
    });
    await ref.update({ status: "done", certNo: no, completedAt: admin.firestore.FieldValue.serverTimestamp() });
    return { certNos: [no] };
  }
  const course = await eduGetCourse(d.courseId);
  let orgId = null, orgName = oneLine(d.orgName, 60);
  if (d.orgId) {
    const o = await db.collection("eduOrgs").doc(String(d.orgId)).get();
    if (!o.exists) throw new HttpsError("not-found", "회사를 찾을 수 없습니다.");
    orgId = o.id; orgName = o.data().name || "";
  }
  const people = (Array.isArray(d.people) ? d.people : [])
    .map((p) => ({ name: eduName(p && p.name), empNo: oneLine(p && p.empNo, 30), dept: oneLine(p && p.dept, 50) }))
    .filter((p) => p.name.length >= 2).slice(0, 500);
  if (!people.length) throw new HttpsError("invalid-argument", "수료자 명단이 비어 있습니다.");
  const nos = await eduReserveNumbers(people.length, eduPrefix(course));
  const batchId = db.collection("eduOfflineBatches").doc().id;
  for (let i = 0; i < people.length; i += 400) {
    const b = db.batch();
    people.slice(i, i + 400).forEach((p, k) => {
      const no = nos[i + k];
      b.set(db.collection("eduCertificates").doc(no), {
        ...eduCertBase(course), no, uid: null, ...p, orgId, orgName, mode: "offline", place, completedDate: date, batchId,
      });
    });
    await b.commit();
  }
  await db.collection("eduOfflineBatches").doc(batchId).set({
    courseId: course.id, courseTitle: course.title || "", orgId, orgName, date, place, count: people.length,
    firstNo: nos[0], lastNo: nos[nos.length - 1], createdAt: admin.firestore.FieldValue.serverTimestamp(), createdBy: req.auth.uid,
  });
  return { certNos: nos, batchId };
});
