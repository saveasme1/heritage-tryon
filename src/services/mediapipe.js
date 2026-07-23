/**
 * MediaPipe detectors — optional. Fail fast; never hang the UI.
 */

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const ESM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm";

let vision = null;
let visionMod = null;
let hand = null;
let face = null;
let pose = null;
let visionFailed = false;

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(label)), ms);
    Promise.resolve(promise).then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

async function loadVisionModule() {
  return withTimeout(import(ESM_URL), 12000, "MediaPipe 스크립트 로딩 초과");
}

async function ensureVision(onStatus) {
  if (visionFailed) throw new Error("MediaPipe 사용 불가");
  if (vision && visionMod) return { vision, mod: visionMod };
  onStatus("신체 인식 엔진 준비 중…");
  const mod = await loadVisionModule();
  visionMod = mod;
  vision = await withTimeout(
    mod.FilesetResolver.forVisionTasks(WASM_URL),
    15000,
    "MediaPipe WASM 로딩 초과"
  );
  return { vision, mod };
}

async function createCpu(factory, options, label) {
  return withTimeout(
    factory({
      ...options,
      baseOptions: { ...(options.baseOptions || {}), delegate: "CPU" },
    }),
    18000,
    `${label} 로딩 초과`
  );
}

function detectorsForType(type) {
  if (type === "ring" || type === "bracelet") return ["hand"];
  if (type === "earring") return ["face"];
  if (type === "necklace") return ["pose"];
  return ["hand"];
}

export async function initDetectors(needed = ["hand"], onStatus = () => {}) {
  const need = new Set(needed);
  try {
    const { vision: v, mod } = await ensureVision(onStatus);
    const { HandLandmarker, FaceLandmarker, PoseLandmarker } = mod;

    if (need.has("hand") && !hand) {
      onStatus("손 인식 모델 로딩…");
      hand = await createCpu(
        (opts) => HandLandmarker.createFromOptions(v, opts),
        {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
          },
          numHands: 2,
          runningMode: "IMAGE",
        },
        "손 인식"
      );
    }
    if (need.has("face") && !face) {
      onStatus("얼굴/귀 인식 모델 로딩…");
      face = await createCpu(
        (opts) => FaceLandmarker.createFromOptions(v, opts),
        {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
          },
          runningMode: "IMAGE",
          numFaces: 1,
        },
        "얼굴 인식"
      );
    }
    if (need.has("pose") && !pose) {
      onStatus("목/상체 인식 모델 로딩…");
      pose = await createCpu(
        (opts) => PoseLandmarker.createFromOptions(v, opts),
        {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
          },
          runningMode: "IMAGE",
          numPoses: 1,
        },
        "포즈 인식"
      );
    }
  } catch (err) {
    console.warn("initDetectors failed", err);
    visionFailed = true;
    throw err;
  }
  return { hand, face, pose };
}

function toPx(landmarks, w, h) {
  return (landmarks || []).map((p) => ({ x: p.x * w, y: p.y * h, z: p.z ?? 0 }));
}

const LEFT_EAR = [234, 127, 162, 21];
const RIGHT_EAR = [454, 356, 389, 251];

