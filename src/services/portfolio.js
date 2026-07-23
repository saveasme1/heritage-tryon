/** Portfolio loader — read-only from public Heritage Pages. */

const ASSET_BASES = [
  "https://hand-made.kr/",
  "https://saveasme1.github.io/",
];

const DATA_URLS = [
  "https://hand-made.kr/portfolio-data.json",
  "https://saveasme1.github.io/portfolio-data.json",
];

export function assetUrl(path) {
  const p = String(path || "").replace(/^\/+/, "");
  if (!p) return "";
  if (/^https?:\/\//i.test(p)) return p;
  return `${ASSET_BASES[0]}${p}`;
}

export async function loadPortfolio() {
  let lastError;
  for (const url of DATA_URLS) {
    try {
      const res = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const items = Array.isArray(data.items) ? data.items : [];
      return items.map((item) => ({
        id: item.id,
        title: item.title || "",
        category: item.category || "",
        content: item.content || "",
        cover: item.cover || item.image || (item.images && item.images[0]) || "",
        images: item.images || [],
      })).filter((x) => x.cover);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("포트폴리오를 불러오지 못했습니다.");
}

/**
 * Infer wear part from product title/category.
 * Order matters: bracelet before bare "링", etc.
 */
export function guessTypeFromText(title = "", content = "") {
  const text = `${title} ${content}`.toLowerCase();

  if (/귀걸이|이어링|ear\s*ring|earring|pierce|피어싱|드롭이어/.test(text)) return "earring";
  if (/목걸이|네크리스|necklace|펜던트|pendant|초커|choker|체인목/.test(text)) return "necklace";
  if (/팔찌|bracelet|브레이슬릿|bangle|암밴드|armband|러브\s*팔찌|까르띠에.*팔찌/.test(text)) {
    return "bracelet";
  }
  // Ring: explicit words first. Avoid matching 링 inside unrelated words.
  if (/반지|시그넷|링거|커플링|이터널|solitaire|\bring\b/.test(text)) return "ring";
  if (/(골드|실버|다이아|플래티넘|화이트골드)?\s*링(?!거)/.test(text) && !/팔찌|bracelet/.test(text)) {
    return "ring";
  }
  // Category-ish tokens
  if (/finger|손가락/.test(text)) return "ring";
  if (/wrist|손목/.test(text)) return "bracelet";
  if (/ear|귀/.test(text) && !/귀금속/.test(text)) return "earring";
  if (/neck|목\b/.test(text)) return "necklace";

  return null;
}
