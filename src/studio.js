import { prepareJewelry } from "./services/jewelry.js";
import { detectBody } from "./services/mediapipe.js";
import { guessTypeFromText } from "./services/portfolio.js";
import { composeTryOn } from "./services/tryon.js";

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
  const value = String(raw || "").trim();
  if (!value) return [];
  const list = [];
  const push = (u) => { if (u && !list.includes(u)) list.push(u); };
  if (/^https?:\/\//i.test(value)) {
    push(value);
    try {
      const u = new URL(value);
      const path = u.pathname.replace(/^\/+/, "");
      push(`https://hand-made.kr/${path}`);
      push(`https://saveasme1.github.io/${path}`);
      push(assetUrl(path));
    } catch (_) {}
  } else {
    const path = value.replace(/^\/+/, "");
    push(assetUrl(path));
    push(`https://hand-made.kr/${path}`);
    push(`https://saveasme1.github.io/${path}`);
  }
  return list;
}

function loadImageNoCors(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("load failed"));
    img.src = url;
  });
}

async function fetchAsObjectUrl(url, ms = 3500) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { mode: "cors", cache: "no-store", signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return URL.createObjectURL(await res.blob());
  } finally {
    clearTimeout(timer);
  }
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

  const candidates = imageCandidates(state.item.cover);
  if (!candidates.length) {
    hide(skeleton);
    setStatus("제품 이미지가 없습니다. 포트폴리오에서 다시 열어 주세요.", "is-err");
    return;
  }

  let lastErr;
  for (const url of candidates) {
    try {
      await loadImageNoCors(url);
      img.src = url;
      img.alt = state.item.title || "선택 제품";
      show(img);
      hide(skeleton);
      state.productReady = true;
      state.item.sourceUrl = url;
      state.item.cover = url;
      fetchAsObjectUrl(url).then((blobUrl) => { state.item.cover = blobUrl; }).catch(() => {});
      setStatus("제품을 확인한 뒤 사진을 준비하세요.");
      refreshReady();
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  hide(skeleton);
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

async function resolveType(jewelryObjectUrl) {
  const hint = $("typeHint").value;
  if (hint !== "auto") return hint;
  const fromText = guessTypeFromText(state.item.title, "");
  if (fromText) return fromText;
  // Skip heavy CLIP by default — it often hangs in iframe. Manual/텍스트 추정만 사용.
  return "ring";
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runMergeTryOn() {
  if (!state.bodyImage || !state.productReady) return;
  const btn = $("mergeTryOn");
  btn.disabled = true;
  setStatus("두 화면을 합치는 중…");
  setStageMode("merging");
  await sleep(650);

  try {
    setStatus("주얼리 배경 처리 중…");
    const jewelry = await prepareJewelry({
      id: state.item.id,
      cover: state.item.sourceUrl || state.item.cover,
      title: state.item.title,
    }, (m) => setStatus(m));

    const type = await resolveType(jewelry.objectUrl);
    setStatus("신체 인식 준비 중…");
    const detection = await detectBody(state.bodyImage, type, (m) => setStatus(m));
    if (!detection.target) {
      throw new Error("손·귀·목을 찾지 못했습니다. 부위가 잘 보이게 다시 촬영해 주세요.");
    }
    const typeLabel = { ring: "반지", earring: "귀걸이", necklace: "목걸이" }[detection.type] || detection.type;
    setStatus(`${typeLabel} 위치에 합성 중…`);
    const after = await composeTryOn(state.bodyImage, jewelry.canvas, detection.target, detection.type);
    state.afterCanvas = after;
    const canvas = $("resultCanvas");
    canvas.width = after.width;
    canvas.height = after.height;
    canvas.getContext("2d").drawImage(after, 0, 0);
    setStageMode("result");
    setStatus("착용 미리보기입니다. 저장하거나 초기화할 수 있습니다.", "is-ok");
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
