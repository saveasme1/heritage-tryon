/** Jewelry prepare — never blocks forever. */

import { processJewelryImage } from "./sam2.js";
import { getProcessed, putProcessed } from "./storage.js";
import { assetUrl } from "./portfolio.js";
import { despillCanvas } from "./tryon.js";

function resolveSrc(cover) {
  const v = String(cover || "").trim();
  if (!v) return "";
  if (/^(https?:|blob:|data:)/i.test(v)) return v;
  return assetUrl(v);
}

function load(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

export async function prepareJewelry(item, onStatus = () => {}) {
  const cacheId = `${item.id}::cut7`;
  try {
    const cached = await getProcessed(cacheId);
    if (cached?.blob) {
      const url = URL.createObjectURL(cached.blob);
      const img = await load(url);
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d").drawImage(img, 0, 0);
      despillCanvas(canvas);
      onStatus(`캐시된 투명 PNG 사용 (${cached.meta?.method || "cache"})`);
      return { canvas, blob: cached.blob, method: cached.meta?.method || "cache", objectUrl: url };
    }
  } catch (_) {}

  onStatus("주얼리 배경 처리 중…");
  const src = resolveSrc(item.cover);
  if (!src) throw new Error("주얼리 이미지 경로가 없습니다.");
  const { canvas, blob, method, error } = await processJewelryImage(src, onStatus);
  despillCanvas(canvas);
  const cleanBlob = await new Promise((r) => canvas.toBlob(r, "image/png"));
  try {
    await putProcessed(cacheId, cleanBlob || blob, { method, error: error || null, source: item.cover });
  } catch (_) {}
  const objectUrl = URL.createObjectURL(cleanBlob || blob);
  onStatus(`배경 처리 완료 (${method})`);
  return { canvas, blob: cleanBlob || blob, method, objectUrl };
}
