import { prepareJewelry } from "./services/jewelry.js";
import { detectBody, initDetectors } from "./services/mediapipe.js";
import { classifyJewelryType } from "./services/clip.js";
import { guessTypeFromText } from "./services/portfolio.js";
import { composeTryOn } from "./services/tryon.js";

const params = new URLSearchParams(location.search);
const state = {
  item: {
    id: params.get("id") || "portfolio-item",
    title: params.get("title") || "HERITAGE",
    category: params.get("category") || "",
    cover: params.get("image") || "",
  },
  bodyImage: null,
  stream: null,
  afterCanvas: null,
};

const $ = (id) => document.getElementById(id);

function setStatus(msg, kind = "") {
  const el = $("status");
  el.textContent = msg;
  el.classList.remove("is-err", "is-ok");
  if (kind) el.classList.add(kind);
}

function refreshReady() {
  const ready = Boolean(state.item.cover && state.bodyImage);
  $("mergeTryOn").disabled = !ready;
  if (ready) setStatus("준비가 끝났습니다. Try It On 을 눌러 합성하세요.", "is-ok");
}

function loadProduct() {
  $("productTitle").textContent = state.item.title || "HERITAGE";
  $("productMeta").textContent = [state.item.category, state.item.id].filter(Boolean).join(" · ");
  const img = $("productImage");
  if (!state.item.cover) {
    setStatus("제품 이미지가 없습니다. 포트폴리오에서 다시 열어 주세요.", "is-err");
    return;
  }
  img.crossOrigin = "anonymous";
  img.src = state.item.cover;
  img.onerror = () => setStatus("제품 이미지를 불러오지 못했습니다. (CORS/URL)", "is-err");
  img.onload = () => refreshReady();
}

function setBodyFromBlob(blob) {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    state.bodyImage = img;
    const preview = $("bodyPreview");
    preview.src = url;
    preview.hidden = false;
    $("captureHint").hidden = true;
    $("camVideo").hidden = true;
    refreshReady();
  };
  img.onerror = () => setStatus("사진 로드 실패", "is-err");
  img.src = url;
}

async function startCamera() {
  stopCamera();
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "user" } },
      audio: false,
    });
    const video = $("camVideo");
    video.hidden = false;
    $("bodyPreview").hidden = true;
    $("captureHint").hidden = true;
    video.srcObject = state.stream;
    await video.play();
    $("snapCam").disabled = false;
    setStatus("카메라 준비됨 — Take Photo 를 누르세요.");
  } catch (err) {
    setStatus(`카메라 권한 필요: ${err.message}`, "is-err");
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runMergeTryOn() {
  if (!state.bodyImage || !state.item.cover) return;
  const stage = $("studioStage");
  const btn = $("mergeTryOn");
  btn.disabled = true;
  setStatus("패널을 합치는 중…");

  stage.classList.remove("is-merged");
  stage.classList.add("is-merging");
  await sleep(850);

  try {
    setStatus("주얼리 전처리 · MediaPipe 검출 중…");
    await initDetectors();
    const jewelry = await prepareJewelry(state.item, (m) => setStatus(m));
    const type = await resolveType(jewelry.objectUrl);
    const detection = await detectBody(state.bodyImage, type);
    if (!detection.target) {
      throw new Error(`신체 랜드마크를 찾지 못했습니다 (${type}). 손/귀/목이 잘 보이게 다시 촬영해 주세요.`);
    }
    setStatus(`합성 중… (${detection.type})`);
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
    setStatus("완료 — 미리보기를 확인하세요.", "is-ok");
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
  setStatus("사진을 바꾸거나 다시 Try It On 을 눌러 주세요.");
}

function download() {
  const c = state.afterCanvas || $("resultCanvas");
  const a = document.createElement("a");
  a.download = `heritage-tryon-${state.item.id}.png`;
  a.href = c.toDataURL("image/png");
  a.click();
}

$("startCam").addEventListener("click", startCamera);
$("snapCam").addEventListener("click", snapCamera);
$("fileInput").addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (file) setBodyFromBlob(file);
});
$("mergeTryOn").addEventListener("click", runMergeTryOn);
$("retryBtn").addEventListener("click", retry);
$("downloadBtn").addEventListener("click", download);

loadProduct();
