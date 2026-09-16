import axios from 'axios';

let printRequested = false;
let sourceButton = null;
let printFrame = null;
let objectUrl = null;
let restoreTimer = null;

const cleanup = () => {
  if (restoreTimer) window.clearTimeout(restoreTimer);
  restoreTimer = null;
  printRequested = false;
  sourceButton = null;
  if (printFrame) {
    printFrame.remove();
    printFrame = null;
  }
  if (objectUrl) {
    window.URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
};

const printPdfBlob = (blob) => {
  if (!(blob instanceof Blob)) return false;

  if (printFrame) printFrame.remove();
  if (objectUrl) window.URL.revokeObjectURL(objectUrl);

  objectUrl = window.URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
  printFrame = document.createElement('iframe');
  printFrame.setAttribute('aria-hidden', 'true');
  printFrame.style.position = 'fixed';
  printFrame.style.right = '0';
  printFrame.style.bottom = '0';
  printFrame.style.width = '1px';
  printFrame.style.height = '1px';
  printFrame.style.border = '0';
  printFrame.style.opacity = '0';
  printFrame.src = objectUrl;
  document.body.appendChild(printFrame);

  printFrame.onload = () => {
    window.setTimeout(() => {
      try {
        printFrame?.contentWindow?.focus();
        printFrame?.contentWindow?.print();
      } finally {
        restoreTimer = window.setTimeout(cleanup, 60000);
      }
    }, 250);
  };

  return true;
};

// Existing record screens already fetch their controlled PDF before downloading it.
// This interceptor reuses that exact response when the user chooses Print, so the
// printed document stays identical to the downloaded factory PDF.
axios.interceptors.response.use(
  (response) => {
    if (printRequested && response?.config?.responseType === 'blob' && response?.data instanceof Blob) {
      printPdfBlob(response.data);
    }
    return response;
  },
  (error) => {
    if (printRequested) cleanup();
    return Promise.reject(error);
  },
);

const originalAnchorClick = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function patchedAnchorClick(...args) {
  if (printRequested && this.download && sourceButton) {
    // The existing PDF handler creates a temporary download link after fetching
    // the blob. Printing should not also leave a duplicate file in Downloads.
    sourceButton = null;
    return undefined;
  }
  return originalAnchorClick.apply(this, args);
};

const makePrintButton = (downloadButton) => {
  if (downloadButton.dataset.printEnhanced === 'true') return;
  downloadButton.dataset.printEnhanced = 'true';

  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.pdfPrintButton = 'true';
  button.className = downloadButton.className;
  button.title = 'Print PDF';
  button.setAttribute('aria-label', 'Print PDF');
  button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/></svg>';

  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    cleanup();
    printRequested = true;
    sourceButton = downloadButton;
    downloadButton.click();
    restoreTimer = window.setTimeout(cleanup, 30000);
  });

  downloadButton.insertAdjacentElement('afterend', button);
};

const enhancePdfButtons = (root = document) => {
  root.querySelectorAll?.('button[title="Download PDF"]').forEach(makePrintButton);
};

export const initialiseBrowserPdfPrinting = () => {
  enhancePdfButtons();

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        if (node.matches?.('button[title="Download PDF"]')) makePrintButton(node);
        enhancePdfButtons(node);
      });
    });
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
  return () => observer.disconnect();
};
