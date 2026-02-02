import { GlobalWorkerOptions, getDocument } from "./pdf.mjs";

const params = new URLSearchParams(window.location.search);
const pdfUrl = params.get("pdf");

let pdfDoc = null;
let currentPage = 1;
let totalPages = 0;
let currentFlipState = false; // Track flip state to prevent unwanted flips
let currentRenderTask = null; // track active PDF.js render task so we can cancel overlaps

const canvas = document.getElementById("pdfCanvas");
const ctx = canvas.getContext("2d");

const pageInfoEl = document.getElementById("pageInfo");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const pdfContainer = document.getElementById("pdfContainer");
// Ensure canvas has no transforms applied initially
canvas.style.transform = 'none';
canvas.style.webkitTransform = 'none';

GlobalWorkerOptions.workerSrc = new URL("./pdf.worker.mjs", import.meta.url).toString();

if (!pdfUrl) {
  pageInfoEl.innerText = "Missing ?pdf=... URL parameter";
} else {
  // Load PDF
  getDocument(pdfUrl).promise
    .then(pdf => {
      pdfDoc = pdf;
      totalPages = pdf.numPages;

      renderPage(currentPage);
      notifyUnity("PDF_LOADED");
    })
    .catch(err => {
      console.error(err);
      pageInfoEl.innerText = "Failed to load PDF";
      notifyUnity("PDF_ERROR");
    });
    
    console.log("PDF viewer loaded");
}

// Scale to fit container width (so full-screen and resize show correct size)
function getScaleForPage(page) {
  if (!pdfContainer) return 1.25;
  const baseViewport = page.getViewport({ scale: 1 });
  const containerWidth = pdfContainer.clientWidth || window.innerWidth;
  const padding = 20;
  const availableWidth = Math.max(containerWidth - padding, 100);
  const scale = availableWidth / baseViewport.width;
  const dpr = window.devicePixelRatio || 1;
  return Math.min(scale, 3) * Math.min(dpr, 2); // cap scale for performance
}

// Render page (fits container; re-run on resize/fullscreen)
function renderPage(pageNumber) {
  if (!pdfDoc) return;
  pdfDoc.getPage(pageNumber).then(page => {
    const scale = getScaleForPage(page);
    // Try getting viewport with explicit rotation to fix potential inversion
    const viewport = page.getViewport({ scale, rotation: 0 });
    
  console.log('Rendering page', pageNumber);
  console.log('Scale:', scale);
  console.log('Viewport:', viewport);

    // resize canvas to match viewport
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    // Get fresh context - PDF.js will handle rendering
    const renderCtx = canvas.getContext("2d");

    // If a previous render is still running, cancel it before starting a new one.
    // This prevents the "Cannot use the same canvas during multiple render() operations" error
    if (currentRenderTask && typeof currentRenderTask.cancel === 'function') {
      try {
        currentRenderTask.cancel();
      } catch (e) {
        // ignore cancel errors
      }
      currentRenderTask = null;
    }

    // Render and wait for completion so callers know when drawing finished
    const renderTask = page.render({
      canvasContext: renderCtx,
      viewport: viewport
    });
    currentRenderTask = renderTask;

    renderTask.promise.then(() => {
      // Clear active task reference
      currentRenderTask = null;
      // Ensure no transforms are applied to canvas after rendering
      canvas.style.transform = 'none';
      canvas.style.webkitTransform = 'none';
      currentPage = pageNumber;
      updateUI();
      notifyUnity("PAGE_CHANGED");
      notifyUnity("PAGE_RENDERED");
    }).catch(err => {
      // Ignore cancellations (common when we intentionally cancel previous renders)
      if (err && err.name === 'RenderingCancelledException') {
        console.log('Render cancelled');
        currentRenderTask = null;
        return;
      }
      console.error('Render failed', err);
      currentRenderTask = null;
      notifyUnity("PAGE_RENDER_FAILED");
    });
  });
}

// Apply or clear vertical flip on the canvas (Vuplex/WebGL textures sometimes invert Y)
function applyFlip(shouldFlip) {
  // Force canvas to normal orientation regardless of requested flip.
  // Some environments may send flipped=true by default; ignore it.
  if (!canvas) return;
  currentFlipState = false;
  canvas.style.transform = 'none';
  canvas.style.webkitTransform = 'none';
  scheduleResizeRender();
}

