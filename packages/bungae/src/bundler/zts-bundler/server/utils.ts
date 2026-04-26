/**
 * HTTP utility functions for the ZTS dev server.
 */

import type { IncomingMessage, ServerResponse } from 'http';

import * as jscSafeUrl from 'jsc-safe-url';

/**
 * Parse URL from incoming request
 * Metro-compatible: Converts jscSafeUrl format (//&) back to normal URL format
 */
export function parseRequestUrl(req: IncomingMessage, hostname: string, port: number): URL {
  const protocol = 'http';
  const host = req.headers.host || `${hostname}:${port}`;
  // Metro-compatible: Convert jscSafeUrl format to normal URL
  // jscSafeUrl uses //& instead of ? for query parameters (for JSC compatibility)
  const normalUrl = jscSafeUrl.toNormalUrl(req.url || '/');
  return new URL(normalUrl, `${protocol}://${host}`);
}

/**
 * Send JSON response
 */
export function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * Send text response
 */
export function sendText(
  res: ServerResponse,
  statusCode: number,
  text: string,
  contentType = 'text/plain',
): void {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

/**
 * Read request body as JSON
 */
/**
 * Connect / Express 스타일 middleware 가 `IncomingMessage` 에 덧붙이는 비표준 필드.
 * stream 이 이미 drain 된 경우 body 를 복구하려 할 때 참조.
 */
interface MiddlewareAugmentedRequest {
  /** `express.json()` / `bodyParser.json()` 이 파싱해둔 결과 (object). */
  body?: unknown;
  /** raw body middleware 가 저장한 원본 문자열/Buffer (예: RN cli `/symbolicate`). */
  rawBody?: string | Buffer | null;
}

function parseCachedBody<T>(cached: unknown): T | null {
  if (cached == null) return null;
  if (typeof cached === 'string') return JSON.parse(cached) as T;
  if (Buffer.isBuffer(cached)) return JSON.parse(cached.toString('utf-8')) as T;
  // Express bodyParser 는 이미 object 로 parse — 그대로 반환.
  if (typeof cached === 'object') return cached as T;
  return null;
}

export async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  // Connect / Express 미들웨어가 POST body 를 먼저 소비해 `req.complete=true,
  // req.readable=false` 상태로 핸들러에 도달하는 경우가 있다. 대표 사례:
  //   · `@rozenite/middleware` 가 `router.use(express.json())` 으로 전체 체인에 주입
  //     → `req.body` 에 parsed object 저장.
  //   · `@react-native-community/cli-server-api` 의 `/symbolicate` rawBodyMiddleware
  //     → `req.rawBody` 에 원본 Buffer 저장.
  // 이 상태에서 `req.on('data')` 를 등록해도 이벤트가 영원히 발화하지 않아 hang.
  // 우선순위: parsed `body` → `rawBody` → stream. 모두 없으면 빈 객체로 fallback
  // (call site 가 missing field 를 안전하게 처리해야 함).
  const augmented = req as IncomingMessage & MiddlewareAugmentedRequest;
  if (req.complete && !req.readable) {
    return parseCachedBody<T>(augmented.body) ?? parseCachedBody<T>(augmented.rawBody) ?? ({} as T);
  }
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body) as T);
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}
