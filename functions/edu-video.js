// 교육센터 — 올린 영상의 길이·제목 가져오기
const { onCall, HttpsError, BUNNY_API_KEY, libraryId } = require("./core");
const { eduRequireAdmin } = require("./edu-core");

// ---------- 교육센터: 올린 영상의 길이 가져오기 (관리자 전용) ----------
// Bunny가 영상을 처리한 뒤에야 길이를 알 수 있어, 업로드 직후가 아니라 필요할 때 불러옵니다.
exports.eduGetVideoInfo = onCall({ secrets: [BUNNY_API_KEY] }, async (req) => {
  await eduRequireAdmin(req.auth);
  const ids = (Array.isArray(req.data && req.data.videoIds) ? req.data.videoIds : [])
    .map((v) => String(v || "")).filter((v) => /^[0-9a-fA-F-]{20,50}$/.test(v)).slice(0, 30);
  if (!ids.length) throw new HttpsError("invalid-argument", "영상 ID가 없습니다.");
  const libId = libraryId();
  const apiKey = BUNNY_API_KEY.value();
  const out = {};
  for (const id of ids) {
    try {
      const r = await fetch(`https://video.bunnycdn.com/library/${libId}/videos/${id}`, {
        headers: { Accept: "application/json", AccessKey: apiKey },
      });
      if (!r.ok) { out[id] = { error: "HTTP " + r.status }; continue; }
      const v = await r.json();
      // status 4 = 재생 준비 완료
      out[id] = { title: String(v.title || ""), durationSec: Math.round(Number(v.length) || 0), ready: v.status === 4 };
    } catch (e) { out[id] = { error: "조회 실패" }; }
  }
  return { videos: out };
});
