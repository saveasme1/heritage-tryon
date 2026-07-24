import { prepareJewelry } from "./services/jewelry.js";
import { detectBody } from "./services/mediapipe.js";
import { assetUrl, guessTypeFromText } from "./services/portfolio.js";
import { composeTryOn, fallbackTarget } from "./services/tryon.js";
import { evaluateAlignment, stopAlignClock } from "./services/align.js";

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
  wearType: "bracelet",
  earSide: "right",
  cameraStream: null,
  cameraOpen: false,
  cameraHistoryLocal: false,
  alignRaf: 0,
  goodStreak: 0,
  autoCaptureArmed: true,
  capturing: false,
  closingCameraFromUi: false,
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
    $("captureFrame")?.classList.add("has-photo");
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

const CAMERA_HINT = {
  ring: "왼손 손등 · 검지 주황 링(+)에 맞추세요",
  bracelet: "주먹을 위로 · 주황 링(+)에 손목을 맞추세요",
  earring: "얼굴 가이드 안 · 선택한 귀(+)에 맞추세요",
  necklace: "얼굴을 위로 · 목(+)에 맞추세요",
};

const GUIDE_CAPTION = {
  ring: "왼손 손등 · 검지(+)",
  bracelet: "손↑ · 손목(+) · 팔뚝↓",
  earring: "선택한 귀에 + 맞추기",
  necklace: "얼굴↑ · 목·쇄골(+)",
};

const WEAR_LABEL = {
  ring: "반지",
  bracelet: "팔찌",
  earring: "귀걸이",
  necklace: "목걸이",
};

function resolveType() {
  return state.wearType || guessTypeFromText(state.item.title, state.item.category || "") || "bracelet";
}

function postParent(type) {
  if (!embedded || !window.parent || window.parent === window) return;
  try {
    window.parent.postMessage({ type }, "*");
  } catch (_) {}
}

function setEarSide(side) {
  state.earSide = side === "left" ? "left" : "right";
  const guide = $("cameraGuide");
  if (guide) guide.dataset.ear = state.earSide;
  document.querySelectorAll(".ear-side-btn").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.ear === state.earSide);
  });
}

function applyWearTypeFromProduct() {
  state.wearType = guessTypeFromText(state.item.title, state.item.category || "") || "bracelet";
  const guide = $("cameraGuide");
  if (guide) {
    guide.dataset.type = state.wearType;
    guide.dataset.ear = state.earSide || "right";
  }
  if ($("cameraHint")) {
    $("cameraHint").textContent = CAMERA_HINT[state.wearType] || CAMERA_HINT.bracelet;
  }
  if ($("guideCaption")) {
    $("guideCaption").textContent = GUIDE_CAPTION[state.wearType] || GUIDE_CAPTION.bracelet;
  }
  const chip = $("wearTypeChip");
  if (chip) chip.textContent = WEAR_LABEL[state.wearType] || "자동";

  const earBar = $("earSideBar");
  if (earBar) {
    const showEar = state.wearType === "earring";
    earBar.hidden = !showEar;
    earBar.classList.toggle("is-hidden", !showEar);
  }
}

function stopCamera() {
  const video = $("cameraVideo");
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach((t) => t.stop());
    state.cameraStream = null;
  }
  if (video) video.srcObject = null;
}

function stopAlignLoop() {
  if (state.alignRaf) {
    cancelAnimationFrame(state.alignRaf);
    state.alignRaf = 0;
  }
  stopAlignClock();
  state.goodStreak = 0;
  const sheet = $("cameraSheet");
  sheet?.classList.remove("is-align-ok", "is-align-far");
  const alert = $("alignAlert");
  if (alert) {
    alert.textContent = "";
    alert.classList.add("is-hidden");
    alert.classList.remove("is-ok");
  }
}

function applyAlignUi(result) {
  const sheet = $("cameraSheet");
  const hint = $("cameraHint");
  const alert = $("alignAlert");
  if (!sheet || !result) return;

  sheet.classList.toggle("is-align-ok", Boolean(result.ok));
  sheet.classList.toggle("is-align-far", Boolean(result.far));

  if (result.message && hint) hint.textContent = result.message;

  if (!alert) return;
  if (result.far || result.ok) {
    alert.textContent = result.message || "";
    alert.classList.toggle("is-ok", Boolean(result.ok));
    alert.classList.remove("is-hidden");
  } else {
    alert.textContent = "";
    alert.classList.add("is-hidden");
    alert.classList.remove("is-ok");
  }
}

async function alignTick() {
  if (!state.cameraOpen || state.capturing) return;
  const video = $("cameraVideo");
  const type = resolveType();
  try {
    const result = await evaluateAlignment(video, type, state.earSide);
    if (result) {
      applyAlignUi(result);
      if (result.ok) {
        state.goodStreak += 1;
        if (state.autoCaptureArmed && state.goodStreak >= 10) {
          state.autoCaptureArmed = false;
          shutterCapture();
          return;
        }
      } else {
        state.goodStreak = 0;
      }
    }
  } catch (err) {
    console.warn("alignTick", err);
  }
  state.alignRaf = requestAnimationFrame(alignTick);
}

function startAlignLoop() {
  stopAlignLoop();
  state.autoCaptureArmed = true;
  state.goodStreak = 0;
  state.alignRaf = requestAnimationFrame(alignTick);
}

