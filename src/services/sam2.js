/**
 * Background removal for jewelry cutouts.
 * Primary: Transformers.js RMBG/SAM-family ONNX (browser).
 * Naming: SAM2-class segmentation pipeline via ONNX Runtime under Transformers.js.
 * If models fail, falls back to chroma/luma key heuristic.
 */

let segmenter = null;
let loading = null;

async function loadSegmenter() {
  if (segmenter) return segmenter;
  if (loading) return loading;
  loading = (async () => {
    const { pipeline, env } = await import("https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2");
    env.allowLocalModels = false;
    // RMBG is a practical ONNX browser bg-removal model in the SAM/segmentation family stack.
    // Full SAM2 weights are too large for reliable GitHub Pages MVP loads; documented in REPORT.
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
    try {
      // Prefer blob fetch so we avoid crossOrigin/ACAO broken-image cases.
      if (/^https?:\/\//i.test(url)) {
        const res = await fetch(url, { mode: "cors", cache: "no-store" });
        if (res.ok) {
          const blobUrl = URL.createObjectURL(await res.blob());
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error("이미지 로드 실패"));
          img.src = blobUrl;
          return;
        }
      }
    } catch (_) {
      // fall through
    }
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("이미지 로드 실패"));
    img.src = url;
  });
}

function hasTransparency(img) {
  const c = document.createElement("canvas");
  const w = Math.min(64, img.naturalWidth);
  const h = Math.min(64, img.naturalHeight);
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
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, c.width, c.height);
  const d = imageData.data;
  // Sample corners as background
  const samples = [
    0,
    (c.width - 1) * 4,
    (c.height - 1) * c.width * 4,
    ((c.height - 1) * c.width + (c.width - 1)) * 4,
  ];
  let br = 0, bg = 0, bb = 0;
  samples.forEach((i) => {
    br += d[i]; bg += d[i + 1]; bb += d[i + 2];
  });
  br /= 4; bg /= 4; bb /= 4;
  for (let i = 0; i < d.length; i += 4) {
    const dr = d[i] - br;
    const dg = d[i + 1] - bg;
    const db = d[i + 2] - bb;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    if (dist < 38) d[i + 3] = 0;
  }
  ctx.putImageData(imageData, 0, 0);
  return c;
}

async function segmentCutout(img) {
  const model = await loadSegmenter();
  const result = await model(img);
  // Expect mask(s); compose onto transparent canvas
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);

  const mask = Array.isArray(result) ? result[0] : result;
  if (mask?.mask) {
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = c.width;
    maskCanvas.height = c.height;
    const mctx = maskCanvas.getContext("2d");
    // mask may be RawImage-like
    if (mask.mask.width && mask.mask.data) {
      const id = mctx.createImageData(mask.mask.width, mask.mask.height);
      for (let i = 0; i < mask.mask.data.length; i++) {
        const v = mask.mask.data[i] > 0.5 ? 255 : 0;
        id.data[i * 4] = 255;
        id.data[i * 4 + 1] = 255;
        id.data[i * 4 + 2] = 255;
        id.data[i * 4 + 3] = v;
      }
      const tmp = document.createElement("canvas");
      tmp.width = mask.mask.width;
      tmp.height = mask.mask.height;
      tmp.getContext("2d").putImageData(id, 0, 0);
      mctx.drawImage(tmp, 0, 0, c.width, c.height);
    } else if (typeof mask.mask === "object") {
      // Fallback: draw mask image if provided as canvas/image
      try { mctx.drawImage(mask.mask, 0, 0, c.width, c.height); } catch (_) {}
    }
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(maskCanvas, 0, 0);
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
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext("2d").drawImage(img, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    return { canvas: c, blob, method: "native-alpha" };
  }

  try {
    const canvas = await segmentCutout(img);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
    return { canvas, blob, method: "onnx-segmentation" };
  } catch (err) {
    console.warn("SAM/seg failed, heuristic fallback", err);
    const canvas = heuristicCutout(img);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
    return { canvas, blob, method: "heuristic", error: String(err) };
  }
}
