import { useEffect } from 'react';
import { useApi, fetchStatus, useStatusStream } from '../api';
import { useStore } from '../store/useStore';

/**
 * Hook that owns the SSE subscription + polling for status updates.
 * This should be called at the app root to ensure a single subscription
 * for the whole application.
 */
export function useStatusSync(): void {
  const { setStatus, setProjectName, selectedProjectId, globalModeLoading } = useStore();

  // 1. useApi(fetchStatus) with 30s polling + window focus refetch
  const { data: status, refetch } = useApi(fetchStatus, [selectedProjectId], {
    enabled: !globalModeLoading,
  });

  // Update store when polled status changes
  useEffect(() => {
    if (status) {
      setStatus(status);
    }
  }, [status, setStatus]);

  // 2. useStatusStream for SSE fast path
  useStatusStream(
    (snapshot) => {
      setStatus(snapshot);
    },
    [selectedProjectId, globalModeLoading],
    { enabled: !globalModeLoading }
  );

  // 30s polling interval
  useEffect(() => {
    if (globalModeLoading) return;

    const interval = setInterval(() => {
      refetch();
    }, 30000);
    return () => clearInterval(interval);
  }, [refetch, globalModeLoading]);

  // Refetch on window focus
  useEffect(() => {
    if (globalModeLoading) return;

    const onFocus = () => refetch();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refetch, globalModeLoading]);

  // 3. Update projectName when status.projectName changes
  useEffect(() => {
    const currentStatus = useStore.getState().status;
    if (currentStatus?.projectName) {
      setProjectName(currentStatus.projectName);
    }
  }, [status, setProjectName]);
}