function closeCameraSheet({ fromHistory = false } = {}) {
  if (!state.cameraOpen && $("cameraSheet")?.hidden) return;

  stopAlignLoop();
  stopCamera();
  const sheet = $("cameraSheet");
  if (sheet) {
    sheet.hidden = true;
    sheet.classList.add("is-hidden");
    sheet.classList.remove("is-align-ok", "is-align-far");
  }
  document.body.classList.remove("camera-open");
  state.cameraOpen = false;
  state.capturing = false;
  state.autoCaptureArmed = true;

  if (fromHistory) return;

  if (embedded) {
    postParent("heritage-tryon-camera-close");
    return;
  }
  if (state.cameraHistoryLocal) {
    state.cameraHistoryLocal = false;
    state.closingCameraFromUi = true;
    history.back();
  }
}

async function openGuidedCamera() {
  applyWearTypeFromProduct();
  const sheet = $("cameraSheet");
  const video = $("cameraVideo");
  if (!sheet || !video) return;

  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("이 환경에서는 카메라 가이드 촬영이 불가합니다. 업로드를 이용해 주세요.", "is-err");
    $("fileInput")?.click();
    return;
  }

  sheet.hidden = false;
  sheet.classList.remove("is-hidden");
  document.body.classList.add("camera-open");
  state.cameraOpen = true;
  state.capturing = false;
  state.autoCaptureArmed = true;
  setStatus("카메라 권한을 허용하면 가이드가 표시됩니다…");

  if (embedded) {
    postParent("heritage-tryon-camera-open");
  } else if (!state.cameraHistoryLocal) {
    history.pushState({ heritageCamera: true }, "");
    state.cameraHistoryLocal = true;
  }

  try {
    stopCamera();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
    state.cameraStream = stream;
    video.srcObject = stream;
    await video.play();
    setStatus(CAMERA_HINT[state.wearType] || "가이드에 맞춘 뒤 촬영하세요.");
    startAlignLoop();
  } catch (err) {
    console.warn(err);
    closeCameraSheet();
    setStatus("카메라 권한이 없어 업로드로 진행합니다.", "is-err");
    $("fileInput")?.click();
  }
}

function shutterCapture() {
  if (state.capturing) return;
  const video = $("cameraVideo");
  const canvas = $("cameraSnap");
  if (!video || !canvas || !video.videoWidth) {
    setStatus("카메라가 아직 준비되지 않았습니다.", "is-err");
    return;
  }
  state.capturing = true;
  stopAlignLoop();
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  canvas.toBlob((blob) => {
    if (!blob) {
      state.capturing = false;
      setStatus("촬영에 실패했습니다.", "is-err");
      startAlignLoop();
      return;
    }
    closeCameraSheet();
    setBodyFromBlob(blob);
  }, "image/jpeg", 0.92);
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
      60000,
      "주얼리 전처리 시간 초과"
    );

    const type = resolveType();
    setStatus("신체 인식 준비 중…");
    let detection;
    try {
      detection = await withTimeout(
        detectBody(state.bodyImage, type, (m) => setStatus(m), { earSide: state.earSide }),
        45000,
        "신체 인식 시간 초과"
      );
    } catch (err) {
      console.warn(err);
      detection = { type, target: null };
    }

    const useType = detection.type || type;
    let target = detection.target;
    if (useType === "bracelet") {
      target = detection.allTargets?.bracelet || fallbackTarget(state.bodyImage, "bracelet");
    } else if (!target) {
      target = fallbackTarget(state.bodyImage, useType);
    }
    const usedFallback = useType === "bracelet"
      ? !detection.allTargets?.bracelet
      : !detection.target;
    if (usedFallback) {
      setStatus("인식이 어려워 기본 위치로 합성합니다…");
    } else {
      const typeLabel = { ring: "반지", bracelet: "팔찌", earring: "귀걸이", necklace: "목걸이" }[useType] || useType;
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
        ? "위치 인식이 어려워 가이드 기준으로 합성했습니다. 손·손목이 더 보이게 다시 촬영해 보세요."
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
  closeCameraSheet();
  if (embedded && window.parent && window.parent !== window) {
    window.parent.postMessage({ type: "heritage-tryon-close" }, "*");
    return;
  }
  if (history.length > 1) history.back();
  else location.href = "https://hand-made.kr/landing.html?open=portfolio";
}

window.addEventListener("popstate", () => {
  if (state.closingCameraFromUi) {
    state.closingCameraFromUi = false;
    return;
  }
  if (state.cameraOpen) {
    state.cameraHistoryLocal = false;
    closeCameraSheet({ fromHistory: true });
  }
});

window.addEventListener("message", (event) => {
  if (event?.data?.type === "heritage-tryon-close-camera") {
    closeCameraSheet({ fromHistory: true });
  }
});

$("closeStudio").addEventListener("click", () => {
  closeCameraSheet();
  closeStudio();
});
$("openCamera")?.addEventListener("click", openGuidedCamera);
$("closeCamera")?.addEventListener("click", () => closeCameraSheet());
$("shutterBtn")?.addEventListener("click", shutterCapture);
$("fileInput").addEventListener("change", onPickFile);
$("mergeTryOn").addEventListener("click", runMergeTryOn);
$("resetBtn").addEventListener("click", resetToSplit);
$("downloadBtn").addEventListener("click", download);
$("earSideBar")?.addEventListener("click", (event) => {
  const btn = event.target.closest(".ear-side-btn");
  if (!btn) return;
  setEarSide(btn.dataset.ear);
});

setStageMode("split");
applyWearTypeFromProduct();
loadProduct();
