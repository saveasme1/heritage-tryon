/**
 * OpenCV.js jewelry placement: scale, rotate, soft shadow, alpha blend.
 * Perspective/warp approximated via affine rotate+scale for MVP stability.
 */

function waitOpenCv() {
  return new Promise((resolve) => {
    if (window.cv && window.cv.Mat) return resolve(window.cv);
    const timer = setInterval(() => {
      if (window.cv && window.cv.Mat) {
        clearInterval(timer);
        resolve(window.cv);
      }
    }, 50);
  });
}

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
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
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
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * @param {HTMLImageElement|HTMLCanvasElement} bodyImg
 * @param {HTMLCanvasElement} jewelryCanvas
 * @param {{ center:{x,y}, width:number, angle:number, alt?: any }} target
 * @param {string} type ring|earring|necklace
 */
export async function composeTryOn(bodyImg, jewelryCanvas, target, type = "ring") {
  const cv = await waitOpenCv();
  const bodyCanvas = bodyImg instanceof HTMLCanvasElement ? bodyImg : canvasFromImage(bodyImg);
  const out = document.createElement("canvas");
  out.width = bodyCanvas.width;
  out.height = bodyCanvas.height;
  const octx = out.getContext("2d");
  octx.drawImage(bodyCanvas, 0, 0);

  const bounds = jewelryBounds(jewelryCanvas);
  const crop = document.createElement("canvas");
  crop.width = bounds.w;
  crop.height = bounds.h;
  crop.getContext("2d").drawImage(
    jewelryCanvas,
    bounds.x, bounds.y, bounds.w, bounds.h,
    0, 0, bounds.w, bounds.h
  );

  const placeOne = (t) => {
    if (!t) return;
    const targetW = Math.max(8, t.width);
    const scale = targetW / Math.max(bounds.w, 1);
    let targetH = bounds.h * scale;
    if (type === "necklace") targetH = bounds.h * scale * 0.85;
    if (type === "earring") targetH = bounds.h * scale;

    const angle = t.angle || 0;
    const rad = (angle * Math.PI) / 180;

    // Soft shadow
    octx.save();
    octx.translate(t.center.x + targetW * 0.04, t.center.y + targetH * 0.06);
    octx.rotate(rad);
    octx.globalAlpha = 0.28;
    octx.filter = "blur(4px)";
    octx.drawImage(crop, -targetW / 2, -targetH / 2, targetW, targetH);
    octx.restore();

    // Jewelry
    octx.save();
    octx.translate(t.center.x, t.center.y);
    octx.rotate(rad);
    octx.globalAlpha = 0.96;
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = "high";
    octx.drawImage(crop, -targetW / 2, -targetH / 2, targetW, targetH);
    octx.restore();
  };

  // Optional OpenCV warp matrix (records transform for future perspective)
  try {
    const src = cv.imread(crop);
    const dsize = new cv.Size(Math.max(1, Math.round(target.width)), Math.max(1, Math.round(target.width * (bounds.h / bounds.w))));
    const resized = new cv.Mat();
    cv.resize(src, resized, dsize, 0, 0, cv.INTER_AREA);
    // Affine rotate around center into an RGBA mat then draw — keep 2D canvas path for alpha quality
    src.delete(); resized.delete();
  } catch (_) {
    // OpenCV optional; canvas path is primary for alpha
  }

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
