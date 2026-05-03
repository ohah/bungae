/**
 * DevMiddleware loader for @react-native/dev-middleware
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { createRequire } from 'module';
import type { Duplex } from 'stream';

import type { WebSocket } from 'ws';

import { logInfo, logWarn } from '../utils';

/**
 * Resolve @react-native/dev-middleware from the **project's** context, not bungae's.
 *
 * 왜: Rozenite 같은 도구가 dev-middleware의 `getDevToolsFrontendUrl`을 monkey-patch
 * 하는데, 이는 특정 모듈 인스턴스에 적용됨. Rozenite는 project 기준으로 dev-middleware
 * 를 찾기 때문에, bungae도 같은 인스턴스를 써야 패치가 적용됨. 만약 bungae가 자기
 * node_modules 기준으로 resolve하면 버전/인스턴스가 달라 monkey-patch가 씹힘
 * (RN 0.85 업그레이드 후 Rozenite가 동작 안 한 원인).
 *
 * Metro/RN CLI 실행 경로와 동일하게: project → @react-native/community-cli-plugin
 * → @react-native/dev-middleware 순으로 resolve.
 */
function resolveDevMiddlewarePath(projectRoot: string): string {
  const projectRequire = createRequire(`${projectRoot}/package.json`);

  // Bun workspace: 트랜지티브 패키지는 project node_modules에 symlink되지 않음.
  // RN → @react-native/community-cli-plugin → @react-native/dev-middleware 체인을
  // react-native의 package.json 경로 기준으로 건너가며 찾음.
  try {
    const reactNativePath = projectRequire.resolve('react-native/package.json');
    const rnRequire = createRequire(reactNativePath);
    const cliPluginPath = rnRequire.resolve('@react-native/community-cli-plugin/package.json');
    const cliPluginRequire = createRequire(cliPluginPath);
    return cliPluginRequire.resolve('@react-native/dev-middleware');
  } catch {
    // Expo(bare) 혹은 직접 dep으로 두는 경우 fallback.
    try {
      return projectRequire.resolve('@react-native/dev-middleware');
    } catch {
      // 최후의 수단 — bungae가 자기 node_modules에서 찾음 (버전 mismatch 경고는 있지만 동작은 함).
      return require.resolve('@react-native/dev-middleware');
    }
  }
}

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
    // Resolve from project context so Rozenite-style monkey-patches on the
    // same module instance take effect (see resolveDevMiddlewarePath comment).
    const devMiddlewarePath = resolveDevMiddlewarePath(projectRoot);
    const devMiddlewareModule = (await import(devMiddlewarePath)) as {
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
      // Metro defaults: enableNetworkInspector=false, enableStandaloneFuseboxShell=true
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
