/**
 * HTTP server utility functions
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
export async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
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
