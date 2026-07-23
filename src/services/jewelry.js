/** Jewelry prepare pipeline: cache + SAM/seg cutout. */

import { processJewelryImage } from "./sam2.js";
import { getProcessed, putProcessed } from "./storage.js";
import { assetUrl } from "./portfolio.js";

export async function prepareJewelry(item, onStatus = () => {}) {
  const cached = await getProcessed(item.id);
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

  onStatus("주얼리 배경 제거 중… (ONNX)");
  const src = assetUrl(item.cover);
  const { canvas, blob, method, error } = await processJewelryImage(src);
  await putProcessed(item.id, blob, { method, error: error || null, source: item.cover });
  const objectUrl = URL.createObjectURL(blob);
  onStatus(`배경제거 완료: ${method}`);
  return { canvas, blob, method, objectUrl };
}

function load(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}
