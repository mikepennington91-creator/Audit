const CACHE_NAME = 'infinit-audit-v1';
const OFFLINE_QUEUE_KEY = 'offline-queue';

// Assets to cache for offline use
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/static/js/bundle.js',
  '/static/css/main.css',
  '/manifest.json'
];

// API routes that can be cached
const CACHEABLE_API_ROUTES = [
  '/api/audits',
  '/api/response-groups',
  '/api/audit-types',
  '/api/stats'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching static assets');
      return cache.addAll(STATIC_ASSETS).catch(err => {
        console.log('[SW] Some assets failed to cache:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Handle API requests
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(handleApiRequest(request));
    return;
  }

  // Handle static assets with cache-first strategy
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(request).then((response) => {
        // Cache successful responses
        if (response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return response;
      }).catch(() => {
        // Return offline page for navigation requests
        if (request.mode === 'navigate') {
          return caches.match('/index.html');
        }
        return new Response('Offline', { status: 503 });
      });
    })
  );
});

// Handle API requests with network-first, cache fallback
async function handleApiRequest(request) {
  const url = new URL(request.url);
  
  // For GET requests, try network first, then cache
  if (request.method === 'GET') {
    try {
      const response = await fetch(request);
      
      // Cache successful GET responses for cacheable routes
      if (response.status === 200 && isCacheableRoute(url.pathname)) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone());
      }
      
      return response;
    } catch (error) {
      // Network failed, try cache
      const cachedResponse = await caches.match(request);
      if (cachedResponse) {
        return cachedResponse;
      }
      
      // Return offline indicator
      return new Response(
        JSON.stringify({ offline: true, message: 'You are offline' }),
        { 
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
  }
  
  // For POST/PUT/DELETE requests, queue if offline
  if (['POST', 'PUT', 'DELETE'].includes(request.method)) {
    try {
      const response = await fetch(request);
      return response;
    } catch (error) {
      // Queue the request for later sync
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
  return CACHEABLE_API_ROUTES.some(route => pathname.startsWith(route));
}

// Queue offline requests in IndexedDB
async function queueOfflineRequest(request) {
  const db = await openDB();
  const tx = db.transaction('offline-queue', 'readwrite');
  const store = tx.objectStore('offline-queue');
  
  const requestData = {
    id: Date.now(),
    url: request.url,
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    body: await request.clone().text(),
    timestamp: new Date().toISOString()
  };
  
  await store.add(requestData);
  
  // Notify clients about queued request
  self.clients.matchAll().then(clients => {
    clients.forEach(client => {
      client.postMessage({
        type: 'OFFLINE_REQUEST_QUEUED',
        data: requestData
      });
    });
  });
}

// Open IndexedDB
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('infinit-audit-offline', 1);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      if (!db.objectStoreNames.contains('offline-queue')) {
        db.createObjectStore('offline-queue', { keyPath: 'id' });
      }
      
      if (!db.objectStoreNames.contains('offline-audits')) {
        db.createObjectStore('offline-audits', { keyPath: 'id' });
      }
    };
  });
}

// Sync event - process queued requests when back online
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-offline-requests') {
    event.waitUntil(syncOfflineRequests());
  }
});

async function syncOfflineRequests() {
  const db = await openDB();
  const tx = db.transaction('offline-queue', 'readwrite');
  const store = tx.objectStore('offline-queue');
  const requests = await store.getAll();
  
  for (const requestData of requests) {
    try {
      const response = await fetch(requestData.url, {
        method: requestData.method,
        headers: requestData.headers,
        body: requestData.body
      });
      
      if (response.ok) {
        // Remove from queue on success
        await store.delete(requestData.id);
        
        // Notify clients
        self.clients.matchAll().then(clients => {
          clients.forEach(client => {
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

// Listen for messages from clients
self.addEventListener('message', (event) => {
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data.type === 'SYNC_NOW') {
    syncOfflineRequests();
  }
});
