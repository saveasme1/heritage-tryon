/** Jewelry prepare — never blocks forever. */

import { processJewelryImage } from "./sam2.js";
import { getProcessed, putProcessed } from "./storage.js";
import { assetUrl } from "./portfolio.js";

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
  const cacheId = `${item.id}::cut6`;
  try {
    const cached = await getProcessed(cacheId);
    if (cached?.blob) {
      const url = URL.createObjectURL(cached.blob);
      const img = await load(url);
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d").drawImage(img, 0, 0);
      onStatus(`캐시된 투명 PNG 사용 (${cached.meta?.method || "cache"})`);
      return { canvas, blob: cached.blob, method: cached.meta?.method || "cache", objectUrl: url };
    }
  } catch (_) {
    // ignore cache errors
  }

  onStatus("주얼리 배경 처리 중…");
  const src = resolveSrc(item.cover);
  if (!src) throw new Error("주얼리 이미지 경로가 없습니다.");
  const { canvas, blob, method, error } = await processJewelryImage(src, onStatus);
  try {
    await putProcessed(cacheId, blob, { method, error: error || null, source: item.cover });
  } catch (_) {}
  const objectUrl = URL.createObjectURL(blob);
  onStatus(`배경 처리 완료 (${method})`);
  return { canvas, blob, method, objectUrl };
}
