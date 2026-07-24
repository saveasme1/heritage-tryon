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
  // Bracelet: hand + pose (wrist) so fist shots still resolve.
  if (type === "bracelet") return ["hand", "pose"];
  if (type === "ring") return ["hand"];
  if (type === "earring") return ["face"];
  if (type === "necklace") return ["pose"];
  return ["hand", "pose"];
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
 * Detect body targets.
 * @param {string} preferredType
 * @param {function} onStatus
 * @param {{ earSide?: 'left'|'right' }} options
 */
export async function detectBody(imageElement, preferredType = "auto", onStatus = () => {}, options = {}) {
  const earSide = options.earSide === "left" ? "left" : "right";
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
      // Detect from a canvas copy — more reliable than raw <img> on some mobiles.
      const probe = document.createElement("canvas");
      probe.width = w;
      probe.height = h;
      probe.getContext("2d").drawImage(imageElement, 0, 0, w, h);
      let handRes = hand.detect(probe);
      hands = (handRes.landmarks || []).map((lm) => toPx(lm, w, h));
      if (!hands.length) {
        // Mild contrast boost retry
        const ctx = probe.getContext("2d");
        ctx.filter = "contrast(1.15) brightness(1.05)";
        ctx.drawImage(imageElement, 0, 0, w, h);
        ctx.filter = "none";
        handRes = hand.detect(probe);
        hands = (handRes.landmarks || []).map((lm) => toPx(lm, w, h));
      }
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

  // Prefer the largest / most central hand for bracelet & ring.
  let bestHand = null;
  let bestHandScore = -1;
  for (const lm of hands) {
    if (!lm?.[0] || !lm[9]) continue;
    const span = dist(lm[0], lm[9]);
    const cx = (lm[0].x + lm[9].x) / 2;
    const cy = (lm[0].y + lm[9].y) / 2;
    const centerBias = 1 - Math.hypot(cx / w - 0.5, cy / h - 0.45);
    const score = span * (0.7 + 0.3 * Math.max(0, centerBias));
    if (score > bestHandScore) {
      bestHandScore = score;
      bestHand = lm;
    }
  }

  if (bestHand?.[0] && bestHand[9] && bestHand[5] && bestHand[17]) {
    const wrist = bestHand[0];
    const midMcp = bestHand[9];
    const indexMcp = bestHand[5];
    const pinkyMcp = bestHand[17];
    const midTip = bestHand[12] || midMcp;
    const handLen = Math.max(dist(wrist, midTip), dist(wrist, midMcp), w * 0.12, 1);
    const palmW = Math.max(dist(indexMcp, pinkyMcp), handLen * 0.38, w * 0.1);
    const vx = wrist.x - midMcp.x;
    const vy = wrist.y - midMcp.y;
    const vlen = Math.hypot(vx, vy) || 1;
    const ux = vx / vlen;
    const uy = vy / vlen;
    // Slightly past wrist bone toward forearm — classic bracelet seat.
    targets.bracelet = {
      center: {
        x: wrist.x + ux * handLen * 0.12,
        y: wrist.y + uy * handLen * 0.12,
      },
      width: Math.max(palmW * 1.35, handLen * 0.4, w * 0.16),
      angle: angleDeg(indexMcp, pinkyMcp),
      frontAngle: (Math.atan2(midMcp.y - wrist.y, midMcp.x - wrist.x) * 180) / Math.PI,
      points: [wrist, indexMcp, pinkyMcp, midTip],
      source: "hand",
    };
  }

  // Pose wrist fallback when fist confuses HandLandmarker.
  if (!targets.bracelet && poses[0]) {
    const lw = poses[0][15];
    const rw = poses[0][16];
    const le = poses[0][13];
    const re = poses[0][14];
    const candidates = [];
    if (lw && le) candidates.push({ wrist: lw, elbow: le, side: "left" });
    if (rw && re) candidates.push({ wrist: rw, elbow: re, side: "right" });
    candidates.sort((a, b) => {
      const ca = Math.hypot(a.wrist.x / w - 0.5, a.wrist.y / h - 0.45);
      const cb = Math.hypot(b.wrist.x / w - 0.5, b.wrist.y / h - 0.45);
      return ca - cb;
    });
    const pick = candidates[0];
    if (pick) {
      const armLen = Math.max(dist(pick.wrist, pick.elbow), w * 0.2);
      const vx = pick.elbow.x - pick.wrist.x;
      const vy = pick.elbow.y - pick.wrist.y;
      const vlen = Math.hypot(vx, vy) || 1;
      targets.bracelet = {
        center: {
          x: pick.wrist.x + (vx / vlen) * armLen * 0.06,
          y: pick.wrist.y + (vy / vlen) * armLen * 0.06,
        },
        width: Math.max(armLen * 0.22, w * 0.18),
        angle: angleDeg(pick.wrist, pick.elbow) + 90,
        frontAngle: (Math.atan2(-vy, -vx) * 180) / Math.PI,
        points: [pick.wrist, pick.elbow],
        source: "pose",
      };
    }
  }

  if (bestHand?.[5] && bestHand[8]) {
    const mcp = bestHand[5];
    const pip = bestHand[6] || mcp;
    const tip = bestHand[8];
    targets.ring = {
      center: { x: (mcp.x + pip.x) / 2, y: (mcp.y + pip.y) / 2 },
      width: dist(mcp, tip) * 0.42,
      angle: angleDeg(mcp, tip),
      frontAngle: angleDeg(mcp, tip) - 90,
      points: [mcp, tip],
    };
  } else if (bestHand?.[13] && bestHand[16]) {
    const mcp = bestHand[13];
    const tip = bestHand[16];
    targets.ring = {
      center: { x: (mcp.x + tip.x) / 2, y: (mcp.y + tip.y) / 2 },
      width: dist(mcp, tip) * 0.55,
      angle: angleDeg(mcp, tip),
      frontAngle: angleDeg(mcp, tip) - 90,
      points: [mcp, tip],
    };
  }

  if (faces[0]) {
    const L = avgPoints(faces[0], LEFT_EAR);
    const R = avgPoints(faces[0], RIGHT_EAR);
    const faceW = faces[0][234] && faces[0][454] ? dist(faces[0][234], faces[0][454]) : w * 0.2;
    const leftTarget = L
      ? { center: L, width: faceW * 0.12, angle: 8, side: "left", alt: null }
      : null;
    const rightTarget = R
      ? { center: R, width: faceW * 0.12, angle: -8, side: "right", alt: null }
      : null;
    if (earSide === "left") {
      targets.earring = leftTarget || rightTarget;
      if (targets.earring && rightTarget) targets.earring.alt = rightTarget;
    } else {
      targets.earring = rightTarget || leftTarget;
      if (targets.earring && leftTarget) targets.earring.alt = leftTarget;
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
