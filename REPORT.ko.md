# Heritage Try-On MVP — 구현 보고 (한국어)

## 테스트 URL (고유 주소)

**https://saveasme1.github.io/heritage-tryon/**

> `hand-made.kr` / `hand-made.kr/landing` 과 **완전 분리**. 프로덕션 파일 미수정.

---

## 전체 아키텍처

1. **포트폴리오 선택** — 공개 `portfolio-data.json` 읽기 전용 fetch → 썸네일 그리드
2. **바디 입력** — 모바일 카메라(`getUserMedia`) 또는 이미지 업로드
3. **주얼리 전처리** — 알파 채널 있으면 그대로, 없으면 ONNX 세그멘테이션으로 배경 제거 → IndexedDB 캐시
4. **종류 판별** — 제목 키워드 → 실패 시 CLIP zero-shot (`ring` / `earring` / `necklace`)
5. **신체 검출** — MediaPipe Hand / Face / Pose 랜드마크
6. **합성** — Canvas(+ OpenCV.js resize)로 스케일·회전·소프트 섀도·알파 블렌딩
7. **결과** — Before/After, PNG 다운로드, 재시도

모든 추론은 **브라우저 로컬**. 유료 API 없음.

---

## 사용 라이브러리

| 용도 | 기술 |
|------|------|
| 손·얼굴·포즈 | MediaPipe Tasks Vision (`@mediapipe/tasks-vision`) |
| 기하/리사이즈 | OpenCV.js 4.x |
| 주얼리 종류 분류 | Transformers.js + CLIP (`Xenova/clip-vit-base-patch32`) |
| 배경 제거 | Transformers.js + ONNX Runtime Web (`Xenova/rmbg-1.4`) |
| 캐시 | IndexedDB |

---

## 폴더 구조

```
heritage-tryon/
  index.html
  public/styles.css
  src/app.js
  src/components/          (UI는 app.js에 통합, 확장용)
  src/services/
    portfolio.js
    mediapipe.js
    clip.js
    sam2.js
    jewelry.js
    tryon.js
    storage.js
  src/models/README.md
  storage/portfolio/
  storage/processed/
  assets/
  REPORT.ko.md
  README.md
```

---

## 추가된 파일

- 위 구조 전체 (신규 레포 `saveasme1/heritage-tryon`)
- GitHub Pages 프로젝트 사이트 설정 (루트 `/`)

## 수정된 파일 (프로덕션)

- **없음** — `_gh_fix`, `hand-made.kr`, `landing.html` 등 미변경

---

## 남은 한계

- 풀 **SAM2** 대형 가중치는 Pages 첫 로딩에 부적합 → 동일 ONNX 경로의 **RMBG 세그멘테이션** 사용 (실패 시 코너 기반 휴리스틱)
- 원근(perspective) 워프는 MVP에서 아핀 회전·스케일 근사
- 카테고리 코드(C/VCA 등)는 브랜드 분류라 착용 부위와 무관 → CLIP/키워드에 의존
- 조명·피부톤 매칭, 손가락 폐색(occlusion) 미구현
- 크로스 오리진 이미지 CORS 실패 시 캔버스 오염 가능 (가능하면 동일 GitHub Pages 자산 사용)
- 모델 첫 다운로드가 커서 저속망에서 지연

---

## 향후 개선 아이디어

- SAM2-tiny ONNX를 `/models`에 번들해 오프라인 우선 로딩
- 손가락별 반지 슬롯 UI (검지/중지/약지)
- 귀걸이 좌우 대칭·구멍 위치 미세 조정 슬라이더
- WebGPU 가속 및 Worker 분리로 UI 블로킹 감소
- 관리자 승인 후 `hand-made.kr` 서브경로 또는 별도 커스텀 도메인 연결 (원할 때만)
