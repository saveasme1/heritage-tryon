/**
 * Jewelry cutout — product plate must not survive.
 * 1) native alpha
 * 2) @imgly/background-removal (browser)
 * 3) aggressive flood / chroma if plate remains
 */

const HEAVY_MS = 45000;

function withTimeout(promise, ms, label = "timeout") {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(label)), ms);
    Promise.resolve(promise).then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

function loadImage(url) {
  return new Promise(async (resolve, reject) => {
    const finish = (src) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("이미지 로드 실패"));
      img.src = src;
    };
    try {
      if (/^https?:\/\//i.test(url)) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 6000);
        try {
          const res = await fetch(url, { mode: "cors", cache: "no-store", signal: ctrl.signal });
          if (res.ok) {
            finish(URL.createObjectURL(await res.blob()));
            return;
          }
        } finally {
          clearTimeout(timer);
        }
      }
    } catch (_) {}
    finish(url);
  });
}

function canvasFromImage(img) {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth || img.width;
  c.height = img.naturalHeight || img.height;
  c.getContext("2d").drawImage(img, 0, 0);
  return c;
}

function hasTransparency(img) {
  const c = document.createElement("canvas");
  const w = Math.min(80, img.naturalWidth || img.width);
  const h = Math.min(80, img.naturalHeight || img.height);
  if (!w || !h) return false;
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  let clear = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 240) clear++;
  return clear > (data.length / 4) * 0.08;
}

function colorDist(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/** How much of the frame border is still opaque — high = plate leftover. */
function edgeOpaqueRatio(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const w = canvas.width;
  const h = canvas.height;
  const { data } = ctx.getImageData(0, 0, w, h);
  let edge = 0;
  let opaque = 0;
  const check = (x, y) => {
    edge++;
    if (data[(y * w + x) * 4 + 3] > 20) opaque++;
  };
  for (let x = 0; x < w; x++) {
    check(x, 0);
    check(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    check(0, y);
    check(w - 1, y);
  }
  return edge ? opaque / edge : 1;
}

function opaqueStats(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const w = canvas.width;
  const h = canvas.height;
  const { data } = ctx.getImageData(0, 0, w, h);
  let opaque = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 12) opaque++;
  return { opaque, ratio: opaque / (w * h) };
}

function isCutoutGood(canvas) {
  const edge = edgeOpaqueRatio(canvas);
  const { ratio } = opaqueStats(canvas);
  // Good cutout: few edge pixels left, and not almost-empty / almost-full plate
  return edge < 0.18 && ratio > 0.02 && ratio < 0.85;
}

function hardenAlpha(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a < 48) d[i + 3] = 0;
    else if (a > 210) d[i + 3] = 255;
    else d[i + 3] = Math.round(((a - 48) / (210 - 48)) * 255);
  }
  ctx.putImageData(id, 0, 0);
  return canvas;
}

async function transformersCutout(img, onStatus = () => {}) {
  onStatus("고품질 AI 누끼 로딩… (RMBG)");
  const { pipeline, env } = await import("https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2");
  env.allowLocalModels = false;
  env.backends.onnx.wasm.numThreads = 1;
  const segmenter = await pipeline("image-segmentation", "Xenova/rmbg-1.4", { quantized: true });
  onStatus("고품질 AI 누끼 처리 중…");
  // Feed via canvas data URL for consistent decode
  const src = canvasFromImage(img);
  const dataUrl = src.toDataURL("image/png");
  const result = await segmenter(dataUrl);
  const mask = Array.isArray(result) ? result[0] : result;
  const out = canvasFromImage(img);
  const ctx = out.getContext("2d");
  if (mask?.mask?.width && mask.mask.data) {
    const mw = mask.mask.width;
    const mh = mask.mask.height;
    const tmp = document.createElement("canvas");
    tmp.width = mw;
    tmp.height = mh;
    const mid = tmp.getContext("2d").createImageData(mw, mh);
    for (let i = 0; i < mask.mask.data.length; i++) {
      const v = mask.mask.data[i] > 0.5 ? 255 : 0;
      mid.data[i * 4] = 255;
      mid.data[i * 4 + 1] = 255;
      mid.data[i * 4 + 2] = 255;
      mid.data[i * 4 + 3] = v;
    }
    tmp.getContext("2d").putImageData(mid, 0, 0);
    const scaled = document.createElement("canvas");
    scaled.width = out.width;
    scaled.height = out.height;
    scaled.getContext("2d").drawImage(tmp, 0, 0, out.width, out.height);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(scaled, 0, 0);
    ctx.globalCompositeOperation = "source-over";
  }
  return hardenAlpha(out);
}

async function imglyCutout(img, onStatus = () => {}) {
  onStatus("AI 누끼 처리 중…");
  const mod = await import("https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.5/+esm");
  const removeBackground = mod.removeBackground || mod.default;
  if (typeof removeBackground !== "function") throw new Error("누끼 모듈 로드 실패");
  const srcBlob = await new Promise((r) => canvasFromImage(img).toBlob(r, "image/png"));
  const outBlob = await removeBackground(srcBlob, {
    output: { format: "image/png", quality: 0.95 },
    progress: (key, current, total) => {
      if (total) onStatus(`AI 누끼 ${key}: ${Math.round((current / total) * 100)}%`);
    },
  });
  const url = URL.createObjectURL(outBlob);
  try {
    return hardenAlpha(canvasFromImage(await loadImage(url)));
  } finally {
    URL.revokeObjectURL(url);
  }
}

