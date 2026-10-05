// 홈페이지 교육 문의 → 메일 발송
const { onRequest, admin, crypto, db, nodemailer, oneLine, multiLine,
        allowedOrigin, checkRate, SMTP_PASSWORD } = require("./core");

// ---------- 5) 홈페이지 교육 문의 → 메일 발송 ----------
// 홈페이지(/#/contact)의 문의 양식이 /api/inquiry 로 보내면(firebase.json의 rewrites),
// 네이버웍스 SMTP로 문의 내용을 INQUIRY_TO 주소에 메일로 보냅니다.
// 문의 내용은 데이터베이스에 저장하지 않습니다(메일로만 전달). 로그에도 개인정보를 남기지 않습니다.
//
// 설정:
//   비밀 값  : firebase functions:secrets:set SMTP_PASSWORD   (네이버웍스 '외부 앱 비밀번호')
//   functions/.env :
//     SMTP_USER=cnlcg@cnlcg.co.kr        (보내는 계정 = 네이버웍스 로그인 주소)
//     INQUIRY_TO=cnlcg@cnlcg.co.kr       (받는 주소, 쉼표로 여러 개 가능)
//     SMTP_HOST=smtp.worksmobile.com     (생략 시 이 값)
//     SMTP_PORT=465                      (생략 시 이 값)
//     ALLOWED_ORIGINS=https://cnlworks.co.kr   (자체 도메인 연결 시 추가. web.app·firebaseapp.com 주소는 자동 허용)

const INQ_TOPICS = ["PIP Package 1(원스톱 과정)", "PIP Package 2(맞춤 컨설팅)", "직장 내 괴롭힘 예방교육", "직장 내 괴롭힘 행위자 교육",
  "직장 내 괴롭힘 조사관 과정", "직장 내 성희롱 조사관 과정",
  "직장 내 성희롱 예방교육", "직장 내 성희롱 행위자 교육", "기타"];

exports.submitInquiry = onRequest({ secrets: [SMTP_PASSWORD], maxInstances: 3, timeoutSeconds: 30, memory: "256MiB" }, async (req, res) => {
  res.set("Cache-Control", "no-store");
  const fail = (code, message) => res.status(code).json({ ok: false, message });
  if (req.method !== "POST") return fail(405, "잘못된 요청입니다.");
  if (!allowedOrigin(req.get("origin"))) return fail(403, "허용되지 않은 접근입니다.");

  const b = (req.body && typeof req.body === "object") ? req.body : {};
  if (b.website) return res.json({ ok: true });                       // 자동 입력 프로그램용 함정 칸
  if (!(Number(b.elapsedMs) >= 3000)) return fail(400, "잠시 후 다시 보내 주세요.");

  const company = oneLine(b.company, 100);
  const name = oneLine(b.name, 50);
  const email = oneLine(b.email, 120);
  const phone = oneLine(b.phone, 30);
  const topics = Array.isArray(b.topics) ? b.topics.filter((x) => INQ_TOPICS.includes(x)).slice(0, INQ_TOPICS.length) : [];
  const headcount = oneLine(b.headcount, 40);
  const message = multiLine(b.message, 3000);

  if (!company || !name) return fail(400, "회사명과 담당자 성명을 입력해 주세요.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(400, "이메일 주소를 확인해 주세요.");
  if (phone && !/^[0-9+\-() ]{7,30}$/.test(phone)) return fail(400, "연락처는 숫자와 - 기호로 입력해 주세요.");
  if (message.length < 10) return fail(400, "문의 내용을 10자 이상 적어 주세요.");
  if (b.consent !== true) return fail(400, "개인정보 수집·이용에 동의해 주셔야 문의를 보낼 수 있습니다.");

  const ip = String(req.get("x-forwarded-for") || req.ip || "").split(",")[0].trim();
  if (!(await checkRate(ip))) return fail(429, "문의가 너무 많이 접수되었습니다. 잠시 후 다시 보내 주시거나 메일로 직접 보내 주세요.");

  const user = process.env.SMTP_USER;
  const to = process.env.INQUIRY_TO || user;
  if (!user) return fail(500, "메일 설정이 아직 완료되지 않았습니다.");

  const kst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 16) + " (KST)";
  const text = [
    "CNL Works 홈페이지로 교육 문의가 접수되었습니다.",
    "",
    "회사명     : " + company,
    "담당자     : " + name,
    "이메일     : " + email,
    "연락처     : " + (phone || "-"),
    "관심 교육  : " + (topics.length ? topics.join(", ") : "-"),
    "대상 인원  : " + (headcount || "-"),
    "",
    "[문의 내용]",
    message,
    "",
    "----",
    "접수 시각  : " + kst,
    "개인정보 수집·이용 동의: 동의함 (보유기간: 문의 처리 완료 후 1년)",
    "이 메일에 '답장'하면 문의자(" + email + ")에게 바로 회신됩니다.",
  ].join("\n");

  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.worksmobile.com",
      port: Number(process.env.SMTP_PORT || 465),
      secure: Number(process.env.SMTP_PORT || 465) === 465,
      auth: { user, pass: SMTP_PASSWORD.value() },
    });
    await transporter.sendMail({
      from: { name: "CNL Works 홈페이지", address: user },
      to,
      replyTo: { name, address: email },
      subject: `[CNL Works 교육 문의] ${company} ${name}`.slice(0, 150),
      text,
    });
  } catch (e) {
    console.error("inquiry mail failed:", e && e.code, e && e.responseCode); // 내용·주소는 기록하지 않음
    return fail(502, "메일 전송에 실패했습니다. 잠시 후 다시 시도하시거나 메일로 직접 보내 주세요.");
  }
  return res.json({ ok: true });
});