// External API for Unity/Vuplex to notify activation and optionally flip state
window.setWebViewActive = function(active, flipped) {
  if (typeof active === 'boolean') {
    canvas.style.visibility = active ? 'visible' : 'hidden';
  }
  if (typeof flipped === 'boolean') applyFlip(flipped);
  if (active) scheduleResizeRender();
};

// Listen for postMessage commands (Unity/Vuplex can call via postMessage)
window.addEventListener('message', ev => {
  const data = ev.data;
  if (!data) return;
  try {
    // support either stringified JSON or object
    const payload = typeof data === 'string' ? JSON.parse(data) : data;
    if (payload.type === 'WEBVIEW_ACTIVE') {
      window.setWebViewActive(Boolean(payload.active), payload.flipped);
    }
    if (payload.type === 'WEBVIEW_FLIP') {
      applyFlip(Boolean(payload.flipped));
    }
    if (payload.type === 'RENDER_PAGE' && typeof payload.page === 'number') {
      goToPage(payload.page);
    }
  } catch (e) {
    // ignore malformed messages
  }
});

// When the document regains visibility (e.g., activated by Unity/Vuplex), re-render
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    scheduleResizeRender();
    canvas.style.visibility = 'visible';
  }
});

// Also re-render on focus — some WebView implementations need this
window.addEventListener('focus', () => scheduleResizeRender());

// UI update
function updateUI() {
  pageInfoEl.innerText = `Page ${currentPage} / ${totalPages}`;

  if (prevBtn) prevBtn.disabled = currentPage <= 1;
  if (nextBtn) nextBtn.disabled = currentPage >= totalPages;
}

// Navigation
function nextPage() {
  if (currentPage < totalPages) {
    renderPage(currentPage + 1);
  }
}

function prevPage() {
  if (currentPage > 1) {
    renderPage(currentPage - 1);
  }
}

function goToPage(page) {
  if (page >= 1 && page <= totalPages) {
    renderPage(page);
  }
}

if (prevBtn) prevBtn.addEventListener("click", prevPage);
if (nextBtn) nextBtn.addEventListener("click", nextPage);

// Re-render when container size changes (full-screen, window resize, Unity WebView resize)
function scheduleResizeRender() {
  if (!pdfDoc) return;
  if (window._resizeRenderTimer) clearTimeout(window._resizeRenderTimer);
  window._resizeRenderTimer = setTimeout(() => {
    renderPage(currentPage);
    window._resizeRenderTimer = null;
  }, 100);
}

if (pdfContainer) {
  const ro = new ResizeObserver(scheduleResizeRender);
  ro.observe(pdfContainer);
}

document.addEventListener("fullscreenchange", scheduleResizeRender);
document.addEventListener("webkitfullscreenchange", scheduleResizeRender);
document.addEventListener("mozfullscreenchange", scheduleResizeRender);
document.addEventListener("MSFullscreenChange", scheduleResizeRender);
window.addEventListener("resize", scheduleResizeRender);

// Expose navigation for external callers (e.g., Unity)
window.nextPage = nextPage;
window.prevPage = prevPage;
window.goToPage = goToPage;

// 🔁 JS → Unity (Vuplex bridge) — no-op when not in a WebView

// Vuplex injects window.vuplex shortly after load; wait for it before sending.
function whenVuplexReady(callback) {
  if (window.vuplex && window.vuplex.postMessage) {
    callback();
    return;
  }
  window.addEventListener("vuplexready", callback, { once: true });
}

function sendToUnity(message) {
  const payload = JSON.parse(message);
  if (window.vuplex?.postMessage) {
    console.log("Sending to Unity:", payload);
    window.vuplex.postMessage(message);
    return;
  }
  if (window.chrome?.webview) {
    console.log("Sending to Unity:", payload);
    window.chrome.webview.postMessage(message);
    return;
  }
  if (window.webkit?.messageHandlers?.vuplex) {
    console.log("Sending to Unity:", payload);
    window.webkit.messageHandlers.vuplex.postMessage(message);
  }
}

function notifyUnity(eventType) {
  const payload = {
    type: eventType,
    currentPage,
    totalPages,
    pdfUrl
  };
  const message = JSON.stringify(payload);

  // Android / iOS bridges are available immediately; send now.
  if (window.chrome?.webview || window.webkit?.messageHandlers?.vuplex) {
    sendToUnity(message);
    return;
  }
  // Vuplex injects window.vuplex shortly after load — wait for vuplexready.
  whenVuplexReady(() => sendToUnity(message));
}
