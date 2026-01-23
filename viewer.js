const params = new URLSearchParams(window.location.search);
const pdfUrl = params.get("pdf");

let pdfDoc = null;
let currentPage = 1;
let totalPages = 0;
let canvas = document.getElementById("pdfCanvas");
let ctx = canvas.getContext("2d");

pdfjsLib.GlobalWorkerOptions.workerSrc = "./pdf.worker.js";

// Load PDF
pdfjsLib.getDocument(pdfUrl).promise.then(pdf => {
  pdfDoc = pdf;
  totalPages = pdf.numPages;

  renderPage(currentPage);
  notifyUnity("PDF_LOADED");
});

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
  document.getElementById("pageInfo").innerText =
    `Page ${currentPage} / ${totalPages}`;
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

// 🔁 JS → Unity (Vuplex bridge)
function notifyUnity(eventType) {
  const payload = {
    type: eventType,
    currentPage: currentPage,
    totalPages: totalPages,
    pdfUrl: pdfUrl
  };

  if (window.vuplex) {
    window.vuplex.postMessage(JSON.stringify(payload));
  }
}
