import { loadPortfolio, assetUrl, guessTypeFromText } from "./services/portfolio.js";
import { detectBody, drawDebug, initDetectors } from "./services/mediapipe.js";
import { classifyJewelryType } from "./services/clip.js";
import { prepareJewelry } from "./services/jewelry.js";
import { composeTryOn, drawBefore } from "./services/tryon.js";

const state = {
  items: [],
  filtered: [],
  selected: null,
  bodyImage: null,
  detection: null,
  jewelryReady: null,
  typeHint: "auto",
  stream: null,
};

const $ = (id) => document.getElementById(id);

function setStatus(el, msg, kind = "") {
  el.textContent = msg;
  el.classList.remove("is-err", "is-ok");
  if (kind) el.classList.add(kind);
}

function goStep(n) {
  for (let i = 1; i <= 4; i++) {
    const panel = $(`step${i}`);
    if (panel) panel.hidden = i !== n;
  }
  document.querySelectorAll("#stepNav button").forEach((btn) => {
    btn.classList.toggle("is-on", Number(btn.dataset.step) === n);
  });
}

function renderGrid() {
  const grid = $("portfolioGrid");
  grid.replaceChildren();
  state.filtered.slice(0, 120).forEach((item) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `item${state.selected?.id === item.id ? " is-selected" : ""}`;
    btn.innerHTML = `
      <img src="${assetUrl(item.cover)}" alt="" loading="lazy" crossorigin="anonymous" />
      <div class="meta">
        <div class="cat">${item.category || "—"}</div>
        <div class="title">${escapeHtml(item.title || item.id)}</div>
      </div>`;
    btn.addEventListener("click", () => {
      state.selected = item;
      $("toStep2").disabled = false;
      renderGrid();
    });
    grid.append(btn);
  });
  setStatus(
    $("portfolioStatus"),
    `${state.filtered.length}개 표시 (최대 120) · 전체 ${state.items.length}`,
    "is-ok"
  );
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function applyFilter() {
  const q = ($("searchInput").value || "").trim().toLowerCase();
  const cat = $("categoryFilter").value;
  state.filtered = state.items.filter((it) => {
    if (cat && it.category !== cat) return false;
    if (!q) return true;
    return `${it.title} ${it.category} ${it.id}`.toLowerCase().includes(q);
  });
  renderGrid();
}

async function bootPortfolio() {
  try {
    state.items = await loadPortfolio();
    const cats = [...new Set(state.items.map((i) => i.category).filter(Boolean))].sort();
    const sel = $("categoryFilter");
    cats.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      sel.append(opt);
    });
    state.filtered = state.items;
    renderGrid();
  } catch (err) {
    setStatus($("portfolioStatus"), `포트폴리오 로드 실패: ${err.message}`, "is-err");
  }
}

function setBodyFromFile(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    state.bodyImage = img;
    const preview = $("bodyPreview");
    preview.src = url;
    preview.hidden = false;
    $("toStep3").disabled = false;
  };
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
    video.srcObject = state.stream;
    await video.play();
    $("snapCam").disabled = false;
  } catch (err) {
    alert(`카메라 권한이 필요합니다: ${err.message}`);
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
    if (!blob) return;
    setBodyFromFile(new File([blob], "capture.jpg", { type: "image/jpeg" }));
  }, "image/jpeg", 0.92);
}

async function resolveType(jewelryObjectUrl) {
  const hint = $("typeHint").value;
  if (hint !== "auto") return hint;
  const fromText = guessTypeFromText(state.selected.title, state.selected.content);
  if (fromText) return fromText;
  setStatus($("detectStatus"), "CLIP으로 주얼리 종류 분류 중…");
  const clip = await classifyJewelryType(jewelryObjectUrl);
  return clip.type || "ring";
}

