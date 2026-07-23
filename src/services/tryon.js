/**
 * Jewelry placement — sharp cutout + bracelet wrap (front band visible, back hidden).
 */

function canvasFromImage(img) {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth || img.width;
  c.height = img.naturalHeight || img.height;
  c.getContext("2d").drawImage(img, 0, 0);
  return c;
}

function jewelryBounds(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let minX = width, minY = height, maxX = 0, maxY = 0, found = false;
  const step = Math.max(1, Math.floor(Math.min(width, height) / 500));
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (data[(y * width + x) * 4 + 3] > 24) {
        found = true;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (!found) return { x: 0, y: 0, w: width, h: height };
  return {
    x: Math.max(0, minX - step),
    y: Math.max(0, minY - step),
    w: Math.min(width - 1, maxX + step) - Math.max(0, minX - step) + 1,
    h: Math.min(height - 1, maxY + step) - Math.max(0, minY - step) + 1,
  };
}

/** Kill white/halo fringe left by rembg. */
export function despillCanvas(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const { width: w, height: h } = canvas;
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;
  const alphaAt = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return 0;
    return d[(y * w + x) * 4 + 3];
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = d[i + 3];
      if (a === 0) continue;
      if (a < 40) {
        d[i + 3] = 0;
        continue;
      }
      const nearClear =
        alphaAt(x - 1, y) < 20 ||
        alphaAt(x + 1, y) < 20 ||
        alphaAt(x, y - 1) < 20 ||
        alphaAt(x, y + 1) < 20;
      const bright = d[i] > 228 && d[i + 1] > 228 && d[i + 2] > 220;
      if (nearClear && bright) d[i + 3] = 0;
      else if (a > 200) d[i + 3] = 255;
    }
  }
  ctx.putImageData(id, 0, 0);
  return canvas;
}

function minWidthForType(outW, type) {
  if (type === "bracelet") return outW * 0.34;
  if (type === "necklace") return outW * 0.22;
  if (type === "earring") return outW * 0.07;
  return outW * 0.085;
}

/**
 * Bracelet wrap: show upper band on skin, hide lower band behind wrist with body stamp.
 */
function wrapBracelet(layerCtx, bodyCanvas, crop, center, targetW, targetH, angleDeg, frontAngleDeg) {
  const across = (angleDeg * Math.PI) / 180;
  const front = ((frontAngleDeg != null ? frontAngleDeg : angleDeg + 90) * Math.PI) / 180;
  // Local axes: after rotate(across), X = along band, Y = along forearm
  // Hide side = opposite of knuckles (front)
  const hideRot = front + Math.PI / 2;

  // 1) Soft contact shadow on body (drawn later under jewelry via layer order — draw first on layer)
  layerCtx.save();
  layerCtx.translate(center.x, center.y);
  layerCtx.rotate(across);
  layerCtx.fillStyle = "rgba(0,0,0,0.22)";
  layerCtx.beginPath();
  layerCtx.ellipse(0, targetH * 0.06, targetW * 0.42, targetH * 0.18, 0, 0, Math.PI * 2);
  layerCtx.fill();
  layerCtx.restore();

  // 2) Full jewelry
  layerCtx.save();
  layerCtx.translate(center.x, center.y);
  layerCtx.rotate(across);
  layerCtx.imageSmoothingEnabled = true;
  layerCtx.imageSmoothingQuality = "high";
  layerCtx.drawImage(crop, -targetW / 2, -targetH / 2, targetW, targetH);
  layerCtx.restore();

  // 3) Cover hole + back half with body pixels (wrist goes through / hides back)
  const stamp = (pathFn) => {
    layerCtx.save();
    layerCtx.translate(center.x, center.y);
    layerCtx.rotate(hideRot);
    layerCtx.beginPath();
    pathFn(layerCtx);
    layerCtx.clip();
    layerCtx.setTransform(1, 0, 0, 1, 0, 0);
    layerCtx.drawImage(bodyCanvas, 0, 0);
    layerCtx.restore();
  };

  stamp((ctx) => {
    ctx.ellipse(0, 0, targetW * 0.3, Math.max(targetH * 0.3, targetW * 0.12), 0, 0, Math.PI * 2);
  });
  stamp((ctx) => {
    // Only the far half of the band (behind wrist)
    ctx.rect(-targetW * 0.55, targetH * 0.02, targetW * 1.1, targetH * 0.55);
  });
}

