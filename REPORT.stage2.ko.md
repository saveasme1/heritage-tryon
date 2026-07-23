# Heritage Try-On 2단계 보고 (한국어)

## 테스트·연결 URL

- 스튜디오(제품 딥링크): https://saveasme1.github.io/heritage-tryon/studio.html
- 카탈로그 MVP: https://saveasme1.github.io/heritage-tryon/
- 프로덕션 진입: 포트폴리오 상세 → `카카오톡 문의하기` 오른쪽 **Try It On**

## 전체 아키텍처

1. 포트폴리오 상세(`portfolio-board`)에서만 `board=portfolio` + `tryOn` 메타를 넘겨 버튼 생성
2. `Try It On`은 **별도 origin** `saveasme1.github.io/heritage-tryon/studio.html` 로 제품 id/이미지/제목을 쿼리로 전달 (새 탭)
3. 스튜디오: 좌 제품 / 우 촬영·업로드 → 준비 완료 시 큰 Try It On → 패널 중앙 머지 애니메이션 → MediaPipe+합성 결과
4. 기존 MVP 서비스(`mediapipe`, `clip`, `sam2`, `tryon`, `jewelry`) 재사용 — 서버·DB 미사용

## 설치한 패키지

- 서버 패키지 설치 **없음**
- 브라우저는 기존과 동일하게 CDN(MediaPipe / OpenCV.js / Transformers.js) 사용

## 서버 변경

- **없음** (MakerBridge / Contabo / nginx / DB 미변경)

## 폴더 구조 (추가)

```
heritage-tryon/
  studio.html
  public/studio.css
  src/studio.js
  (기존 services 재사용)
```

## 추가된 파일

- `heritage-tryon/studio.html`
- `heritage-tryon/public/studio.css`
- `heritage-tryon/src/studio.js`
- `heritage-tryon/REPORT.stage2.ko.md` (본 문서)

## 수정된 파일 (프로덕션 최소)

- `_gh_fix/board-meta.js` — 포트폴리오에만 Try It On
- `_gh_fix/portfolio-board.js` — tryOn 메타 전달
- `_gh_fix/handmade-reviews.css`, `landing.css` — 버튼 스타일
- `_gh_fix/landing.html`, `portfolio.html` — 캐시버스터

## 생성 API

- **없음**

## 사용 라이브러리

- MediaPipe Tasks Vision, OpenCV.js, Transformers.js(CLIP/ONNX 배경제거) — 1단계 MVP와 동일

## 남은 한계

- 합성 품질·원근 근사, 첫 모델 로딩 지연은 1단계와 동일
- GitHub 정책상 `hand-made.kr/heritage-tryon/` 경로에도 노출될 수 있음 (메인·랜딩 로직은 불변)
- 제품 이미지 CORS 실패 시 캔버스 합성 제한 가능

## 향후 개선

- 인페이지 모달(새 탭 없이) 옵션
- SAM2-tiny 로컬 번들
- 손가락/귀 위치 미세 조정 UI
