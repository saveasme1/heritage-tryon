import { prepareJewelry } from "./services/jewelry.js";
import { detectBody, initDetectors } from "./services/mediapipe.js";
import { classifyJewelryType } from "./services/clip.js";
import { guessTypeFromText, assetUrl } from "./services/portfolio.js";
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
  stream: null,
  afterCanvas: null,
  productReady: false,
};

const $ = (id) => document.getElementById(id);

function setStatus(msg, kind = "") {
  const el = $("status");
  el.textContent = msg;
  el.classList.remove("is-err", "is-ok");
  if (kind) el.classList.add(kind);
}

function refreshReady() {
  const ready = Boolean(state.productReady && state.bodyImage);
  $("mergeTryOn").disabled = !ready;
  if (ready) setStatus("준비가 끝났습니다. 아래 버튼으로 가상착용을 시작하세요.", "is-ok");
}

function imageCandidates(raw) {
  const value = String(raw || "").trim();
  if (!value) return [];
  const list = [];
  const push = (u) => {
    if (u && !list.includes(u)) list.push(u);
  };
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
    // Do NOT set crossOrigin for display — missing ACAO causes broken-image icon.
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("load failed"));
    img.src = url;
  });
}

async function fetchAsObjectUrl(url) {
  const res = await fetch(url, { mode: "cors", cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

async function loadProduct() {
  $("productTitle").textContent = state.item.title || "헤리티지";
  const cat = $("productCat");
  if (state.item.category) {
    cat.hidden = false;
    cat.textContent = state.item.category;
  }
  const skeleton = $("productSkeleton");
  const img = $("productImage");
  const candidates = imageCandidates(state.item.cover);
  if (!candidates.length) {
    skeleton.classList.add("is-hidden");
    setStatus("제품 이미지가 없습니다. 포트폴리오에서 다시 열어 주세요.", "is-err");
    return;
  }

  let lastErr;
  for (const url of candidates) {
    try {
      // Prefer blob URL so canvas processing works even when display CDN lacks CORS.
      let displayUrl = url;
      try {
        displayUrl = await fetchAsObjectUrl(url);
        state.item.cover = displayUrl;
        state.item.sourceUrl = url;
      } catch (_) {
        displayUrl = url;
        state.item.cover = url;
        state.item.sourceUrl = url;
      }
      await loadImageNoCors(displayUrl);
      img.src = displayUrl;
      skeleton.classList.add("is-hidden");
      state.productReady = true;
      setStatus("제품을 확인한 뒤, 오른쪽(모바일은 아래)에서 사진을 준비하세요.");
      refreshReady();
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  skeleton.classList.add("is-hidden");
  setStatus(`제품 이미지를 불러오지 못했습니다. ${lastErr?.message || ""}`.trim(), "is-err");
}

function setBodyFromBlob(blob) {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    state.bodyImage = img;
    const preview = $("bodyPreview");
    preview.src = url;
    preview.hidden = false;
    $("captureEmpty").hidden = true;
    $("camVideo").hidden = true;
    refreshReady();
  };
  img.onerror = () => setStatus("사진 로드에 실패했습니다.", "is-err");
  img.src = url;
}

async function startCamera() {
  stopCamera();
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "user" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    const video = $("camVideo");
    video.hidden = false;
    $("bodyPreview").hidden = true;
    $("captureEmpty").hidden = true;
    video.srcObject = state.stream;
    await video.play();
    $("snapCam").disabled = false;
    setStatus("카메라가 켜졌습니다. ‘사진 촬영’을 누르세요.");
  } catch (err) {
    setStatus(`카메라 권한이 필요합니다: ${err.message}`, "is-err");
  }
}

function stopCamera() {
  if (state.stream) {
    state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
  }
  $("camVideo").srcObject = null;
  $("snapCam").disabled = true;
}

function snapCamera() {
  const video = $("camVideo");
  const canvas = $("camCanvas");
  canvas.width = video.videoWidth || 720;
  canvas.height = video.videoHeight || 960;
  canvas.getContext("2d").drawImage(video, 0, 0);
  canvas.toBlob((blob) => {
    if (blob) setBodyFromBlob(blob);
  }, "image/jpeg", 0.92);
}

async function resolveType(jewelryObjectUrl) {
  const hint = $("typeHint").value;
  if (hint !== "auto") return hint;
  const fromText = guessTypeFromText(state.item.title, "");
  if (fromText) return fromText;
  const clip = await classifyJewelryType(jewelryObjectUrl);
  return clip.type || "ring";
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runMergeTryOn() {
  if (!state.bodyImage || !state.productReady) return;
  const stage = $("studioStage");
  const btn = $("mergeTryOn");
  btn.disabled = true;
  setStatus("화면을 합치는 중…");
  stage.classList.remove("is-merged");
  stage.classList.add("is-merging");
  await sleep(850);

  try {
    setStatus("주얼리 전처리와 신체 인식을 진행합니다…");
    await initDetectors();
    const jewelryItem = {
      id: state.item.id,
      cover: state.item.sourceUrl || state.item.cover,
      title: state.item.title,
    };
    const jewelry = await prepareJewelry(jewelryItem, (m) => setStatus(m));
    const type = await resolveType(jewelry.objectUrl);
    const detection = await detectBody(state.bodyImage, type);
    if (!detection.target) {
      throw new Error("손·귀·목을 찾지 못했습니다. 부위가 잘 보이게 다시 촬영해 주세요.");
    }
    const typeLabel = { ring: "반지", earring: "귀걸이", necklace: "목걸이" }[detection.type] || detection.type;
    setStatus(`${typeLabel} 위치에 합성 중…`);
    const after = await composeTryOn(
      state.bodyImage,
      jewelry.canvas,
      detection.target,
      detection.type
    );
    state.afterCanvas = after;
    const canvas = $("resultCanvas");
    canvas.width = after.width;
    canvas.height = after.height;
    canvas.getContext("2d").drawImage(after, 0, 0);
    $("panelResult").hidden = false;
    stage.classList.remove("is-merging");
    stage.classList.add("is-merged");
    setStatus("가상착용 미리보기가 준비되었습니다.", "is-ok");
  } catch (err) {
    console.error(err);
    stage.classList.remove("is-merging", "is-merged");
    $("panelResult").hidden = true;
    setStatus(String(err.message || err), "is-err");
    btn.disabled = false;
  }
}

function retry() {
  state.afterCanvas = null;
  $("studioStage").classList.remove("is-merging", "is-merged");
  $("panelResult").hidden = true;
  refreshReady();
  setStatus("사진을 바꾼 뒤 다시 가상착용을 시작해 주세요.");
}

function download() {
  const c = state.afterCanvas || $("resultCanvas");
  const a = document.createElement("a");
  a.download = `heritage-tryon-${state.item.id}.png`;
  a.href = c.toDataURL("image/png");
  a.click();
}

function closeStudio() {
  stopCamera();
  if (embedded && window.parent && window.parent !== window) {
    window.parent.postMessage({ type: "heritage-tryon-close" }, "*");
    return;
  }
  if (history.length > 1) history.back();
  else location.href = "https://hand-made.kr/landing.html?open=portfolio";
}

$("closeStudio").addEventListener("click", closeStudio);
$("startCam").addEventListener("click", startCamera);
$("snapCam").addEventListener("click", snapCamera);
$("fileInput").addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (file) setBodyFromBlob(file);
});
$("mergeTryOn").addEventListener("click", runMergeTryOn);
$("retryBtn").addEventListener("click", retry);
$("downloadBtn").addEventListener("click", download);

if (embedded) {
  document.documentElement.classList.add("is-embedded");
}

loadProduct();
