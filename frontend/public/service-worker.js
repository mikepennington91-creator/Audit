const CACHE_NAME = 'infinit-audit-v3';
const OFFLINE_QUEUE_KEY = 'offline-queue';

const STATIC_ASSETS = [
  '/index.html',
  '/manifest.json'
];

const CACHEABLE_API_ROUTES = [
  '/api/audits',
  '/api/response-groups',
  '/api/audit-types',
  '/api/traceability/templates'
];

// Force immediate activation - skip waiting for old tabs to close.
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching offline shell');
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.log('[SW] Some assets failed to cache:', err);
      });
    })
  );
});

// Activate immediately and remove stale application caches.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.filter((name) => name !== CACHE_NAME).map((name) => {
          console.log('[SW] Deleting old cache:', name);
          return caches.delete(name);
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never allow the service-worker script itself to become a cached stale copy.
  if (url.pathname === '/service-worker.js') {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  // API requests keep their existing network-first/offline-queue behaviour.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(handleApiRequest(request));
    return;
  }

  // HTML/navigation requests must be network-first. This prevents an old
  // cached index.html from pinning users to a previous frontend deployment.
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(handleNavigationRequest(request));
    return;
  }

  // Versioned JS/CSS/images can remain cache-first for fast repeat loads.
  event.respondWith(handleStaticRequest(request));
});

async function handleNavigationRequest(request) {
  try {
    const response = await fetch(request, { cache: 'no-store' });

    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put('/index.html', response.clone());
    }

    return response;
  } catch (error) {
    const cachedShell = await caches.match('/index.html');
    if (cachedShell) {
      return cachedShell;
    }

    return new Response('Offline', { status: 503 });
  }
}

async function handleStaticRequest(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  try {
    const response = await fetch(request);

    if (request.method === 'GET' && response.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }

    return response;
  } catch (error) {
    return new Response('Offline', { status: 503 });
  }
}

// Handle API requests with network-first, cache fallback.
async function handleApiRequest(request) {
  const url = new URL(request.url);

  // For GET requests, try network first, then cache.
  if (request.method === 'GET') {
    try {
      const response = await fetch(request);

      // Cache successful GET responses for cacheable routes.
      if (response.status === 200 && isCacheableRoute(url.pathname)) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }

      return response;
    } catch (error) {
      // Network failed, try cache.
      const cachedResponse = await caches.match(request);
      if (cachedResponse) {
        return cachedResponse;
      }

      return new Response(
        JSON.stringify({ offline: true, message: 'You are offline' }),
        {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
  }

  // For POST/PUT/DELETE requests, queue if offline.
  if (['POST', 'PUT', 'DELETE'].includes(request.method)) {
    try {
      return await fetch(request);
    } catch (error) {
      await queueOfflineRequest(request);

      return new Response(
        JSON.stringify({
          offline: true,
          queued: true,
          message: 'Request queued for sync when online'
        }),
        {
          status: 202,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
  }

  return fetch(request);
}

function isCacheableRoute(pathname) {
  return CACHEABLE_API_ROUTES.some((route) => pathname.startsWith(route));
}

// Queue offline requests in IndexedDB.
async function queueOfflineRequest(request) {
  const db = await openDB();
  const tx = db.transaction(OFFLINE_QUEUE_KEY, 'readwrite');
  const store = tx.objectStore(OFFLINE_QUEUE_KEY);

  const requestData = {
    id: Date.now(),
    url: request.url,
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    body: await request.clone().text(),
    timestamp: new Date().toISOString()
  };

  await store.add(requestData);

  self.clients.matchAll().then((clients) => {
    clients.forEach((client) => {
      client.postMessage({
        type: 'OFFLINE_REQUEST_QUEUED',
        data: requestData
      });
    });
  });
}

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('infinit-audit-offline', 1);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(OFFLINE_QUEUE_KEY)) {
        db.createObjectStore(OFFLINE_QUEUE_KEY, { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains('offline-audits')) {
        db.createObjectStore('offline-audits', { keyPath: 'id' });
      }
    };
  });
}

// Sync event - process queued requests when back online.
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-offline-requests') {
    event.waitUntil(syncOfflineRequests());
  }
});

async function syncOfflineRequests() {
  const db = await openDB();
  const tx = db.transaction(OFFLINE_QUEUE_KEY, 'readwrite');
  const store = tx.objectStore(OFFLINE_QUEUE_KEY);
  const requests = await store.getAll();

  for (const requestData of requests) {
    try {
      const response = await fetch(requestData.url, {
        method: requestData.method,
        headers: requestData.headers,
        body: requestData.body
      });

      if (response.ok) {
        await store.delete(requestData.id);

        self.clients.matchAll().then((clients) => {
          clients.forEach((client) => {
            client.postMessage({
              type: 'OFFLINE_REQUEST_SYNCED',
              data: requestData
            });
          });
        });
      }
    } catch (error) {
      console.log('[SW] Sync failed for request:', requestData.id);
    }
  }
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data?.type === 'SYNC_NOW') {
    syncOfflineRequests();
  }
});
