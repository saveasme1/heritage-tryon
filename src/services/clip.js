/**
 * CLIP zero-shot jewelry type classification via Transformers.js (ONNX Runtime Web).
 * Free/open-source — no paid APIs.
 */

let classifier = null;
let loading = null;

const LABELS = [
  "a photo of a finger ring jewelry",
  "a photo of an earring jewelry",
  "a photo of a necklace jewelry",
];
const MAP = ["ring", "earring", "necklace"];

export async function initClip() {
  if (classifier) return classifier;
  if (loading) return loading;
  loading = (async () => {
    const { pipeline } = await import("https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2");
    classifier = await pipeline("zero-shot-image-classification", "Xenova/clip-vit-base-patch32", {
      quantized: true,
    });
    return classifier;
  })();
  try {
    return await loading;
  } finally {
    loading = null;
  }
}

export async function classifyJewelryType(imageUrlOrElement) {
  try {
    const model = await initClip();
    const out = await model(imageUrlOrElement, LABELS);
    const best = Array.isArray(out) ? out[0] : null;
    if (!best) return { type: null, score: 0, raw: out };
    const idx = LABELS.indexOf(best.label);
    return {
      type: MAP[idx] || null,
      score: best.score || 0,
      raw: out,
    };
  } catch (err) {
    console.warn("CLIP classify failed", err);
    return { type: null, score: 0, error: String(err) };
  }
}
