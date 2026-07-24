/**
 * Jewelry placement — cylindrical bracelet wrap (not flat sticker).
 * Uses MediaPipe wrist geometry + metal texture from rembg cutout.
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
  if (type === "bracelet") return outW * 0.22;
  if (type === "necklace") return outW * 0.22;
  if (type === "earring") return outW * 0.07;
  return outW * 0.085;
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function sampleBilinear(data, tw, th, x, y) {
  const x0 = clamp(Math.floor(x), 0, tw - 1);
  const y0 = clamp(Math.floor(y), 0, th - 1);
  const x1 = clamp(x0 + 1, 0, tw - 1);
  const y1 = clamp(y0 + 1, 0, th - 1);
  const fx = x - x0;
  const fy = y - y0;
  const i00 = (y0 * tw + x0) * 4;
  const i10 = (y0 * tw + x1) * 4;
  const i01 = (y1 * tw + x0) * 4;
  const i11 = (y1 * tw + x1) * 4;
  const mix = (a, b, t) => a + (b - a) * t;
  const r = mix(mix(data[i00], data[i10], fx), mix(data[i01], data[i11], fx), fy);
  const g = mix(mix(data[i00 + 1], data[i10 + 1], fx), mix(data[i01 + 1], data[i11 + 1], fx), fy);
  const b = mix(mix(data[i00 + 2], data[i10 + 2], fx), mix(data[i01 + 2], data[i11 + 2], fx), fy);
  const a = mix(mix(data[i00 + 3], data[i10 + 3], fx), mix(data[i01 + 3], data[i11 + 3], fx), fy);
  return [r, g, b, a];
}

/** Average opaque metal color + build 1D circumferential texture strip. */
function buildMetalStrip(crop, stripW = 512, stripH = 48) {
  const ctx = crop.getContext("2d", { willReadFrequently: true });
  const { data, width: tw, height: th } = ctx.getImageData(0, 0, crop.width, crop.height);
  let sr = 0, sg = 0, sb = 0, n = 0;
  const step = Math.max(1, Math.floor(Math.min(tw, th) / 120));
  for (let y = 0; y < th; y += step) {
    for (let x = 0; x < tw; x += step) {
      const i = (y * tw + x) * 4;
      if (data[i + 3] < 80) continue;
      // skip near-white plate leftovers
      if (data[i] > 235 && data[i + 1] > 235 && data[i + 2] > 230) continue;
      sr += data[i];
      sg += data[i + 1];
      sb += data[i + 2];
      n++;
    }
  }
  const avg = n
    ? [sr / n, sg / n, sb / n]
    : [212, 175, 95];

  const strip = document.createElement("canvas");
  strip.width = stripW;
  strip.height = stripH;
  const sctx = strip.getContext("2d", { willReadFrequently: true });
  const sid = sctx.createImageData(stripW, stripH);
  const sd = sid.data;

  // Sample crop along a ring path if oval-like, else scan row by luminance
  for (let u = 0; u < stripW; u++) {
    const t = u / stripW;
    // walk a horizontal band across the crop mid-height (bracelet product arcs)
    const srcX = t * (tw - 1);
    for (let v = 0; v < stripH; v++) {
      const srcY = (0.25 + (v / stripH) * 0.5) * (th - 1);
      let [r, g, b, a] = sampleBilinear(data, tw, th, srcX, srcY);
      if (a < 40) {
        // fallback to average metal with slight variation
        const wobble = 0.92 + 0.16 * Math.sin(t * Math.PI * 8 + v * 0.2);
        r = avg[0] * wobble;
        g = avg[1] * wobble;
        b = avg[2] * wobble;
        a = 255;
      }
      const o = (v * stripW + u) * 4;
      sd[o] = r;
      sd[o + 1] = g;
      sd[o + 2] = b;
      sd[o + 3] = 255;
    }
  }
  sctx.putImageData(sid, 0, 0);
  return { strip, avg };
}

