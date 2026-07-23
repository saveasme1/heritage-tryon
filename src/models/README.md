# 브라우저에서 CDN/HF로 로드하는 ONNX·MediaPipe 모델 경로 메모

- MediaPipe Hand/Face/Pose: Google Storage `.task`
- CLIP: `Xenova/clip-vit-base-patch32` (Transformers.js / ONNX Runtime Web)
- 배경제거: `Xenova/rmbg-1.4` (ONNX, SAM 계열 세그멘테이션 파이프라인)

풀 SAM2 가중치는 Pages MVP에서 초기 로딩이 과도해 동일 ONNX Runtime 경로의 경량 세그멘테이션을 사용합니다.
