import axios from 'axios';

const PAGE_SIZE = 10;
const isHoldPage = () => window.location.pathname.includes('hold') || document.querySelector('[data-testid="hold-disposal-page"]');
const params = () => new URLSearchParams(window.location.search);

// Keep the existing HoldDisposal component contract (an array) while asking the
// API for only the ten records required by the visible register page.
axios.interceptors.request.use((config) => {
  if (config.method?.toLowerCase() !== 'get' || !String(config.url || '').endsWith('/api/hold-disposal/hold-notices')) return config;
  const query = params();
  if (query.get('holdAll') === '1') return config;
  config.params = {
    ...(config.params || {}),
    page: Math.max(1, Number(query.get('holdPage')) || 1),
    page_size: PAGE_SIZE,
  };
  return config;
});

axios.interceptors.response.use((response) => {
  if (String(response.config?.url || '').endsWith('/api/hold-disposal/hold-notices')) {
    window.__holdRegisterPage = {
      page: Number(response.headers?.['x-page']) || 1,
      totalPages: Number(response.headers?.['x-total-pages']) || 1,
      total: Number(response.headers?.['x-total-count']) || response.data?.length || 0,
    };
    window.dispatchEvent(new CustomEvent('hold-register-page-loaded'));
  }
  return response;
});

const navigatePage = (page) => {
  const url = new URL(window.location.href);
  url.searchParams.delete('holdAll');
  url.searchParams.set('holdPage', String(page));
  window.location.assign(url.toString());
};

const addPagination = () => {
  if (!isHoldPage()) return;
  const heading = [...document.querySelectorAll('h1,h2,h3,[class*="CardTitle"]')]
    .find((node) => node.textContent?.trim() === 'Recent Hold Notices');
  if (!heading) return;
  const card = heading.closest('[class*="rounded"], [class*="border"]') || heading.parentElement?.parentElement?.parentElement;
  if (!card || card.querySelector('[data-hold-pagination]')) return;
  const state = window.__holdRegisterPage;
  if (!state || state.totalPages <= 1) return;

  const bar = document.createElement('div');
  bar.dataset.holdPagination = 'true';
  bar.className = 'flex flex-wrap items-center justify-between gap-3 border-t px-6 py-4 text-sm';
  const summary = document.createElement('span');
  summary.className = 'text-muted-foreground';
  const first = ((state.page - 1) * PAGE_SIZE) + 1;
  const last = Math.min(state.page * PAGE_SIZE, state.total);
  summary.textContent = `Showing ${first}–${last} of ${state.total} hold notices`;

  const controls = document.createElement('div');
  controls.className = 'flex items-center gap-2';
  const previous = document.createElement('button');
  previous.type = 'button';
  previous.className = 'inline-flex h-9 items-center justify-center rounded-md border bg-background px-3 text-sm font-medium disabled:opacity-50';
  previous.textContent = 'Previous';
  previous.disabled = state.page <= 1;
  previous.onclick = () => navigatePage(state.page - 1);
  const pageLabel = document.createElement('span');
  pageLabel.className = 'px-2 text-muted-foreground';
  pageLabel.textContent = `Page ${state.page} of ${state.totalPages}`;
  const next = document.createElement('button');
  next.type = 'button';
  next.className = previous.className;
  next.textContent = 'Next';
  next.disabled = state.page >= state.totalPages;
  next.onclick = () => navigatePage(state.page + 1);
  controls.append(previous, pageLabel, next);
  bar.append(summary, controls);
  card.appendChild(bar);
};

const addCapaFlags = () => {
  if (!isHoldPage()) return;
  document.querySelectorAll('tr').forEach((row) => {
    if (!row.textContent?.includes('Disposal notice raised') || row.querySelector('[data-capa-required]')) return;
    const actions = row.lastElementChild;
    if (!actions) return;
    const badge = document.createElement('span');
    badge.dataset.capaRequired = 'true';
    badge.className = 'ml-2 inline-flex items-center rounded-full border border-amber-400 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800';
    badge.textContent = 'CAPA required';
    badge.title = 'Corrective and preventative action has not yet been completed.';
    actions.appendChild(badge);
  });
};

let floatingBar;
let floatingInner;
let activeScroller;
let syncing = false;