/**
 * True elliptical cylinder band around wrist — front visible, back occluded,
 * metal texture + specular, contact shadow. Not a flat product paste.
 */
function wrapBraceletCylinder(layerCtx, bodyCanvas, crop, center, wristW, angleDeg, frontAngleDeg) {
  const across = (angleDeg * Math.PI) / 180;
  const frontAng = ((frontAngleDeg != null ? frontAngleDeg : angleDeg - 90) * Math.PI) / 180;
  const rx = Math.max(12, wristW * 0.48);
  const ry = Math.max(8, rx * 0.38);
  const thickness = clamp(rx * 0.22, 6, rx * 0.32);
  const { strip, avg } = buildMetalStrip(crop);
  const stripCtx = strip.getContext("2d", { willReadFrequently: true });
  const { data: td, width: sw, height: sh } = stripCtx.getImageData(0, 0, strip.width, strip.height);

  const cosA = Math.cos(across);
  const sinA = Math.sin(across);
  const pad = Math.ceil(rx + thickness + 8);
  const x0 = Math.max(0, Math.floor(center.x - pad));
  const y0 = Math.max(0, Math.floor(center.y - pad));
  const x1 = Math.min(layerCtx.canvas.width, Math.ceil(center.x + pad));
  const y1 = Math.min(layerCtx.canvas.height, Math.ceil(center.y + pad));
  const bw = Math.max(1, x1 - x0);
  const bh = Math.max(1, y1 - y0);

  const band = layerCtx.createImageData(bw, bh);
  const bd = band.data;
  const rInner = 1 - thickness / (rx * 2.2);
  const rOuter = 1 + thickness / (rx * 2.2);

  // Contact shadow under band (body space)
  layerCtx.save();
  layerCtx.translate(center.x, center.y);
  layerCtx.rotate(across);
  const shadow = layerCtx.createRadialGradient(0, ry * 0.15, rx * 0.2, 0, ry * 0.2, rx * 0.95);
  shadow.addColorStop(0, "rgba(0,0,0,0.28)");
  shadow.addColorStop(0.55, "rgba(0,0,0,0.12)");
  shadow.addColorStop(1, "rgba(0,0,0,0)");
  layerCtx.fillStyle = shadow;
  layerCtx.beginPath();
  layerCtx.ellipse(0, ry * 0.12, rx * 0.92, ry * 0.7, 0, 0, Math.PI * 2);
  layerCtx.fill();
  layerCtx.restore();

  for (let py = 0; py < bh; py++) {
    for (let px = 0; px < bw; px++) {
      const gx = x0 + px + 0.5;
      const gy = y0 + py + 0.5;
      const dx = gx - center.x;
      const dy = gy - center.y;
      // rotate into bracelet local frame (X across wrist, Y along forearm)
      const lx = dx * cosA + dy * sinA;
      const ly = -dx * sinA + dy * cosA;
      const nx = lx / rx;
      const ny = ly / ry;
      const er = Math.hypot(nx, ny);
      if (er < rInner || er > rOuter) continue;

      const theta = Math.atan2(ny, nx);
      // Facing camera: prefer the "top" of the cylinder toward knuckles (frontAng)
      const viewDot = Math.cos(theta - (frontAng - across));
      // Hide back of wrist (negative hemisphere)
      if (viewDot < -0.08) continue;

      const u = ((theta / (Math.PI * 2)) + 0.5) * (sw - 1);
      const v = ((er - rInner) / Math.max(1e-6, rOuter - rInner)) * (sh - 1);
      let [r, g, b, a] = sampleBilinear(td, sw, sh, u, v);
      if (a < 8) {
        r = avg[0];
        g = avg[1];
        b = avg[2];
        a = 255;
      }

      // Cylinder shading + specular
      const shade = 0.42 + 0.58 * Math.max(0, viewDot);
      const spec = Math.pow(Math.max(0, viewDot), 18) * 70;
      // rim light on band edges
      const rim = Math.pow(1 - Math.abs((er - (rInner + rOuter) / 2) / ((rOuter - rInner) / 2)), 2) * 18;
      r = clamp(r * shade + spec + rim, 0, 255);
      g = clamp(g * shade + spec * 0.92 + rim * 0.85, 0, 255);
      b = clamp(b * shade + spec * 0.7 + rim * 0.55, 0, 255);

      // Soft AA near band edges
      const edge = Math.min(
        Math.abs(er - rInner) / 0.04,
        Math.abs(er - rOuter) / 0.04,
        1
      );
      const alpha = clamp(a * edge * (0.55 + 0.45 * Math.max(0, viewDot)), 0, 255);

      const o = (py * bw + px) * 4;
      bd[o] = r;
      bd[o + 1] = g;
      bd[o + 2] = b;
      bd[o + 3] = alpha;
    }
  }

  // Soft screw / stud accents along circumference (Love-bracelet cue) using darker metal
  for (let k = 0; k < 8; k++) {
    const th = -Math.PI * 0.85 + (k / 7) * Math.PI * 1.7;
    const viewDot = Math.cos(th - (frontAng - across));
    if (viewDot < 0.15) continue;
    const lx = Math.cos(th) * rx;
    const ly = Math.sin(th) * ry;
    const gx = center.x + lx * cosA - ly * sinA;
    const gy = center.y + lx * sinA + ly * cosA;
    const sx = Math.floor(gx - x0);
    const sy = Math.floor(gy - y0);
    const rad = Math.max(2, thickness * 0.28);
    for (let yy = -rad; yy <= rad; yy++) {
      for (let xx = -rad; xx <= rad; xx++) {
        if (xx * xx + yy * yy > rad * rad) continue;
        const px = sx + xx;
        const py = sy + yy;
        if (px < 0 || py < 0 || px >= bw || py >= bh) continue;
        const o = (py * bw + px) * 4;
        if (bd[o + 3] < 40) continue;
        const dark = 0.72 + 0.2 * (1 - Math.hypot(xx, yy) / rad);
        bd[o] *= dark;
        bd[o + 1] *= dark;
        bd[o + 2] *= dark * 0.95;
        bd[o + 3] = Math.max(bd[o + 3], 220);
      }
    }
  }

  const tmp = document.createElement("canvas");
  tmp.width = bw;
  tmp.height = bh;
  tmp.getContext("2d").putImageData(band, 0, 0);
  layerCtx.drawImage(tmp, x0, y0);

  // Skin shows through inner hole — stamp body into ellipse interior
  layerCtx.save();
  layerCtx.translate(center.x, center.y);
  layerCtx.rotate(across);
  layerCtx.beginPath();
  layerCtx.ellipse(0, 0, rx * rInner * 0.98, ry * rInner * 0.98, 0, 0, Math.PI * 2);
  layerCtx.clip();
  layerCtx.setTransform(1, 0, 0, 1, 0, 0);
  layerCtx.drawImage(bodyCanvas, 0, 0);
  layerCtx.restore();
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
    if (type === "necklace") targetH = targetW * aspect * 0.9;

    const angle = t.angle || 0;

    if (type === "bracelet") {
      wrapBraceletCylinder(
        lctx,
        bodyCanvas,
        crop,
        t.center,
        targetW,
        angle,
        t.frontAngle
      );
      return;
    }

    if (type === "ring") {
      // Thin band around finger (same cylinder model, smaller radius)
      wrapBraceletCylinder(
        lctx,
        bodyCanvas,
        crop,
        t.center,
        Math.max(targetW * 1.15, out.width * 0.06),
        (t.angle || 0) + 90,
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
      center: { x: w * 0.5, y: h * 0.42 },
      width: w * 0.28,
      angle: 8,
      frontAngle: -90,
    };
  }
  return { center: { x: w * 0.55, y: h * 0.28 }, width: w * 0.09, angle: -15 };
}
