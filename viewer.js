import { GlobalWorkerOptions, getDocument } from "./pdf.mjs";

const params = new URLSearchParams(window.location.search);
const pdfUrl = params.get("pdf");

let pdfDoc = null;
let currentPage = 1;
let totalPages = 0;

const canvas = document.getElementById("pdfCanvas");
const ctx = canvas.getContext("2d");

const pageInfoEl = document.getElementById("pageInfo");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");

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

// Render page
function renderPage(pageNumber) {
  pdfDoc.getPage(pageNumber).then(page => {
    const viewport = page.getViewport({ scale: 1.25 });

    canvas.height = viewport.height;
    canvas.width = viewport.width;

    page.render({
      canvasContext: ctx,
      viewport: viewport
    });

    currentPage = pageNumber;
    updateUI();
    notifyUnity("PAGE_CHANGED");
  });
}

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

// Expose navigation for external callers (e.g., Unity)
window.nextPage = nextPage;
window.prevPage = prevPage;
window.goToPage = goToPage;

// 🔁 JS → Unity (Vuplex bridge) — no-op when not in a WebView
function notifyUnity(eventType) {
  const payload = {
    type: eventType,
    currentPage,
    totalPages,
    pdfUrl
  };
  const message = JSON.stringify(payload);

  // Vuplex (most platforms)
  if (window.vuplex && window.vuplex.postMessage) {
    console.log("Sending to Unity:", payload);
    window.vuplex.postMessage(message);
    return;
  }

  // Android fallback
  if (window.chrome && window.chrome.webview) {
    console.log("Sending to Unity:", payload);
    window.chrome.webview.postMessage(message);
    return;
  }

  // iOS WKWebView fallback
  if (window.webkit &&
      window.webkit.messageHandlers &&
      window.webkit.messageHandlers.vuplex) {
    console.log("Sending to Unity:", payload);
    window.webkit.messageHandlers.vuplex.postMessage(message);
    return;
  }

  // Not in a WebView (e.g. opened in browser) — skip quietly
}
