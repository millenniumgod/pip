// =====================================================================
// CNL Works 서버 함수 — 기능별 모듈을 모아 내보냅니다.
//
//   core.js             공통 기반 (Firebase 초기화, 비밀 값, 메일, 입력 다듬기)
//   edu-core.js         교육센터 공통 도우미 (과정·수료증·수강 정보)
//
//   bunny.js            강의 영상 업로드 권한·재생 토큰·원본 삭제
//   pip-purge.js        PIP 고객사 개인정보 파기
//   inquiry.js          홈페이지 교육 문의 메일
//   edu.js              교육센터 수강 참여·신청, 수료증 발급
//   edu-investigator.js 조사관 과정 평가·조사보고서·진위 확인
//   edu-video.js        올린 영상의 길이·제목 가져오기
//   site.js             Q&A, 기업 교육 신청, 결제 주문·승인
//   orders.js           결제 완료 주문을 수강 권한으로 연결
//   social.js           네이버·카카오 로그인 (Firebase 로그인 토큰 발급)
// =====================================================================
Object.assign(exports,
  require("./bunny"),
  require("./pip-purge"),
  require("./inquiry"),
  require("./edu"),
  require("./edu-investigator"),
  require("./edu-video"),
  require("./site"),
  require("./orders"),
  require("./social"),
);
