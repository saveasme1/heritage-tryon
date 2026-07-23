/**
 * MediaPipe detectors — CPU first, load only what we need, with timeouts.
 */

import {
  FilesetResolver,
  HandLandmarker,
  FaceLandmarker,
  PoseLandmarker,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm";

let vision = null;
let hand = null;
let face = null;
let pose = null;

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(label)), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

async function ensureVision() {
  if (vision) return vision;
  vision = await withTimeout(
    FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    ),
    20000,
    "MediaPipe WASM 로딩 시간 초과"
  );
  return vision;
}

async function createWithDelegate(factory, options, label) {
  // Prefer CPU in iframe — GPU often hangs/fails silently.
  const base = options.baseOptions || {};
  try {
    return await withTimeout(
      factory({
        ...options,
        baseOptions: { ...base, delegate: "CPU" },
      }),
      25000,
      `${label} CPU 로딩 초과`
    );
  } catch (err) {
    console.warn(label, "CPU failed, try GPU", err);
    return await withTimeout(
      factory({
        ...options,
        baseOptions: { ...base, delegate: "GPU" },
      }),
      25000,
      `${label} GPU 로딩 초과`
    );
  }
}

export async function initDetectors(needed = ["hand", "face", "pose"], onStatus = () => {}) {
  onStatus("신체 인식 엔진 준비 중…");
  const v = await ensureVision();
  const need = new Set(needed);

  if (need.has("hand") && !hand) {
    onStatus("손 인식 모델 로딩…");
    hand = await createWithDelegate(
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
    face = await createWithDelegate(
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
    pose = await createWithDelegate(
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

function detectorsForType(type) {
  if (type === "ring") return ["hand"];
  if (type === "earring") return ["face"];
  if (type === "necklace") return ["pose"];
  return ["hand", "face", "pose"];
}

/**
 * Detect body targets for jewelry placement.
 */
export async function detectBody(imageElement, preferredType = "auto", onStatus = () => {}) {
  const typeHint = preferredType === "auto" ? "ring" : preferredType;
  await initDetectors(detectorsForType(preferredType === "auto" ? "auto" : preferredType), onStatus);

  const w = imageElement.naturalWidth || imageElement.width;
  const h = imageElement.naturalHeight || imageElement.height;

  onStatus("사진에서 착용 위치 찾는 중…");

  const targets = { ring: null, earring: null, necklace: null };
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

  if (hands[0]?.[13] && hands[0][16]) {
    const mcp = hands[0][13];
    const tip = hands[0][16];
    targets.ring = {
      center: { x: (mcp.x + tip.x) / 2, y: (mcp.y + tip.y) / 2 },
      width: dist(mcp, tip) * 0.55,
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

  let resolvedType = preferredType;
  if (preferredType === "auto") {
    if (targets.ring) resolvedType = "ring";
    else if (targets.earring) resolvedType = "earring";
    else if (targets.necklace) resolvedType = "necklace";
    else resolvedType = typeHint;
  }

  return {
    type: resolvedType,
    target: targets[resolvedType],
    allTargets: targets,
    debug: { hands: hands.length, faces: faces.length, poses: poses.length, size: { w, h } },
  };
}

export function drawDebug(canvas, image, detection) {
  const ctx = canvas.getContext("2d");
  const w = image.naturalWidth || image.width;
  const h = image.naturalHeight || image.height;
  canvas.width = w;
  canvas.height = h;
  ctx.drawImage(image, 0, 0, w, h);
  const t = detection.target;
  if (!t) return;
  ctx.strokeStyle = "#ff8236";
  ctx.fillStyle = "rgba(255,130,54,.28)";
  ctx.lineWidth = Math.max(2, w * 0.003);
  ctx.beginPath();
  ctx.arc(t.center.x, t.center.y, Math.max(8, t.width * 0.35), 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}
