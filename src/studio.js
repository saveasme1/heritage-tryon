import { prepareJewelry } from "./services/jewelry.js";
import { detectBody } from "./services/mediapipe.js";
import { assetUrl, guessTypeFromText } from "./services/portfolio.js";
import { composeTryOn, fallbackTarget } from "./services/tryon.js";

const params = new URLSearchParams(location.search);
const embedded = params.get("embed") === "1";

const state = {
  item: {
    id: params.get("id") || "portfolio-item",
    title: params.get("title") || "헤리티지",
    category: params.get("category") || "",
    cover: params.get("image") || params.get("path") || "",
  },
  bodyImage: null,
  afterCanvas: null,
  productReady: false,
};

const $ = (id) => document.getElementById(id);
const show = (el) => el && el.classList.remove("is-hidden");
const hide = (el) => el && el.classList.add("is-hidden");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(label)), ms);
    Promise.resolve(promise).then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

function setStatus(msg, kind = "") {
  const el = $("status");
  el.textContent = msg;
  el.classList.remove("is-err", "is-ok");
  if (kind) el.classList.add(kind);
}

function setStageMode(mode) {
  const stage = $("studioStage");
  stage.classList.remove("mode-split", "mode-merging", "mode-result");
  stage.classList.add(`mode-${mode}`);
  if (mode === "split") {
    show($("panelProduct"));
    show($("panelCapture"));
    hide($("panelResult"));
    $("mergeTryOn").classList.remove("is-hidden");
  } else if (mode === "result") {
    hide($("panelProduct"));
    hide($("panelCapture"));
    show($("panelResult"));
    $("mergeTryOn").classList.add("is-hidden");
  }
}

function refreshReady() {
  const ready = Boolean(state.productReady && state.bodyImage);
  $("mergeTryOn").disabled = !ready;
  if (ready) setStatus("준비가 끝났습니다. ‘착용해보기’를 눌러 결과를 확인하세요.", "is-ok");
}

function imageCandidates(raw) {
  let value = String(raw || "").trim();
  if (!value) return [];
  try { value = decodeURIComponent(value); } catch (_) {}

  const list = [];
  const push = (u) => { if (u && !list.includes(u)) list.push(u); };
  const onGithubHost = /github\.io$/i.test(location.hostname);

  const pushMirrors = (path) => {
    const p = String(path || "").replace(/^\/+/, "");
    if (!p) return;
    // Studio runs on github.io — prefer same-origin first (faster, fewer hangs).
    if (onGithubHost) {
      push(`${location.origin}/${p}`);
      push(`https://saveasme1.github.io/${p}`);
      push(`https://hand-made.kr/${p}`);
    } else {
      push(`https://hand-made.kr/${p}`);
      push(`https://saveasme1.github.io/${p}`);
      push(assetUrl(p));
    }
  };

  if (/^https?:\/\//i.test(value)) {
    try {
      const u = new URL(value);
      pushMirrors(u.pathname);
      push(value);
    } catch (_) {
      push(value);
    }
  } else {
    pushMirrors(value);
  }
  return list;
}

/** Never hang: onload / onerror / timeout only. */
function loadIntoProductImg(url, ms = 4500) {
  const img = $("productImage");
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (ok, err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      ok ? resolve(url) : reject(err || new Error("load failed"));
    };
    const timer = setTimeout(() => finish(false, new Error("이미지 로딩 시간 초과")), ms);
    img.onload = () => finish(true);
    img.onerror = () => finish(false, new Error("load failed"));
    // cache-bust soft stalls without breaking CDN cache forever
    const sep = url.includes("?") ? "&" : "?";
    img.src = `${url}${sep}_tryon=${Date.now()}`;
  });
}

