import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import {
  getPendingOfflineAudits,
  getOfflineQueueCount,
  cleanupSyncedAudits
} from '../utils/offlineDB';

const OfflineContext = createContext();

export const useOffline = () => {
  const context = useContext(OfflineContext);
  if (!context) {
    throw new Error('useOffline must be used within an OfflineProvider');
  }
  return context;
};

export const OfflineProvider = ({ children }) => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  // Update online status
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      toast.success('Back online! Syncing data...');
      syncOfflineData();
    };

    const handleOffline = () => {
      setIsOnline(false);
      toast.warning('You are offline. Changes will be saved locally.');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Listen for service worker messages
  useEffect(() => {
    const handleMessage = (event) => {
      if (event.data.type === 'OFFLINE_REQUEST_QUEUED') {
        updatePendingCount();
        toast.info('Request queued for sync when online');
      }
      
      if (event.data.type === 'OFFLINE_REQUEST_SYNCED') {
        updatePendingCount();
        toast.success('Offline request synced successfully');
      }
    };

    navigator.serviceWorker?.addEventListener('message', handleMessage);

    return () => {
      navigator.serviceWorker?.removeEventListener('message', handleMessage);
    };
  }, []);

  // Update pending count
  const updatePendingCount = useCallback(async () => {
    try {
      const audits = await getPendingOfflineAudits();
      const queueCount = await getOfflineQueueCount();
      setPendingCount(audits.length + queueCount);
    } catch (error) {
      console.error('Error getting pending count:', error);
    }
  }, []);

  // Initial count and periodic cleanup
  useEffect(() => {
    updatePendingCount();
    cleanupSyncedAudits().catch(console.error);

    // Update count every 30 seconds
    const interval = setInterval(updatePendingCount, 30000);
    return () => clearInterval(interval);
  }, [updatePendingCount]);

  // Sync offline data
  const syncOfflineData = useCallback(async () => {
    if (!navigator.onLine || isSyncing) return;

    setIsSyncing(true);
    try {
      // Trigger service worker sync
      if ('serviceWorker' in navigator && 'sync' in window.registration) {
        await window.registration.sync.register('sync-offline-requests');
      } else {
        // Fallback: send message to service worker
        navigator.serviceWorker?.controller?.postMessage({ type: 'SYNC_NOW' });
      }

      // Sync offline audits
      const pendingAudits = await getPendingOfflineAudits();
      
      for (const audit of pendingAudits) {
        try {
          let runId = audit.run_id;
          const startPayload = audit.data?.start || {
            audit_id: audit.audit_id || audit.data?.audit_id,
            location: audit.location || audit.data?.location || null,
            line_shift_id: audit.line_shift_id || null
          };
          const submissionPayload = { expected_version: 0, ...(audit.data?.submission || {
            answers: audit.answers || audit.data?.answers || [],
            notes: audit.notes || audit.data?.notes || null,
            completed: true
          }) };

          if (!runId) {
            const startResponse = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/run-audits`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
              },
              body: JSON.stringify(startPayload)
            });
            if (!startResponse.ok) continue;
            const startedRun = await startResponse.json();
            runId = startedRun.id;
          }

          const response = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/run-audits/${runId}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify(submissionPayload)
          });

          if (response.ok) {
            const { markAuditSynced } = await import('../utils/offlineDB');
            await markAuditSynced(audit.id, runId);
          }
        } catch (error) {
          console.error('Failed to sync audit:', audit.id, error);
        }
      }

      await updatePendingCount();
      
      if (pendingAudits.length > 0) {
        toast.success(`Synced ${pendingAudits.length} offline audit(s)`);
      }
    } catch (error) {
      console.error('Sync error:', error);
      toast.error('Failed to sync some offline data');
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing, updatePendingCount]);

  // Manual sync trigger
  const triggerSync = useCallback(() => {
    if (isOnline) {
      syncOfflineData();
    } else {
      toast.warning('Cannot sync while offline');
    }
  }, [isOnline, syncOfflineData]);

  const value = {
    isOnline,
    pendingCount,
    isSyncing,
    triggerSync,
    updatePendingCount
  };

  return (
    <OfflineContext.Provider value={value}>
      {children}
    </OfflineContext.Provider>
  );
};
