/** Portfolio loader — read-only from public Heritage Pages (does not modify production). */

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

export function guessTypeFromText(title = "", content = "") {
  const text = `${title} ${content}`.toLowerCase();
  if (/귀걸이|이어링|earring|pierce|피어싱/.test(text)) return "earring";
  if (/목걸이|네크리스|necklace|펜던트|pendant|초커|choker/.test(text)) return "necklace";
  // bracelet before ring — "링" alone would steal 팔찌 titles incorrectly less often,
  // but 팔찌/bracelet must win first.
  if (/팔찌|bracelet|브레이슬릿|bangle|손목|암밴드|armband/.test(text)) return "bracelet";
  if (/반지|링\b|ring\b|시그넷/.test(text)) return "ring";
  return null;
}
