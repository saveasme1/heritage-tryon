/**
 * Canvas jewelry placement.
 * Bracelet: show only the front band; cover hole + rear band with body pixels
 * so the back of the bracelet is hidden behind the wrist.
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
  const step = Math.max(1, Math.floor(Math.min(width, height) / 400));
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const a = data[(y * width + x) * 4 + 3];
      if (a > 12) {
        found = true;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (!found) return { x: 0, y: 0, w: width, h: height };
  minX = Math.max(0, minX - step);
  minY = Math.max(0, minY - step);
  maxX = Math.min(width - 1, maxX + step);
  maxY = Math.min(height - 1, maxY + step);
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function minWidthForType(outW, type) {
  if (type === "bracelet") return outW * 0.34;
  if (type === "necklace") return outW * 0.22;
  if (type === "earring") return outW * 0.07;
  return outW * 0.09;
}

/**
 * Cover bracelet hole + rear band with body pixels (wrist hides the back).
 */
function occludeBraceletWithBody(layerCtx, bodyCanvas, center, targetW, targetH, acrossAngleDeg, frontAngleDeg) {
  const front = ((frontAngleDeg != null ? frontAngleDeg : acrossAngleDeg + 90) * Math.PI) / 180;
  // Local +Y = hidden side (opposite knuckles)
  const hideRot = front + Math.PI / 2;

  const stamp = (buildPath) => {
    layerCtx.save();
    layerCtx.translate(center.x, center.y);
    layerCtx.rotate(hideRot);
    layerCtx.beginPath();
    buildPath(layerCtx);
    layerCtx.clip();
    layerCtx.setTransform(1, 0, 0, 1, 0, 0);
    layerCtx.drawImage(bodyCanvas, 0, 0);
    layerCtx.restore();
  };

  // 1) Wrist through the middle (open the bracelet)
  stamp((ctx) => {
    ctx.ellipse(0, 0, targetW * 0.33, Math.max(targetH * 0.34, targetW * 0.13), 0, 0, Math.PI * 2);
  });

  // 2) Rear band behind wrist
  stamp((ctx) => {
    ctx.rect(-targetW * 0.58, targetH * 0.02, targetW * 1.16, targetH * 0.65);
    ctx.ellipse(0, targetH * 0.12, targetW * 0.55, targetH * 0.48, 0, 0, Math.PI * 2);
  });
}

export async function composeTryOn(bodyImg, jewelryCanvas, target, type = "ring") {
  const bodyCanvas = bodyImg instanceof HTMLCanvasElement ? bodyImg : canvasFromImage(bodyImg);
  const out = document.createElement("canvas");
  out.width = bodyCanvas.width;
  out.height = bodyCanvas.height;
  const octx = out.getContext("2d");
  octx.drawImage(bodyCanvas, 0, 0);

  const bounds = jewelryBounds(jewelryCanvas);
  const crop = document.createElement("canvas");
  crop.width = Math.max(1, bounds.w);
  crop.height = Math.max(1, bounds.h);
  crop.getContext("2d").drawImage(
    jewelryCanvas,
    bounds.x, bounds.y, bounds.w, bounds.h,
    0, 0, crop.width, crop.height
  );

  const layer = document.createElement("canvas");
  layer.width = out.width;
  layer.height = out.height;
  const lctx = layer.getContext("2d");

  const placeOne = (t, withOcclusion) => {
    if (!t?.center) return;
    let targetW = Math.max(8, t.width || out.width * 0.12);
    targetW = Math.max(targetW, minWidthForType(out.width, type));
    const aspect = crop.height / Math.max(crop.width, 1);
    let targetH = targetW * aspect;
    if (type === "bracelet") {
      targetH = Math.min(Math.max(targetW * aspect, targetW * 0.28), targetW * 0.62);
    }
    if (type === "necklace") targetH = targetW * aspect * 0.9;

    const angle = t.angle || 0;
    const rad = (angle * Math.PI) / 180;

    lctx.save();
    lctx.translate(t.center.x + targetW * 0.02, t.center.y + targetH * 0.04);
    lctx.rotate(rad);
    lctx.globalAlpha = 0.2;
    lctx.filter = "blur(4px)";
    lctx.drawImage(crop, -targetW / 2, -targetH / 2, targetW, targetH);
    lctx.restore();

    lctx.save();
    lctx.translate(t.center.x, t.center.y);
    lctx.rotate(rad);
    lctx.globalAlpha = 1;
    lctx.imageSmoothingEnabled = true;
    lctx.imageSmoothingQuality = "high";
    lctx.filter = "none";
    lctx.drawImage(crop, -targetW / 2, -targetH / 2, targetW, targetH);
    lctx.restore();

    if (withOcclusion && type === "bracelet") {
      const frontAngle = t.frontAngle != null ? t.frontAngle : angle + 90;
      occludeBraceletWithBody(lctx, bodyCanvas, t.center, targetW, targetH, angle, frontAngle);
    }
  };

  placeOne(target, true);
  if (type === "earring" && target?.alt) placeOne(target.alt, false);

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

export function fallbackTarget(bodyImg, type = "ring") {
  const w = bodyImg.naturalWidth || bodyImg.width || 1;
  const h = bodyImg.naturalHeight || bodyImg.height || 1;
  if (type === "earring") {
    return {
      center: { x: w * 0.28, y: h * 0.38 },
      width: w * 0.08,
      angle: 8,
      alt: { center: { x: w * 0.72, y: h * 0.38 }, width: w * 0.08, angle: -8 },
    };
  }
  if (type === "necklace") {
    return { center: { x: w * 0.5, y: h * 0.42 }, width: w * 0.28, angle: 0 };
  }
  if (type === "bracelet") {
    return {
      center: { x: w * 0.38, y: h * 0.62 },
      width: w * 0.38,
      angle: -40,
      frontAngle: -40 + 90,
    };
  }
  return { center: { x: w * 0.55, y: h * 0.45 }, width: w * 0.1, angle: -20 };
}
