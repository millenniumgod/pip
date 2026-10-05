// // Bunny Stream 연동 — 영상 업로드 권한, 재생 토큰, 원본 삭제
const { onCall, HttpsError, crypto, db, libraryId, requireAdmin,
        BUNNY_API_KEY, BUNNY_TOKEN_KEY } = require("./core");

// ---------- 1) 업로드 권한 발급 (관리자 전용) ----------
// 순서: ① Bunny에 '빈 영상' 객체를 만들고 videoId를 받음 → ② 그 videoId로만 업로드할 수 있는
// 서명(24시간 유효)을 만들어 돌려줌 → ③ 브라우저가 그 서명으로 Bunny에 직접 파일을 업로드(TUS)
exports.bunnyCreateUpload = onCall({ secrets: [BUNNY_API_KEY] }, async (req) => {
  await requireAdmin(req.auth);
  const title = String((req.data && req.data.title) || "").trim().slice(0, 200) || "제목 없음";
  const libId = libraryId();
  const apiKey = BUNNY_API_KEY.value();

  const createResp = await fetch(`https://video.bunnycdn.com/library/${libId}/videos`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", AccessKey: apiKey },
    body: JSON.stringify({ title }),
  });
  if (!createResp.ok) {
    const t = await createResp.text().catch(() => "");
    throw new HttpsError("internal", `Bunny 영상 생성 실패 (${createResp.status}): ${t.slice(0, 300)}`);
  }
  const video = await createResp.json();
  const videoId = video.guid;
  if (!videoId) throw new HttpsError("internal", "Bunny가 영상 ID를 돌려주지 않았습니다.");

  const expirationTime = Math.floor(Date.now() / 1000) + 86400; // 24시간 — 업로드를 마칠 시간
  const signature = crypto
    .createHash("sha256")
    .update(`${libId}${apiKey}${expirationTime}${videoId}`)
    .digest("hex");

  return { videoId, libraryId: libId, expirationTime, signature };
});

// ---------- 2) 재생 인증 발급 (로그인한 사용자 누구나) ----------
// 5분짜리 짧은 토큰만 내려줍니다 — 재생 페이지를 여는 순간만 인증하면 되고,
// 그 이후 실제 영상 조각(HLS) 전송은 Bunny가 자체적으로 처리합니다.
// 강의별 수강 권한(배정 과정 등)까지는 여기서 다시 검사하지 않습니다 — 이미 로그인 자체가
// Firestore 규칙으로 가입 경로가 검증된 계정만 가능하므로, 외부인의 무단 접근을 막는 용도입니다.
exports.bunnyGetPlaybackAuth = onCall({ secrets: [BUNNY_TOKEN_KEY] }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  const userSnap = await db.collection("users").doc(req.auth.uid).get();
  if (!userSnap.exists) throw new HttpsError("permission-denied", "가입된 계정이 아닙니다.");

  const videoId = String((req.data && req.data.videoId) || "");
  if (!/^[0-9a-fA-F-]{20,50}$/.test(videoId)) throw new HttpsError("invalid-argument", "잘못된 영상 ID입니다.");

  const tokenKey = BUNNY_TOKEN_KEY.value();
  const expires = Math.floor(Date.now() / 1000) + 300; // 5분
  const token = crypto.createHash("sha256").update(`${tokenKey}${videoId}${expires}`).digest("hex");
  return { token, expires };
});

// ---------- 3) 강의 삭제 시 Bunny 원본도 정리 (관리자 전용) ----------
// 실패해도 사이트 쪽 삭제 자체는 막지 않도록, 호출부에서 결과를 무시해도 되게 설계했습니다.
exports.bunnyDeleteVideo = onCall({ secrets: [BUNNY_API_KEY] }, async (req) => {
  await requireAdmin(req.auth);
  const videoId = String((req.data && req.data.videoId) || "");
  if (!videoId) return { ok: false, status: 0, message: "영상 ID가 없습니다." };
  const libId = libraryId();
  const url = `https://video.bunnycdn.com/library/${libId}/videos/${videoId}`;
  const headers = { AccessKey: BUNNY_API_KEY.value(), Accept: "application/json" };
  const resp = await fetch(url, { method: "DELETE", headers });
  if (resp.ok) return { ok: true, status: resp.status };
  if (resp.status === 404) return { ok: true, status: 404, message: "이미 삭제된 영상입니다." };
  // 실패 원인을 화면에서 볼 수 있게 돌려줍니다 (키·라이브러리 설정 오류가 대부분)
  let detail = "";
  try { detail = (await resp.text()).slice(0, 200); } catch (e) { /* 본문 없음 */ }
  console.error("bunny delete failed:", resp.status, detail);
  const guide = resp.status === 401 ? "Bunny API 키를 확인해 주세요 (firebase functions:secrets:set BUNNY_API_KEY)."
    : resp.status === 400 ? "라이브러리 ID를 확인해 주세요 (functions/.env의 BUNNY_LIBRARY_ID)."
    : "Bunny 응답: " + resp.status;
  return { ok: false, status: resp.status, message: guide };
});
