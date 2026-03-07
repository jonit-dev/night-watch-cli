import { useEffect, useRef } from 'react';
import { useStatusStream, fetchStatus, API_BASE, apiPath } from '../api';
import { useStore } from '../store/useStore';
import { pickLatestSnapshot } from '../utils/status';
import type { IStatusSnapshot } from '@shared/types';

/**
 * Centralized status synchronization hook.
 * Subscribes to SSE for real-time updates and polls as fallback.
 * Updates the shared Zustand store so all components read from a single source.
 */
export function useStatusSync(): void {
  const { setStatus, selectedProjectId, globalModeLoading } = useStore();
  const statusRef = useRef<IStatusSnapshot | null>(null);

  // Keep ref in sync for SSE callback
  statusRef.current = useStore.getState().status;

  // SSE subscription for real-time updates
  useStatusStream(
    (snapshot) => {
      // Prevent stale SSE overwrites using pickLatestSnapshot
      const latest = pickLatestSnapshot(snapshot, statusRef.current);
      if (latest === snapshot) {
        setStatus(snapshot);
      }
    },
    [selectedProjectId, globalModeLoading],
    { enabled: !globalModeLoading },
  );

  // Initial fetch and periodic polling as fallback
  useEffect(() => {
    if (globalModeLoading) {
      return;
    }

    // Initial fetch
    fetchStatus()
      .then((snapshot) => {
        const latest = pickLatestSnapshot(snapshot, statusRef.current);
        if (latest === snapshot) {
          setStatus(snapshot);
        }
      })
      .catch(() => {
        // Ignore initial fetch errors - SSE may still work
      });

    // Poll every 30s as fallback
    const interval = setInterval(() => {
      fetchStatus()
        .then((snapshot) => {
          const latest = pickLatestSnapshot(snapshot, statusRef.current);
          if (latest === snapshot) {
            setStatus(snapshot);
          }
        })
        .catch(() => {
          // Ignore polling errors
        });
    }, 30000);

    return () => clearInterval(interval);
  }, [selectedProjectId, globalModeLoading, setStatus]);

  // Refetch on window focus
  useEffect(() => {
    const onFocus = () => {
      fetchStatus()
        .then((snapshot) => {
          const latest = pickLatestSnapshot(snapshot, statusRef.current);
          if (latest === snapshot) {
            setStatus(snapshot);
          }
        })
        .catch(() => {
          // Ignore focus fetch errors
        });
    };

    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [selectedProjectId, setStatus]);
}
