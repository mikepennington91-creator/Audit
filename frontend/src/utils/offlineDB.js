// IndexedDB utility for offline data storage

const DB_NAME = 'infinit-audit-offline';
const DB_VERSION = 1;

let dbInstance = null;

export const openDB = () => {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      resolve(dbInstance);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    
    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Store for offline audit submissions
      if (!db.objectStoreNames.contains('offline-audits')) {
        const auditStore = db.createObjectStore('offline-audits', { keyPath: 'id' });
        auditStore.createIndex('status', 'status', { unique: false });
        auditStore.createIndex('created_at', 'created_at', { unique: false });
      }

      // Store for cached data (audits list, response groups, etc.)
      if (!db.objectStoreNames.contains('cached-data')) {
        db.createObjectStore('cached-data', { keyPath: 'key' });
      }

      // Store for offline queue
      if (!db.objectStoreNames.contains('offline-queue')) {
        db.createObjectStore('offline-queue', { keyPath: 'id' });
      }
    };
  });
};

// Save an audit completed offline
export const saveOfflineAudit = async (auditData) => {
  const db = await openDB();
  const tx = db.transaction('offline-audits', 'readwrite');
  const store = tx.objectStore('offline-audits');
  
  const offlineAudit = {
    ...auditData,
    id: `offline_${Date.now()}`,
    status: 'pending_sync',
    created_at: new Date().toISOString()
  };
  
  await store.add(offlineAudit);
  return offlineAudit;
};

// Get all pending offline audits
export const getPendingOfflineAudits = async () => {
  const db = await openDB();
  const tx = db.transaction('offline-audits', 'readonly');
  const store = tx.objectStore('offline-audits');
  const index = store.index('status');
  
  return new Promise((resolve, reject) => {
    const request = index.getAll('pending_sync');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

// Mark offline audit as synced
export const markAuditSynced = async (offlineId, serverId) => {
  const db = await openDB();
  const tx = db.transaction('offline-audits', 'readwrite');
  const store = tx.objectStore('offline-audits');
  
  const audit = await new Promise((resolve, reject) => {
    const request = store.get(offlineId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  
  if (audit) {
    audit.status = 'synced';
    audit.server_id = serverId;
    audit.synced_at = new Date().toISOString();
    await store.put(audit);
  }
};

// Delete synced audits older than 7 days
export const cleanupSyncedAudits = async () => {
  const db = await openDB();
  const tx = db.transaction('offline-audits', 'readwrite');
  const store = tx.objectStore('offline-audits');
  
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  
  const allAudits = await new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  
  for (const audit of allAudits) {
    if (audit.status === 'synced' && new Date(audit.synced_at) < sevenDaysAgo) {
      await store.delete(audit.id);
    }
  }
};

// Cache API data for offline use
export const cacheData = async (key, data) => {
  const db = await openDB();
  const tx = db.transaction('cached-data', 'readwrite');
  const store = tx.objectStore('cached-data');
  
  await store.put({
    key,
    data,
    cached_at: new Date().toISOString()
  });
};

// Get cached data
export const getCachedData = async (key) => {
  const db = await openDB();
  const tx = db.transaction('cached-data', 'readonly');
  const store = tx.objectStore('cached-data');
  
  return new Promise((resolve, reject) => {
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result?.data || null);
    request.onerror = () => reject(request.error);
  });
};

// Get offline queue count
export const getOfflineQueueCount = async () => {
  const db = await openDB();
  const tx = db.transaction('offline-queue', 'readonly');
  const store = tx.objectStore('offline-queue');
  
  return new Promise((resolve, reject) => {
    const request = store.count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

// Clear all offline data (for logout)
export const clearAllOfflineData = async () => {
  const db = await openDB();
  
  const stores = ['offline-audits', 'cached-data', 'offline-queue'];
  
  for (const storeName of stores) {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    await store.clear();
  }
};
