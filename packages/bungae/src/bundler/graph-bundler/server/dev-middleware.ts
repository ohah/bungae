/**
 * DevMiddleware loader for @react-native/dev-middleware
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { Duplex } from 'stream';

import type { WebSocket } from 'ws';

import { logInfo, logWarn } from '../utils';

/**
 * Type for dev middleware (dynamically loaded)
 */
export interface DevMiddleware {
  middleware: (req: IncomingMessage, res: ServerResponse, next: (err?: any) => void) => void;
  websocketEndpoints: Record<
    string,
    {
      handleUpgrade: (
        req: IncomingMessage,
        socket: Duplex,
        head: Buffer,
        callback: (ws: WebSocket) => void,
      ) => void;
      emit: (event: string, ws: WebSocket, req: IncomingMessage) => void;
    }
  >;
}

/**
 * Try to load @react-native/dev-middleware
 */
export async function loadDevMiddleware(
  port: number,
  projectRoot: string,
): Promise<DevMiddleware | null> {
  try {
    // Dynamic import - types are available from installed package
    const devMiddlewareModule = (await import('@react-native/dev-middleware')) as {
      createDevMiddleware: (options: {
        serverBaseUrl: string;
        projectRoot?: string;
        logger?: {
          info?: (...args: unknown[]) => void;
          warn?: (...args: unknown[]) => void;
          error?: (...args: unknown[]) => void;
        };
        unstable_experiments?: {
          enableNetworkInspector?: boolean;
          enableStandaloneFuseboxShell?: boolean;
        };
      }) => DevMiddleware;
    };
    const { createDevMiddleware } = devMiddlewareModule;

    // Use localhost for serverBaseUrl (this is what React Native app connects to)
    const serverBaseUrl = `http://localhost:${port}`;

    const devMiddleware = createDevMiddleware({
      serverBaseUrl,
      projectRoot,
      logger: {
        info: (...args: unknown[]) => {
          // Filter out noisy messages
          const msg = args.join(' ');
          if (msg.includes('JavaScript logs have moved')) return;
        },
        warn: () => {},
        error: (...args: unknown[]) => console.error('[DevTools]', ...args),
      },
      unstable_experiments: {
        enableNetworkInspector: true,
        enableStandaloneFuseboxShell: true,
      },
    });

    logInfo('DevTools support enabled');

    return devMiddleware;
  } catch (error) {
    logWarn(
      '@react-native/dev-middleware not available',
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}