const ensureFloatingBar = () => {
  if (floatingBar) return;
  floatingBar = document.createElement('div');
  floatingBar.dataset.floatingHorizontalScroll = 'true';
  Object.assign(floatingBar.style, {
    position: 'fixed', bottom: '0', height: '18px', overflowX: 'auto', overflowY: 'hidden',
    zIndex: '45', display: 'none', background: 'var(--background, white)', borderTop: '1px solid rgba(127,127,127,.25)'
  });
  floatingInner = document.createElement('div');
  floatingInner.style.height = '1px';
  floatingBar.appendChild(floatingInner);
  document.body.appendChild(floatingBar);
  floatingBar.addEventListener('scroll', () => {
    if (!activeScroller || syncing) return;
    syncing = true;
    activeScroller.scrollLeft = floatingBar.scrollLeft;
    syncing = false;
  });
};

const updateFloatingScrollbar = () => {
  ensureFloatingBar();
  const candidates = [...document.querySelectorAll('.overflow-x-auto')].filter((el) => el.scrollWidth > el.clientWidth + 2);
  const visible = candidates.find((el) => {
    const rect = el.getBoundingClientRect();
    return rect.top < window.innerHeight - 18 && rect.bottom > window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
  });
  if (!visible) {
    floatingBar.style.display = 'none';
    activeScroller = null;
    return;
  }
  activeScroller = visible;
  const rect = visible.getBoundingClientRect();
  floatingBar.style.display = 'block';
  floatingBar.style.left = `${Math.max(0, rect.left)}px`;
  floatingBar.style.width = `${Math.min(window.innerWidth, rect.right) - Math.max(0, rect.left)}px`;
  floatingInner.style.width = `${visible.scrollWidth}px`;
  if (!syncing) floatingBar.scrollLeft = visible.scrollLeft;
  if (!visible.dataset.floatingSync) {
    visible.dataset.floatingSync = 'true';
    visible.addEventListener('scroll', () => {
      if (activeScroller !== visible || syncing) return;
      syncing = true;
      floatingBar.scrollLeft = visible.scrollLeft;
      syncing = false;
    });
  }
};

// Bulk download needs access to the full register for manual/reference selection.
// Temporarily reload the page without pagination, open the dialog, then return to
// the normal ten-row register when the dialog closes.
const wireBulkExport = () => {
  if (!isHoldPage()) return;
  const bulk = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim().includes('Bulk Download'));
  if (!bulk || bulk.dataset.fullRegisterWired) return;
  bulk.dataset.fullRegisterWired = 'true';
  bulk.addEventListener('click', (event) => {
    if (params().get('holdAll') === '1') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    sessionStorage.setItem('openHoldBulkExport', '1');
    const url = new URL(window.location.href);
    url.searchParams.set('holdAll', '1');
    url.searchParams.delete('holdPage');
    window.location.assign(url.toString());
  }, true);
};

let bulkWasOpen = false;
const manageBulkReload = () => {
  if (params().get('holdAll') !== '1') return;
  if (sessionStorage.getItem('openHoldBulkExport') === '1') {
    const bulk = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim().includes('Bulk Download'));
    if (bulk) {
      sessionStorage.removeItem('openHoldBulkExport');
      bulk.click();
      bulkWasOpen = true;
    }
    return;
  }
  const dialogOpen = !![...document.querySelectorAll('[role="dialog"]')].find((dialog) => dialog.textContent?.includes('Download Hold Notice Register'));
  if (dialogOpen) bulkWasOpen = true;
  if (bulkWasOpen && !dialogOpen) {
    const url = new URL(window.location.href);
    url.searchParams.delete('holdAll');
    url.searchParams.set('holdPage', '1');
    window.location.replace(url.toString());
  }
};

const enhance = () => {
  addPagination();
  addCapaFlags();
  wireBulkExport();
  manageBulkReload();
  updateFloatingScrollbar();
};

if (typeof window !== 'undefined') {
  window.addEventListener('hold-register-page-loaded', () => setTimeout(enhance, 0));
  window.addEventListener('scroll', updateFloatingScrollbar, { passive: true });
  window.addEventListener('resize', updateFloatingScrollbar);
  new MutationObserver(enhance).observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(enhance, 0);
}
