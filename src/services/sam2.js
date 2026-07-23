/**
 * Jewelry cutout — fast path first.
 * Heavy ONNX segmentation is optional and timed out so UI never hangs.
 */

const USE_HEAVY_SEG = false; // MVP: avoid multi‑100MB model hang in iframe
const HEAVY_SEG_MS = 12000;

let segmenter = null;
let loading = null;

function withTimeout(promise, ms, label = "timeout") {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(label)), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

async function loadSegmenter() {
  if (segmenter) return segmenter;
  if (loading) return loading;
  loading = (async () => {
    const { pipeline, env } = await import("https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2");
    env.allowLocalModels = false;
    segmenter = await pipeline("image-segmentation", "Xenova/rmbg-1.4", { quantized: true });
    return segmenter;
  })();
  try {
    return await loading;
  } finally {
    loading = null;
  }
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
        const timer = setTimeout(() => ctrl.abort(), 5000);
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

function hasTransparency(img) {
  const c = document.createElement("canvas");
  const w = Math.min(64, img.naturalWidth || img.width);
  const h = Math.min(64, img.naturalHeight || img.height);
  if (!w || !h) return false;
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 250) return true;
  }
  return false;
}

function heuristicCutout(img) {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth || img.width;
  c.height = img.naturalHeight || img.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, c.width, c.height);
  const d = imageData.data;
  const samples = [
    0,
    (c.width - 1) * 4,
    (c.height - 1) * c.width * 4,
    ((c.height - 1) * c.width + (c.width - 1)) * 4,
  ];
  let br = 0, bg = 0, bb = 0;
  samples.forEach((i) => { br += d[i]; bg += d[i + 1]; bb += d[i + 2]; });
  br /= 4; bg /= 4; bb /= 4;
  let opaque = 0;
  for (let i = 0; i < d.length; i += 4) {
    const dr = d[i] - br;
    const dg = d[i + 1] - bg;
    const db = d[i + 2] - bb;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    const nearWhite = d[i] > 242 && d[i + 1] > 242 && d[i + 2] > 242;
    // Softer threshold — avoid wiping metallic jewelry to nothing.
    if (dist < 28 || nearWhite) d[i + 3] = 0;
    else opaque++;
  }
  // If cutout destroyed the product, keep the original pixels.
  if (opaque < (d.length / 4) * 0.02) {
    ctx.drawImage(img, 0, 0);
    return c;
  }
  ctx.putImageData(imageData, 0, 0);
  return c;
}

async function segmentCutout(img) {
  const model = await loadSegmenter();
  const result = await model(img);
  const c = document.createElement("canvas");
  c.width = img.naturalWidth || img.width;
  c.height = img.naturalHeight || img.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const mask = Array.isArray(result) ? result[0] : result;
  if (mask?.mask?.width && mask.mask.data) {
    const tmp = document.createElement("canvas");
    tmp.width = mask.mask.width;
    tmp.height = mask.mask.height;
    const id = tmp.getContext("2d").createImageData(mask.mask.width, mask.mask.height);
    for (let i = 0; i < mask.mask.data.length; i++) {
      const v = mask.mask.data[i] > 0.5 ? 255 : 0;
      id.data[i * 4] = 255;
      id.data[i * 4 + 1] = 255;
      id.data[i * 4 + 2] = 255;
      id.data[i * 4 + 3] = v;
    }
    tmp.getContext("2d").putImageData(id, 0, 0);
    const mctx = document.createElement("canvas");
    mctx.width = c.width;
    mctx.height = c.height;
    mctx.getContext("2d").drawImage(tmp, 0, 0, c.width, c.height);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(mctx, 0, 0);
    ctx.globalCompositeOperation = "source-over";
  }
  return c;
}

/**
 * Ensure jewelry PNG with transparency. Returns { canvas, blob, method }
 */
export async function processJewelryImage(url) {
  const img = await loadImage(url);
  if (hasTransparency(img)) {
    const c = document.createElement("canvas");
    c.width = img.naturalWidth || img.width;
    c.height = img.naturalHeight || img.height;
    c.getContext("2d").drawImage(img, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    return { canvas: c, blob, method: "native-alpha" };
  }

  if (USE_HEAVY_SEG) {
    try {
      const canvas = await withTimeout(segmentCutout(img), HEAVY_SEG_MS, "배경제거 시간 초과");
      const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
      return { canvas, blob, method: "onnx-segmentation" };
    } catch (err) {
      console.warn("seg failed, heuristic", err);
    }
  }

  const canvas = heuristicCutout(img);
  const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
  return { canvas, blob, method: "heuristic" };
}
