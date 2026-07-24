/**
 * Live camera alignment (PASS/ID-style) using MediaPipe VIDEO hand/face/pose.
 */

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const ESM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm";

let vision = null;
let mod = null;
let videoHand = null;
let videoFace = null;
let videoPose = null;
let lastVideoTime = -1;

async function ensureMod() {
  if (mod && vision) return { mod, vision };
  mod = await import(ESM_URL);
  vision = await mod.FilesetResolver.forVisionTasks(WASM_URL);
  return { mod, vision };
}

async function getVideoHand() {
  if (videoHand) return videoHand;
  const { mod: m, vision: v } = await ensureMod();
  videoHand = await m.HandLandmarker.createFromOptions(v, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "CPU",
    },
    numHands: 1,
    runningMode: "VIDEO",
  });
  return videoHand;
}

async function getVideoFace() {
  if (videoFace) return videoFace;
  const { mod: m, vision: v } = await ensureMod();
  videoFace = await m.FaceLandmarker.createFromOptions(v, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
      delegate: "CPU",
    },
    numFaces: 1,
    runningMode: "VIDEO",
  });
  return videoFace;
}

async function getVideoPose() {
  if (videoPose) return videoPose;
  const { mod: m, vision: v } = await ensureMod();
  videoPose = await m.PoseLandmarker.createFromOptions(v, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
      delegate: "CPU",
    },
    numPoses: 1,
    runningMode: "VIDEO",
  });
  return videoPose;
}

function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Score 0..1 how well landmarks match guide target zone.
 * @returns {{ score: number, message: string, ok: boolean, far: boolean }}
 */
function scoreBracelet(lm) {
  // Guide: fist top, wrist ~ (0.50, 0.32)
  const wrist = lm[0];
  const mid = lm[9];
  const tip = lm[12];
  const target = { x: 0.5, y: 0.32 };
  const d = dist2(wrist.x, wrist.y, target.x, target.y);
  const handAbove = mid.y < wrist.y + 0.02 && tip.y < wrist.y;
  let score = Math.max(0, 1 - d / 0.28);
  if (handAbove) score = Math.min(1, score + 0.15);
  else score *= 0.55;
  const ok = score >= 0.72;
  const far = score < 0.35;
  return {
    score,
    ok,
    far,
    message: far
      ? "손목이 가이드에서 벗어났습니다. 주황 링(+)에 맞춰 주세요"
      : ok
        ? "좋아요! 잠시 유지하면 자동 촬영됩니다"
        : "주먹을 위로 · 주황 링(+)에 손목을 더 가까이",
  };
}

function scoreRing(lm) {
  // Left hand dorsum, index target ~ (0.52, 0.22)
  const mcp = lm[5];
  const pip = lm[6];
  const tip = lm[8];
  const mid = { x: (mcp.x + pip.x) / 2, y: (mcp.y + pip.y) / 2 };
  const target = { x: 0.52, y: 0.22 };
  const d = dist2(mid.x, mid.y, target.x, target.y);
  const fingersUp = tip.y < mcp.y;
  let score = Math.max(0, 1 - d / 0.3);
  if (fingersUp) score = Math.min(1, score + 0.12);
  else score *= 0.5;
  const ok = score >= 0.7;
  const far = score < 0.32;
  return {
    score,
    ok,
    far,
    message: far
      ? "왼손 손등이 가이드에서 벗어났습니다. 검지(+)에 맞춰 주세요"
      : ok
        ? "좋아요! 잠시 유지하면 자동 촬영됩니다"
        : "왼손 손등 · 검지(+)에 손가락을 더 가까이",
  };
}

function scoreEarring(faceLm, earSide) {
  const L = faceLm[234] || faceLm[127];
  const R = faceLm[454] || faceLm[356];
  const ear = earSide === "left" ? L : R;
  if (!ear) return { score: 0, ok: false, far: true, message: "얼굴·귀가 보이도록 맞춰 주세요" };
  const target = earSide === "left" ? { x: 0.28, y: 0.45 } : { x: 0.72, y: 0.45 };
  const d = dist2(ear.x, ear.y, target.x, target.y);
  const score = Math.max(0, 1 - d / 0.35);
  const ok = score >= 0.7;
  const far = score < 0.3;
  return {
    score,
    ok,
    far,
    message: far
      ? `${earSide === "left" ? "왼쪽" : "오른쪽"} 귀가 가이드에서 벗어났습니다`
      : ok
        ? "좋아요! 잠시 유지하면 자동 촬영됩니다"
        : "얼굴 가이드 안 · 귀(+)에 더 가까이",
  };
}

function scoreNecklace(poseLm) {
  const ls = poseLm[11];
  const rs = poseLm[12];
  if (!ls || !rs) return { score: 0, ok: false, far: true, message: "목·어깨가 보이게 맞춰 주세요" };
  const mid = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 + 0.06 };
  const target = { x: 0.5, y: 0.55 };
  const d = dist2(mid.x, mid.y, target.x, target.y);
  const score = Math.max(0, 1 - d / 0.35);
  const ok = score >= 0.68;
  const far = score < 0.3;
  return {
    score,
    ok,
    far,
    message: far
      ? "목·쇄골이 가이드에서 벗어났습니다"
      : ok
        ? "좋아요! 잠시 유지하면 자동 촬영됩니다"
        : "얼굴을 위 · 목(+)에 더 가까이",
  };
}

/**
 * Run one alignment frame against live video.
 */
export async function evaluateAlignment(video, type, earSide = "right") {
  if (!video || video.readyState < 2) {
    return { score: 0, ok: false, far: false, message: "카메라 준비 중…" };
  }
  const now = performance.now();
  if (video.currentTime === lastVideoTime) {
    return null; // skip duplicate frame
  }
  lastVideoTime = video.currentTime;

  try {
    if (type === "ring" || type === "bracelet") {
      const detector = await getVideoHand();
      const res = detector.detectForVideo(video, now);
      const lm = res.landmarks?.[0];
      if (!lm) {
        return {
          score: 0,
          ok: false,
          far: true,
          message: type === "ring"
            ? "왼손 손등이 화면에 들어오게 해 주세요"
            : "팔·손목이 화면에 들어오게 해 주세요",
        };
      }
      return type === "ring" ? scoreRing(lm) : scoreBracelet(lm);
    }
    if (type === "earring") {
      const detector = await getVideoFace();
      const res = detector.detectForVideo(video, now);
      const lm = res.faceLandmarks?.[0];
      if (!lm) return { score: 0, ok: false, far: true, message: "얼굴이 화면에 들어오게 해 주세요" };
      return scoreEarring(lm, earSide);
    }
    if (type === "necklace") {
      const detector = await getVideoPose();
      const res = detector.detectForVideo(video, now);
      const lm = res.landmarks?.[0];
      if (!lm) return { score: 0, ok: false, far: true, message: "상체가 화면에 들어오게 해 주세요" };
      return scoreNecklace(lm);
    }
  } catch (err) {
    console.warn("align", err);
    return { score: 0, ok: false, far: false, message: "인식 준비 중…" };
  }
  return { score: 0, ok: false, far: false, message: "" };
}

export function stopAlignClock() {
  lastVideoTime = -1;
}