export async function composeTryOn(bodyImg, jewelryCanvas, target, type = "ring") {
  const bodyCanvas = bodyImg instanceof HTMLCanvasElement ? bodyImg : canvasFromImage(bodyImg);
  const out = document.createElement("canvas");
  out.width = bodyCanvas.width;
  out.height = bodyCanvas.height;
  const octx = out.getContext("2d");
  octx.drawImage(bodyCanvas, 0, 0);

  despillCanvas(jewelryCanvas);
  const bounds = jewelryBounds(jewelryCanvas);
  const crop = document.createElement("canvas");
  crop.width = Math.max(1, bounds.w);
  crop.height = Math.max(1, bounds.h);
  crop.getContext("2d").drawImage(
    jewelryCanvas,
    bounds.x, bounds.y, bounds.w, bounds.h,
    0, 0, crop.width, crop.height
  );
  despillCanvas(crop);

  const layer = document.createElement("canvas");
  layer.width = out.width;
  layer.height = out.height;
  const lctx = layer.getContext("2d");

  const placeOne = (t) => {
    if (!t?.center) return;
    let targetW = Math.max(8, t.width || out.width * 0.12);
    targetW = Math.max(targetW, minWidthForType(out.width, type));
    const aspect = crop.height / Math.max(crop.width, 1);
    let targetH = targetW * aspect;
    if (type === "bracelet") {
      targetH = Math.min(Math.max(targetW * Math.min(aspect, 1.05), targetW * 0.62), targetW * 1.05);
    }
    if (type === "necklace") targetH = targetW * aspect * 0.9;

    const angle = t.angle || 0;

    if (type === "bracelet") {
      wrapBracelet(
        lctx,
        bodyCanvas,
        crop,
        t.center,
        targetW,
        targetH,
        angle,
        t.frontAngle
      );
      return;
    }

    lctx.save();
    lctx.translate(t.center.x, t.center.y);
    lctx.rotate((angle * Math.PI) / 180);
    lctx.imageSmoothingEnabled = true;
    lctx.imageSmoothingQuality = "high";
    lctx.drawImage(crop, -targetW / 2, -targetH / 2, targetW, targetH);
    lctx.restore();
  };

  placeOne(target);
  // Earrings: only selected side (no alt double)
  octx.drawImage(layer, 0, 0);
  return out;
}

export function drawBefore(canvas, image) {
  const w = image.naturalWidth || image.width;
  const h = image.naturalHeight || image.height;
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(image, 0, 0, w, h);
}

/** Fallback aligned with camera guide layout (hand↑ wrist~32% from top). */
export function fallbackTarget(bodyImg, type = "ring") {
  const w = bodyImg.naturalWidth || bodyImg.width || 1;
  const h = bodyImg.naturalHeight || bodyImg.height || 1;
  if (type === "earring") {
    return { center: { x: w * 0.72, y: h * 0.42 }, width: w * 0.07, angle: -8 };
  }
  if (type === "necklace") {
    return { center: { x: w * 0.5, y: h * 0.48 }, width: w * 0.28, angle: 0 };
  }
  if (type === "bracelet") {
    return {
      center: { x: w * 0.5, y: h * 0.34 },
      width: w * 0.4,
      angle: 0,
      frontAngle: -90,
    };
  }
  return { center: { x: w * 0.55, y: h * 0.28 }, width: w * 0.09, angle: -15 };
}
