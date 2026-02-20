/**
 * Graceful shutdown handler for the HTTP server.
 */

import type { Socket } from 'net';
import { Express } from 'express';

const PRE_SHUTDOWN_TIMEOUT_MS = 5_000;
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 12_000;

function withTimeout(
  promise: Promise<void>,
  timeoutMs: number,
  label: string,
): Promise<void> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<void>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timeoutId.unref?.();
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

export function setupGracefulShutdown(
  server: ReturnType<Express['listen']>,
  beforeClose?: () => Promise<void> | void,
): void {
  let shuttingDown = false;
  const sockets = new Set<Socket>();

  server.on('connection', (socket: Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  const closeOpenConnections = (): void => {
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
    for (const socket of sockets) {
      socket.destroy();
    }
  };

  const shutdown = (signal: 'SIGTERM' | 'SIGINT'): void => {
    if (shuttingDown) {
      console.warn(`${signal} received again, forcing shutdown...`);
      closeOpenConnections();
      process.exit(signal === 'SIGINT' ? 130 : 143);
      return;
    }
    shuttingDown = true;

    if (signal === 'SIGINT') {
      console.log('\nSIGINT received, shutting down server...');
    } else {
      console.log('SIGTERM received, shutting down server...');
    }

    const forceExitTimer = setTimeout(() => {
      console.warn(
        `Graceful shutdown timed out after ${GRACEFUL_SHUTDOWN_TIMEOUT_MS}ms; forcing exit`,
      );
      closeOpenConnections();
      process.exit(1);
    }, GRACEFUL_SHUTDOWN_TIMEOUT_MS);
    forceExitTimer.unref?.();

    const runPreShutdown = beforeClose
      ? withTimeout(
          Promise.resolve(beforeClose()),
          PRE_SHUTDOWN_TIMEOUT_MS,
          'Pre-shutdown cleanup',
        )
      : Promise.resolve();

    runPreShutdown
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`Pre-shutdown cleanup failed: ${message}`);
      })
      .finally(() => {
        server.close((err?: Error) => {
          clearTimeout(forceExitTimer);
          if (err) {
            console.warn(`Server close failed: ${err.message}`);
            process.exit(1);
            return;
          }
          console.log('Server closed');
          process.exit(0);
        });
        closeOpenConnections();
      });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
