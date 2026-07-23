/**
 * Canvas-only jewelry placement (scale, rotate, soft shadow, alpha blend).
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
  if (type === "bracelet") return outW * 0.28;
  if (type === "necklace") return outW * 0.22;
  if (type === "earring") return outW * 0.07;
  return outW * 0.09; // ring
}

/**
 * @param {HTMLImageElement|HTMLCanvasElement} bodyImg
 * @param {HTMLCanvasElement} jewelryCanvas
 * @param {{ center:{x,y}, width:number, angle:number, alt?: any }} target
 * @param {string} type ring|bracelet|earring|necklace
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
    let targetW = Math.max(8, t.width || out.width * 0.12);
    targetW = Math.max(targetW, minWidthForType(out.width, type));

    const aspect = crop.height / Math.max(crop.width, 1);
    let targetH = targetW * aspect;
    if (type === "bracelet") {
      // Wrist band: keep it wide, not a tiny finger ring.
      targetH = Math.min(targetH, targetW * 0.55);
      targetH = Math.max(targetH, targetW * 0.22);
    }
    if (type === "necklace") targetH = targetW * aspect * 0.9;

    const angle = t.angle || 0;
    const rad = (angle * Math.PI) / 180;

    octx.save();
    octx.translate(t.center.x + targetW * 0.03, t.center.y + targetH * 0.05);
    octx.rotate(rad);
    octx.globalAlpha = 0.25;
    octx.filter = "blur(5px)";
    octx.drawImage(crop, -targetW / 2, -targetH / 2, targetW, targetH);
    octx.restore();

    octx.save();
    octx.translate(t.center.x, t.center.y);
    octx.rotate(rad);
    octx.globalAlpha = 1;
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

/** Fallback when MediaPipe fails. */
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
    // Wrist-ish zone for typical forearm/hand photos
    return { center: { x: w * 0.42, y: h * 0.55 }, width: w * 0.32, angle: -35 };
  }
  return { center: { x: w * 0.55, y: h * 0.45 }, width: w * 0.1, angle: -20 };
}
