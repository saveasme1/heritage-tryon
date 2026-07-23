/**
 * Canvas-only jewelry placement (scale, rotate, soft shadow, alpha blend).
 * OpenCV.js removed — docs.opencv.org often never loads and used to hang forever.
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
  // expand one step for sampling skip
  minX = Math.max(0, minX - step);
  minY = Math.max(0, minY - step);
  maxX = Math.min(width - 1, maxX + step);
  maxY = Math.min(height - 1, maxY + step);
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * @param {HTMLImageElement|HTMLCanvasElement} bodyImg
 * @param {HTMLCanvasElement} jewelryCanvas
 * @param {{ center:{x,y}, width:number, angle:number, alt?: any }} target
 * @param {string} type ring|earring|necklace
 */
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

  const placeOne = (t) => {
    if (!t?.center) return;
    const targetW = Math.max(8, t.width || out.width * 0.12);
    const scale = targetW / Math.max(bounds.w, 1);
    let targetH = bounds.h * scale;
    if (type === "necklace") targetH = bounds.h * scale * 0.85;

    const angle = t.angle || 0;
    const rad = (angle * Math.PI) / 180;

    octx.save();
    octx.translate(t.center.x + targetW * 0.04, t.center.y + targetH * 0.06);
    octx.rotate(rad);
    octx.globalAlpha = 0.28;
    octx.filter = "blur(4px)";
    octx.drawImage(crop, -targetW / 2, -targetH / 2, targetW, targetH);
    octx.restore();

    octx.save();
    octx.translate(t.center.x, t.center.y);
    octx.rotate(rad);
    octx.globalAlpha = 0.96;
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = "high";
    octx.filter = "none";
    octx.drawImage(crop, -targetW / 2, -targetH / 2, targetW, targetH);
    octx.restore();
  };

  placeOne(target);
  if (type === "earring" && target?.alt) placeOne(target.alt);

  return out;
}

export function drawBefore(canvas, image) {
  const w = image.naturalWidth || image.width;
  const h = image.naturalHeight || image.height;
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(image, 0, 0, w, h);
}

/** Center fallback when MediaPipe fails — still produces a preview. */
export function fallbackTarget(bodyImg, type = "ring") {
  const w = bodyImg.naturalWidth || bodyImg.width || 1;
  const h = bodyImg.naturalHeight || bodyImg.height || 1;
  if (type === "earring") {
    return { center: { x: w * 0.28, y: h * 0.38 }, width: w * 0.08, angle: 8, alt: { center: { x: w * 0.72, y: h * 0.38 }, width: w * 0.08, angle: -8 } };
  }
  if (type === "necklace") {
    return { center: { x: w * 0.5, y: h * 0.42 }, width: w * 0.28, angle: 0 };
  }
  return { center: { x: w * 0.55, y: h * 0.55 }, width: w * 0.12, angle: -20 };
}