function sampleCornerColors(d, w, h) {
  const pts = [
    [2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3],
    [Math.floor(w / 2), 2], [Math.floor(w / 2), h - 3],
    [2, Math.floor(h / 2)], [w - 3, Math.floor(h / 2)],
  ];
  return pts.map(([x, y]) => {
    const i = (y * w + x) * 4;
    return [d[i], d[i + 1], d[i + 2]];
  });
}

function floodAndChroma(img, thresh = 42) {
  const c = canvasFromImage(img);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  const w = c.width;
  const h = c.height;
  const imageData = ctx.getImageData(0, 0, w, h);
  const d = imageData.data;
  const visited = new Uint8Array(w * h);
  const corners = sampleCornerColors(d, w, h);
  const stack = [];

  for (const [sx, sy] of [
    [0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1],
    [Math.floor(w / 2), 0], [Math.floor(w / 2), h - 1],
    [0, Math.floor(h / 2)], [w - 1, Math.floor(h / 2)],
  ]) {
    const i = (sy * w + sx) * 4;
    stack.push([sx, sy, d[i], d[i + 1], d[i + 2]]);
  }

  while (stack.length) {
    const [x, y, br, bg, bb] = stack.pop();
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const idx = y * w + x;
    if (visited[idx]) continue;
    visited[idx] = 1;
    const i = idx * 4;
    if (colorDist(d[i], d[i + 1], d[i + 2], br, bg, bb) > thresh) continue;
    d[i + 3] = 0;
    stack.push([x + 1, y, br, bg, bb], [x - 1, y, br, bg, bb], [x, y + 1, br, bg, bb], [x, y - 1, br, bg, bb]);
  }

  // Kill plate colors similar to any corner sample (beige cards, white studio)
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const nearWhite = d[i] > 235 && d[i + 1] > 232 && d[i + 2] > 220;
    let nearPlate = nearWhite;
    for (const [cr, cg, cb] of corners) {
      if (colorDist(d[i], d[i + 1], d[i + 2], cr, cg, cb) < thresh + 8) {
        nearPlate = true;
        break;
      }
    }
    if (nearPlate) d[i + 3] = 0;
  }

  ctx.putImageData(imageData, 0, 0);
  return c;
}

function refineCutout(img, onStatus) {
  onStatus("상품 배경판 제거 중…");
  let best = floodAndChroma(img, 36);
  if (!isCutoutGood(best)) best = floodAndChroma(img, 52);
  if (!isCutoutGood(best)) best = floodAndChroma(img, 68);
  return best;
}

export async function processJewelryImage(url, onStatus = () => {}) {
  const img = await loadImage(url);
  if (hasTransparency(img)) {
    const c = canvasFromImage(img);
    if (isCutoutGood(c) || edgeOpaqueRatio(c) < 0.25) {
      const blob = await new Promise((r) => c.toBlob(r, "image/png"));
      return { canvas: c, blob, method: "native-alpha" };
    }
  }

  let canvas = null;
  let method = "flood-fill";

  // Prefer RMBG-1.4 (sharper jewelry edges) then img.ly
  try {
    canvas = await withTimeout(transformersCutout(img, onStatus), HEAVY_MS, "RMBG 시간 초과");
    method = "rmbg-1.4";
  } catch (err) {
    console.warn("rmbg failed", err);
    onStatus("대체 AI 누끼로 전환…");
    try {
      canvas = await withTimeout(imglyCutout(img, onStatus), 35000, "AI 누끼 시간 초과");
      method = "imgly-rembg";
    } catch (err2) {
      console.warn("imgly rembg failed", err2);
      onStatus("AI 누끼 실패 → 배경판 강제 제거…");
    }
  }

  if (canvas) canvas = hardenAlpha(canvas);

  if (!canvas || !isCutoutGood(canvas)) {
    const refined = refineCutout(img, onStatus);
    // Prefer refined if it clears edges better
    if (!canvas || edgeOpaqueRatio(refined) < edgeOpaqueRatio(canvas) - 0.05) {
      canvas = refined;
      method = "flood-chroma";
    } else if (!isCutoutGood(canvas)) {
      // Still plate-like from AI — wipe remaining edge plate colors
      canvas = refineCutout(await canvasToImage(canvas), onStatus);
      method = `${method}+refine`;
    }
  }

  if (!isCutoutGood(canvas)) {
    // Last resort: keep center subject by wiping strong edge plate only
    canvas = floodAndChroma(img, 78);
    method = "aggressive-chroma";
  }

  const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
  onStatus(`누끼 완료 (${method})`);
  return { canvas, blob, method };
}

function canvasToImage(canvas) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = canvas.toDataURL("image/png");
  });
}
