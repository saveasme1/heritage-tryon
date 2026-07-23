/**
 * MediaPipe Tasks Vision — hand / face(ear) / pose(neck) landmarks.
 * Models loaded from Google Storage (free CDN).
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

async function ensureVision() {
  if (vision) return vision;
  vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );
  return vision;
}

export async function initDetectors() {
  const v = await ensureVision();
  if (!hand) {
    hand = await HandLandmarker.createFromOptions(v, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
        delegate: "GPU",
      },
      numHands: 2,
      runningMode: "IMAGE",
    });
  }
  if (!face) {
    face = await FaceLandmarker.createFromOptions(v, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        delegate: "GPU",
      },
      runningMode: "IMAGE",
      numFaces: 1,
    });
  }
  if (!pose) {
    pose = await PoseLandmarker.createFromOptions(v, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
        delegate: "GPU",
      },
      runningMode: "IMAGE",
      numPoses: 1,
    });
  }
  return { hand, face, pose };
}

function toPx(landmarks, w, h) {
  return (landmarks || []).map((p) => ({ x: p.x * w, y: p.y * h, z: p.z ?? 0 }));
}

/** Face mesh indices near left/right earlobe region (approximation). */
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
 * Detect body targets for jewelry placement.
 * @returns {{ typeTargets: object, debug: object }}
 */
export async function detectBody(imageElement, preferredType = "auto") {
  await initDetectors();
  const w = imageElement.naturalWidth || imageElement.width;
  const h = imageElement.naturalHeight || imageElement.height;

  const handRes = hand.detect(imageElement);
  const faceRes = face.detect(imageElement);
  const poseRes = pose.detect(imageElement);

  const hands = (handRes.landmarks || []).map((lm) => toPx(lm, w, h));
  const faces = (faceRes.faceLandmarks || []).map((lm) => toPx(lm, w, h));
  const poses = (poseRes.landmarks || []).map((lm) => toPx(lm, w, h));

  const targets = {
    ring: null,
    earring: null,
    necklace: null,
  };

  // Ring: use ring finger MCP→TIP (landmark 13–16) of first hand
  if (hands[0] && hands[0][13] && hands[0][16]) {
    const mcp = hands[0][13];
    const tip = hands[0][16];
    const mid = { x: (mcp.x + tip.x) / 2, y: (mcp.y + tip.y) / 2 };
    targets.ring = {
      center: mid,
      width: dist(mcp, tip) * 0.55,
      angle: angleDeg(mcp, tip),
      points: [mcp, tip],
    };
  }

  // Earrings: left/right ear approx from face mesh
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
        alt: R
          ? { center: R, width: faceW * 0.12, angle: -8, side: "right" }
          : null,
      };
    } else if (R) {
      targets.earring = {
        center: R,
        width: faceW * 0.12,
        angle: -8,
        side: "right",
        alt: null,
      };
    }
  }

  // Necklace: midpoint between shoulders, slightly below
  if (poses[0] && poses[0][11] && poses[0][12]) {
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
    else resolvedType = "ring";
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
  ctx.strokeStyle = "#d4a35c";
  ctx.fillStyle = "rgba(212,163,92,.35)";
  ctx.lineWidth = Math.max(2, w * 0.003);
  ctx.beginPath();
  ctx.arc(t.center.x, t.center.y, Math.max(8, t.width * 0.35), 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  if (t.alt) {
    ctx.beginPath();
    ctx.arc(t.alt.center.x, t.alt.center.y, Math.max(8, t.alt.width * 0.35), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}
