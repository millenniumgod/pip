// 조사관 과정 — 평가, 조사보고서 제출·검토, 수료증 진위 확인
const { onCall, HttpsError, admin, db, nodemailer, oneLine, multiLine, siteBaseUrl, mailSend, SMTP_PASSWORD } = require("./core");
const { EDU_QUIZ_COOLDOWN_SEC, EDU_REPORT_MIN_CHARS, eduRequireAdmin, eduMask, eduKstDate,
        eduReserveNumbers, eduPrefix, eduCertBase, eduGetCourse,
        eduVideosDone, eduMyInvEnrollment, eduLearnerEmail } = require("./edu-core");

// ---------- 평가 문항 받기 (정답 제외) ----------
exports.eduGetQuiz = onCall(async (req) => {
  const { ref, en, course } = await eduMyInvEnrollment(req.auth, req.data && req.data.enrollmentId);
  if (en.status !== "active" && en.status !== "done") throw new HttpsError("failed-precondition", "수강이 시작되지 않은 과정입니다.");
  if (en.mode !== "offline") {
    const v = await eduVideosDone(req.auth.uid, course);
    if (!v.ok) throw new HttpsError("failed-precondition", `영상을 모두 시청한 뒤 평가를 볼 수 있습니다. 남은 영상: ${v.missing}`);
  }
  const k = await db.collection("eduQuizKeys").doc(course.id).get();
  const qs = k.exists ? (k.data().questions || []) : [];
  if (!qs.length) throw new HttpsError("failed-precondition", "평가 문항이 아직 준비되지 않았습니다.");
  const r = await db.collection("eduQuizResults").doc(ref.id).get();
  return {
    passScore: k.data().passScore || 70,
    questions: qs.map((q) => ({ q: q.q, options: q.options })),
    last: r.exists ? { bestScore: r.data().bestScore || 0, attempts: r.data().attempts || 0, passed: !!r.data().passed } : null,
  };
});

// ---------- 평가 제출 → 서버 채점 ----------
exports.eduSubmitQuiz = onCall(async (req) => {
  const { ref, en, course } = await eduMyInvEnrollment(req.auth, req.data && req.data.enrollmentId);
  if (en.status !== "active") throw new HttpsError("failed-precondition", "수강 중인 과정만 평가를 볼 수 있습니다.");
  if (en.quizPassed) return { score: en.quizScore || 0, passed: true, passScore: null, already: true };
  if (en.mode !== "offline") {
    const v = await eduVideosDone(req.auth.uid, course);
    if (!v.ok) throw new HttpsError("failed-precondition", `영상을 모두 시청한 뒤 평가를 볼 수 있습니다. 남은 영상: ${v.missing}`);
  }
  const k = await db.collection("eduQuizKeys").doc(course.id).get();
  const qs = k.exists ? (k.data().questions || []) : [];
  if (!qs.length) throw new HttpsError("failed-precondition", "평가 문항이 아직 준비되지 않았습니다.");
  const passScore = k.data().passScore || 70;
  const answers = Array.isArray(req.data && req.data.answers) ? req.data.answers : [];
  if (answers.length !== qs.length || answers.some((a) => !Number.isInteger(a))) {
    throw new HttpsError("invalid-argument", "모든 문항에 답해 주세요.");
  }
  const correct = qs.reduce((n, q, i) => n + (answers[i] === q.answer ? 1 : 0), 0);
  const score = Math.round((correct / qs.length) * 100);
  const passed = score >= passScore;
  const rRef = db.collection("eduQuizResults").doc(ref.id);
  await db.runTransaction(async (t) => {
    const r = await t.get(rRef);
    const R = r.exists ? r.data() : {};
    const last = R.lastAt && R.lastAt.toMillis ? R.lastAt.toMillis() : 0;
    const wait = Math.ceil((last + EDU_QUIZ_COOLDOWN_SEC * 1000 - Date.now()) / 1000);
    if (wait > 0) throw new HttpsError("resource-exhausted", `${wait}초 뒤에 다시 제출할 수 있습니다.`);
    const best = Math.max(R.bestScore || 0, score);
    t.set(rRef, {
      uid: req.auth.uid, courseId: course.id, enrollmentId: ref.id, attempts: (R.attempts || 0) + 1,
      lastScore: score, bestScore: best, passed: !!R.passed || passed, passScore,
      lastAt: admin.firestore.FieldValue.serverTimestamp(),
      ...(passed && !R.passed ? { passedAt: admin.firestore.FieldValue.serverTimestamp() } : {}),
    }, { merge: true });
    t.update(ref, { quizScore: best, ...(passed ? { quizPassed: true } : {}) });
  });
  return { score, passed, passScore, correct, total: qs.length };
});

