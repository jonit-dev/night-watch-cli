/**
 * SSE (Server-Sent Events) client registry and broadcaster utilities.
 */

import { Response } from 'express';

import { INightWatchConfig, fetchStatusSnapshot } from '@night-watch/core';

/**
 * SSE client registry type
 */
export type SseClientSet = Set<Response>;

/**
 * Broadcast an SSE event to all connected clients.
 */
export function broadcastSSE(clients: SseClientSet, event: string, data: unknown): void {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try {
      client.write(msg);
    } catch {
      clients.delete(client);
    }
  }
}

/**
 * Start the SSE status change watcher that broadcasts when snapshot changes.
 */
export function startSseStatusWatcher(
  clients: SseClientSet,
  projectDir: string,
  getConfig: () => INightWatchConfig,
): ReturnType<typeof setInterval> {
  let lastSnapshotHash = '';
  return setInterval(() => {
    if (clients.size === 0) return;
    try {
      const snapshot = fetchStatusSnapshot(projectDir, getConfig());
      const hash = JSON.stringify({
        processes: snapshot.processes,
        prds: snapshot.prds.map((p) => ({ n: p.name, s: p.status })),
      });
      if (hash !== lastSnapshotHash) {
        lastSnapshotHash = hash;
        broadcastSSE(clients, 'status_changed', snapshot);
      }
    } catch {
      // Silently ignore errors during status polling
    }
  }, 2000);
}