function avgPoints(pts, idxs) {
  const picked = idxs.map((i) => pts[i]).filter(Boolean);
  if (!picked.length) return null;
  const x = picked.reduce((s, p) => s + p.x, 0) / picked.length;
  const y = picked.reduce((s, p) => s + p.y, 0) / picked.length;
  return { x, y };
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function angleDeg(a, b) {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

/**
 * Detect body targets. Returns null target on failure (caller may use fallback).
 */
export async function detectBody(imageElement, preferredType = "auto", onStatus = () => {}) {
  const typeHint = preferredType === "auto" ? "bracelet" : preferredType;
  try {
    await initDetectors(detectorsForType(preferredType === "auto" ? "bracelet" : preferredType), onStatus);
  } catch (err) {
    onStatus("신체 인식을 건너뛰고 기본 위치로 합성합니다…");
    return { type: typeHint, target: null, allTargets: {}, debug: { error: String(err.message || err) } };
  }

  const w = imageElement.naturalWidth || imageElement.width;
  const h = imageElement.naturalHeight || imageElement.height;
  onStatus("사진에서 착용 위치 찾는 중…");

  const targets = { ring: null, bracelet: null, earring: null, necklace: null };
  let hands = [];
  let faces = [];
  let poses = [];

  try {
    if (hand) {
      const handRes = hand.detect(imageElement);
      hands = (handRes.landmarks || []).map((lm) => toPx(lm, w, h));
    }
  } catch (e) { console.warn("hand detect", e); }
  try {
    if (face) {
      const faceRes = face.detect(imageElement);
      faces = (faceRes.faceLandmarks || []).map((lm) => toPx(lm, w, h));
    }
  } catch (e) { console.warn("face detect", e); }
  try {
    if (pose) {
      const poseRes = pose.detect(imageElement);
      poses = (poseRes.landmarks || []).map((lm) => toPx(lm, w, h));
    }
  } catch (e) { console.warn("pose detect", e); }

  if (hands[0]?.[0] && hands[0][9] && hands[0][5] && hands[0][17]) {
    const wrist = hands[0][0];
    const midMcp = hands[0][9];
    const indexMcp = hands[0][5];
    const pinkyMcp = hands[0][17];
    const midTip = hands[0][12] || midMcp;
    // Fist photos shrink palmW — use hand length so bracelet stays wrist-sized.
    const handLen = Math.max(dist(wrist, midTip), dist(wrist, midMcp), w * 0.15, 1);
    const palmW = Math.max(dist(indexMcp, pinkyMcp), handLen * 0.42, w * 0.14);
    const vx = wrist.x - midMcp.x;
    const vy = wrist.y - midMcp.y;
    const vlen = Math.hypot(vx, vy) || 1;
    const ux = vx / vlen;
    const uy = vy / vlen;
    // Sit clearly on the wrist/forearm, not the knuckle cluster.
    targets.bracelet = {
      center: {
        x: wrist.x + ux * handLen * 0.48,
        y: wrist.y + uy * handLen * 0.48,
      },
      width: Math.max(palmW * 1.75, handLen * 0.55, w * 0.22),
      angle: angleDeg(indexMcp, pinkyMcp),
      points: [wrist, indexMcp, pinkyMcp, midTip],
    };
  }

  if (hands[0]?.[13] && hands[0][16]) {
    const mcp = hands[0][13];
    const tip = hands[0][16];
    targets.ring = {
      center: { x: (mcp.x + tip.x) / 2, y: (mcp.y + tip.y) / 2 },
      width: dist(mcp, tip) * 0.7,
      angle: angleDeg(mcp, tip),
      points: [mcp, tip],
    };
  }

  if (faces[0]) {
    const L = avgPoints(faces[0], LEFT_EAR);
    const R = avgPoints(faces[0], RIGHT_EAR);
    const faceW = faces[0][234] && faces[0][454] ? dist(faces[0][234], faces[0][454]) : w * 0.2;
    if (L) {
      targets.earring = {
        center: L,
        width: faceW * 0.12,
        angle: 8,
        side: "left",
        alt: R ? { center: R, width: faceW * 0.12, angle: -8, side: "right" } : null,
      };
    } else if (R) {
      targets.earring = { center: R, width: faceW * 0.12, angle: -8, side: "right", alt: null };
    }
  }

  if (poses[0]?.[11] && poses[0][12]) {
    const ls = poses[0][11];
    const rs = poses[0][12];
    const mid = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
    const shoulderW = dist(ls, rs);
    targets.necklace = {
      center: { x: mid.x, y: mid.y + shoulderW * 0.22 },
      width: shoulderW * 0.55,
      angle: angleDeg(ls, rs),
      points: [ls, rs],
    };
  }

  let resolvedType = preferredType === "auto" ? typeHint : preferredType;
  if (preferredType === "auto") {
    if (targets.bracelet) resolvedType = "bracelet";
    else if (targets.ring) resolvedType = "ring";
    else if (targets.earring) resolvedType = "earring";
    else if (targets.necklace) resolvedType = "necklace";
  }

  return {
    type: resolvedType,
    target: targets[resolvedType] || null,
    allTargets: targets,
    debug: { hands: hands.length, faces: faces.length, poses: poses.length, size: { w, h } },
  };
}