async function loadProduct() {
  $("productTitle").textContent = state.item.title || "헤리티지";
  const cat = $("productCat");
  if (state.item.category) {
    cat.textContent = state.item.category;
    show(cat);
  }
  const skeleton = $("productSkeleton");
  const img = $("productImage");
  hide(img);
  img.removeAttribute("src");
  img.alt = "";
  show(skeleton);
  setStatus("선택 제품 불러오는 중…");

  const candidates = imageCandidates(state.item.cover);
  if (!candidates.length) {
    hide(skeleton);
    setStatus("제품 이미지가 없습니다. 포트폴리오에서 다시 열어 주세요.", "is-err");
    return;
  }

  let lastErr;
  for (const url of candidates) {
    try {
      await loadIntoProductImg(url, 4500);
      // Drop cache-bust query for jewelry source (store clean URL)
      img.src = url;
      img.alt = state.item.title || "선택 제품";
      show(img);
      hide(skeleton);
      state.productReady = true;
      state.item.sourceUrl = url;
      state.item.cover = url;
      setStatus("제품을 확인한 뒤 사진을 준비하세요.");
      refreshReady();
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  hide(skeleton);
  hide(img);
  setStatus(`제품 이미지를 불러오지 못했습니다. ${lastErr?.message || ""}`.trim(), "is-err");
}

function setBodyFromBlob(blob) {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    state.bodyImage = img;
    const preview = $("bodyPreview");
    preview.src = url;
    preview.alt = "";
    show(preview);
    hide($("captureEmpty"));
    refreshReady();
    setStatus("사진이 준비되었습니다. ‘착용해보기’를 눌러주세요.", "is-ok");
  };
  img.onerror = () => setStatus("사진 로드에 실패했습니다.", "is-err");
  img.src = url;
}

function onPickFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  setBodyFromBlob(file);
  event.target.value = "";
}

function resolveType() {
  const hint = $("typeHint").value;
  if (hint !== "auto") return hint;
  return guessTypeFromText(state.item.title, "") || "ring";
}

async function runMergeTryOn() {
  if (!state.bodyImage || !state.productReady) return;
  const btn = $("mergeTryOn");
  btn.disabled = true;
  setStatus("두 화면을 합치는 중…");
  setStageMode("merging");
  await sleep(400);

  try {
    setStatus("주얼리 배경 처리 중…");
    const jewelry = await withTimeout(
      prepareJewelry({
        id: state.item.id,
        cover: state.item.sourceUrl || state.item.cover,
        title: state.item.title,
      }, (m) => setStatus(m)),
      20000,
      "주얼리 전처리 시간 초과"
    );

    const type = resolveType();
    setStatus("신체 인식 준비 중…");
    let detection;
    try {
      detection = await withTimeout(
        detectBody(state.bodyImage, type, (m) => setStatus(m)),
        45000,
        "신체 인식 시간 초과"
      );
    } catch (err) {
      console.warn(err);
      detection = { type, target: null };
    }

    const useType = detection.type || type;
    const target = detection.target || fallbackTarget(state.bodyImage, useType);
    const usedFallback = !detection.target;
    if (usedFallback) {
      setStatus("인식이 어려워 기본 위치로 합성합니다…");
    } else {
      const typeLabel = { ring: "반지", earring: "귀걸이", necklace: "목걸이" }[useType] || useType;
      setStatus(`${typeLabel} 위치에 합성 중…`);
    }

    const after = await withTimeout(
      composeTryOn(state.bodyImage, jewelry.canvas, target, useType),
      15000,
      "합성 시간 초과"
    );
    state.afterCanvas = after;
    const canvas = $("resultCanvas");
    canvas.width = after.width;
    canvas.height = after.height;
    canvas.getContext("2d").drawImage(after, 0, 0);
    setStageMode("result");
    setStatus(
      usedFallback
        ? "기본 위치 미리보기입니다. 부위 선택 후 다시 시도하거나 저장하세요."
        : "착용 미리보기입니다. 저장하거나 초기화할 수 있습니다.",
      "is-ok"
    );
  } catch (err) {
    console.error(err);
    setStageMode("split");
    setStatus(String(err.message || err), "is-err");
    refreshReady();
  }
}

function resetToSplit() {
  state.afterCanvas = null;
  setStageMode("split");
  refreshReady();
  setStatus("초기화되었습니다. 사진을 바꾸거나 다시 착용해보세요.");
}

function download() {
  const c = state.afterCanvas || $("resultCanvas");
  const a = document.createElement("a");
  a.download = `heritage-tryon-${state.item.id}.png`;
  a.href = c.toDataURL("image/png");
  a.click();
}

function closeStudio() {
  if (embedded && window.parent && window.parent !== window) {
    window.parent.postMessage({ type: "heritage-tryon-close" }, "*");
    return;
  }
  if (history.length > 1) history.back();
  else location.href = "https://hand-made.kr/landing.html?open=portfolio";
}

$("closeStudio").addEventListener("click", closeStudio);
$("captureInput").addEventListener("change", onPickFile);
$("fileInput").addEventListener("change", onPickFile);
$("mergeTryOn").addEventListener("click", runMergeTryOn);
$("resetBtn").addEventListener("click", resetToSplit);
$("downloadBtn").addEventListener("click", download);

setStageMode("split");
loadProduct();