// ---------- 조사보고서 제출 ----------
exports.eduSubmitReport = onCall({ secrets: [SMTP_PASSWORD] }, async (req) => {
  const { ref, en, course } = await eduMyInvEnrollment(req.auth, req.data && req.data.enrollmentId);
  if (en.status !== "active") throw new HttpsError("failed-precondition", "수강 중인 과정만 보고서를 제출할 수 있습니다.");
  if (en.mode !== "offline" && !en.quizPassed) throw new HttpsError("failed-precondition", "평가에 합격한 뒤 보고서를 제출할 수 있습니다.");
  const rRef = db.collection("eduReports").doc(ref.id);
  const r = await rRef.get();
  const R = r.exists ? r.data() : {};
  const body = String(R.body || "");
  if (body.replace(/\s/g, "").length < EDU_REPORT_MIN_CHARS) {
    throw new HttpsError("failed-precondition", `보고서는 공백을 빼고 ${EDU_REPORT_MIN_CHARS}자 이상 작성해 주세요.`);
  }
  if (R.status === "submitted") return { ok: true, already: true };
  if (R.status === "approved") throw new HttpsError("failed-precondition", "이미 승인된 보고서입니다.");
  await rRef.set({
    status: "submitted", name: en.name || "", courseTitle: course.title || "", orgName: en.orgName || en.orgText || "",
    quizScore: en.quizScore == null ? null : en.quizScore, submitCount: (R.submitCount || 0) + 1,
    submittedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  await ref.update({ reportStatus: "submitted", reportSubmittedAt: admin.firestore.FieldValue.serverTimestamp() });
  try {
    await mailSend({ fromName: "CNL Works 교육센터",
      subject: `[조사보고서 제출] ${course.title || ""} ${en.name || ""}${(R.submitCount || 0) ? " (재제출)" : ""}`,
      text: ["조사관 과정 보고서가 제출되었습니다. 교육센터 관리자 화면의 '보고서 검토'에서 확인해 주세요.", "",
        "과정 : " + (course.title || ""), "성명 : " + (en.name || ""), "소속 : " + (en.orgName || en.orgText || "-"),
        "평가 : " + (en.quizScore == null ? "-" : en.quizScore + "점"), "분량 : " + body.length + "자"].join("\n") });
  } catch (e) { console.error("report notice failed:", e && e.code); }
  return { ok: true };
});

// ---------- 보고서 검토: 승인(수료증 발급) 또는 보완 요청 (메인 관리자) ----------
exports.eduReviewReport = onCall({ secrets: [SMTP_PASSWORD] }, async (req) => {
  await eduRequireAdmin(req.auth);
  const d = req.data || {};
  const decision = d.decision === "approve" ? "approve" : (d.decision === "revise" ? "revise" : "");
  const comment = multiLine(d.comment, 5000);
  if (!decision) throw new HttpsError("invalid-argument", "검토 결과를 선택해 주세요.");
  if (decision === "revise" && comment.length < 5) throw new HttpsError("invalid-argument", "보완할 내용을 적어 주세요.");
  const ref = db.collection("eduEnrollments").doc(String(d.enrollmentId || ""));
  const s = await ref.get();
  if (!s.exists) throw new HttpsError("not-found", "수강 정보를 찾을 수 없습니다.");
  const en = s.data();
  const course = await eduGetCourse(en.courseId);
  if (course.track !== "investigator") throw new HttpsError("failed-precondition", "조사관 과정이 아닙니다.");
  const rRef = db.collection("eduReports").doc(ref.id);
  const r = await rRef.get();
  if (!r.exists || r.data().status !== "submitted") throw new HttpsError("failed-precondition", "검토할 수 있는 제출 보고서가 없습니다.");
  const now = admin.firestore.FieldValue.serverTimestamp();
  const email = await eduLearnerEmail(en.uid);
  const base = siteBaseUrl(req.rawRequest);

  if (decision === "revise") {
    await rRef.update({ status: "revision", reviewComment: comment, reviewedAt: now, reviewedBy: req.auth.uid });
    await ref.update({ reportStatus: "revision" });
    let mailed = false;
    if (email) {
      try {
        await mailSend({ to: email, fromName: "CNL Works 교육센터", replyTo: process.env.INQUIRY_TO || undefined,
          subject: `[CNL Works] 조사보고서 보완 요청 — ${course.title || ""}`,
          text: [`${en.name || ""} 님, 제출하신 조사보고서를 검토했습니다.`, "",
            "아래 의견을 반영해 보고서를 보완한 뒤 다시 제출해 주세요.", "", comment, "",
            `교육센터: ${base}/edu/`, "", "CNL Works (노무법인 C&L)"].join("\n") });
        mailed = true;
      } catch (e) { console.error("revise mail failed:", e && e.code); }
    }
    return { ok: true, mailed };
  }

  if (en.certNo) return { ok: true, certNo: en.certNo };
  if (en.mode !== "offline") {
    const v = await eduVideosDone(en.uid, course);
    if (!v.ok) throw new HttpsError("failed-precondition", `수강생이 아직 시청하지 않은 영상이 있습니다: ${v.missing}`);
    if (!en.quizPassed) throw new HttpsError("failed-precondition", "수강생이 아직 평가에 합격하지 않았습니다.");
  }
  const [no] = await eduReserveNumbers(1, eduPrefix(course));
  const learner = await db.collection("eduLearners").doc(en.uid).get();
  const L = learner.exists ? learner.data() : {};
  await db.collection("eduCertificates").doc(no).set({
    ...eduCertBase(course), no, uid: en.uid, enrollmentId: ref.id,
    name: L.name || en.name || "", empNo: L.empNo || en.empNo || "", dept: L.dept || en.dept || "",
    orgId: en.orgId || null, orgName: en.orgName || "", mode: en.mode === "offline" ? "offline" : "online",
    completedDate: eduKstDate(), assessed: true, quizScore: en.quizScore == null ? null : en.quizScore,
  });
  await rRef.update({ status: "approved", reviewComment: comment, reviewedAt: now, reviewedBy: req.auth.uid, certNo: no });
  await ref.update({ status: "done", reportStatus: "approved", certNo: no, completedAt: now });
  let mailed = false;
  if (email) {
    try {
      await mailSend({ to: email, fromName: "CNL Works 교육센터", replyTo: process.env.INQUIRY_TO || undefined,
        subject: `[CNL Works] ${course.title || ""} 수료를 축하드립니다`,
        text: [`${en.name || ""} 님, 제출하신 조사보고서가 승인되어 「${course.certTitle || course.title || ""}」 과정을 수료하셨습니다.`, "",
          ...(comment ? ["검토 의견", comment, ""] : []),
          `수료번호: ${no}`, `수료증은 교육센터 '내 교육'에서 확인하고 인쇄할 수 있습니다: ${base}/edu/`,
          `진위 확인: ${base}/edu/#/verify/${no}`, "", "CNL Works (노무법인 C&L)"].join("\n") });
      mailed = true;
    } catch (e) { console.error("approve mail failed:", e && e.code); }
  }
  return { ok: true, certNo: no, mailed };
});

// ---------- 수료증 진위 확인 (누구나) ----------
exports.eduVerifyCertificate = onCall(async (req) => {
  const no = String((req.data && req.data.no) || "").toUpperCase().trim().slice(0, 40);
  if (!/^CNLW-[A-Z]{2}-\d{4}-\d{4,}$/.test(no)) return { valid: false };
  const s = await db.collection("eduCertificates").doc(no).get();
  if (!s.exists || s.data().revoked) return { valid: false };
  const c = s.data();
  return {
    valid: true, no, name: eduMask(c.name), certTitle: c.certTitle || c.courseTitle || "",
    hoursLabel: c.hoursLabel || "", mode: c.mode, completedDate: c.completedDate || "", assessed: !!c.assessed,
    orgName: c.track === "offender" ? "" : (c.orgName || ""), // 재발방지 과정은 소속을 공개하지 않음
  };
});