async function runDetection() {
  if (!state.selected || !state.bodyImage) return;
  goStep(3);
  setStatus($("detectStatus"), "MediaPipe 모델 로딩…");
  try {
    await initDetectors();
    setStatus($("detectStatus"), "주얼리 PNG 준비…");
    state.jewelryReady = await prepareJewelry(state.selected, (m) => setStatus($("detectStatus"), m));
    const jewelryType = await resolveType(state.jewelryReady.objectUrl);
    setStatus($("detectStatus"), `신체 랜드마크 검출 중… (target: ${jewelryType})`);
    state.detection = await detectBody(state.bodyImage, jewelryType);
    drawDebug($("detectCanvas"), state.bodyImage, state.detection);
    if (!state.detection.target) {
      setStatus(
        $("detectStatus"),
        `랜드마크 부족: hands=${state.detection.debug.hands}, faces=${state.detection.debug.faces}, poses=${state.detection.debug.poses}. 다른 사진을 시도하세요.`,
        "is-err"
      );
      $("runTryOn").disabled = true;
      return;
    }
    setStatus(
      $("detectStatus"),
      `검출 완료 · type=${state.detection.type} · method=${state.jewelryReady.method}`,
      "is-ok"
    );
    $("runTryOn").disabled = false;
  } catch (err) {
    console.error(err);
    setStatus($("detectStatus"), `실패: ${err.message || err}`, "is-err");
    $("runTryOn").disabled = true;
  }
}

async function runTryOn() {
  goStep(4);
  setStatus($("resultStatus"), "OpenCV/Canvas로 합성 중…");
  try {
    drawBefore($("beforeCanvas"), state.bodyImage);
    const after = await composeTryOn(
      state.bodyImage,
      state.jewelryReady.canvas,
      state.detection.target,
      state.detection.type
    );
    const ctx = $("afterCanvas").getContext("2d");
    $("afterCanvas").width = after.width;
    $("afterCanvas").height = after.height;
    ctx.drawImage(after, 0, 0);
    state.afterCanvas = after;
    setStatus($("resultStatus"), "완료 — 다운로드하거나 다시 시도하세요.", "is-ok");
  } catch (err) {
    setStatus($("resultStatus"), `합성 실패: ${err.message || err}`, "is-err");
  }
}

function downloadResult() {
  const c = state.afterCanvas || $("afterCanvas");
  const a = document.createElement("a");
  a.download = `heritage-tryon-${state.selected?.id || "result"}.png`;
  a.href = c.toDataURL("image/png");
  a.click();
}

function wire() {
  $("searchInput").addEventListener("input", applyFilter);
  $("categoryFilter").addEventListener("change", applyFilter);
  $("typeHint").addEventListener("change", () => {
    state.typeHint = $("typeHint").value;
  });
  $("toStep2").addEventListener("click", () => goStep(2));
  $("back1").addEventListener("click", () => goStep(1));
  $("back2").addEventListener("click", () => goStep(2));
  $("toStep3").addEventListener("click", runDetection);
  $("runTryOn").addEventListener("click", runTryOn);
  $("startCam").addEventListener("click", startCamera);
  $("stopCam").addEventListener("click", stopCamera);
  $("snapCam").addEventListener("click", snapCamera);
  $("fileInput").addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) setBodyFromFile(file);
  });
  $("downloadBtn").addEventListener("click", downloadResult);
  $("retryBtn").addEventListener("click", () => {
    goStep(2);
  });
  $("restartBtn").addEventListener("click", () => {
    stopCamera();
    state.selected = null;
    state.bodyImage = null;
    state.detection = null;
    state.jewelryReady = null;
    $("toStep2").disabled = true;
    $("toStep3").disabled = true;
    $("bodyPreview").hidden = true;
    goStep(1);
    renderGrid();
  });
  document.querySelectorAll("#stepNav button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const n = Number(btn.dataset.step);
      if (n === 1) goStep(1);
      if (n === 2 && state.selected) goStep(2);
      if (n === 3 && state.bodyImage) runDetection();
      if (n === 4 && state.afterCanvas) goStep(4);
    });
  });
}

wire();
bootPortfolio();
goStep(1);
