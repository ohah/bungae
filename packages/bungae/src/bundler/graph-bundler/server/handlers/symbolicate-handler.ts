/**
 * Symbolicate request handler
 */

import { readFileSync } from 'fs';
import type { IncomingMessage, ServerResponse } from 'http';
import { resolve } from 'path';

import type { ResolvedConfig } from '../../../../config/types';
import type { BuildResult } from '../../types';
import { readJsonBody, sendJson } from '../utils';

/**
 * Handle symbolicate request
 */
export async function handleSymbolicate(
  req: IncomingMessage,
  res: ServerResponse,
  _url: URL,
  config: ResolvedConfig,
  platform: string,
  cachedBuilds: Map<string, BuildResult>,
  sourceMapConsumers: Map<string, any>,
): Promise<void> {
  try {
    const body = await readJsonBody<{
      stack?: Array<{
        file?: string;
        lineNumber?: number;
        column?: number;
        methodName?: string;
      }>;
      extraData?: any;
    }>(req);

    const stack = body.stack || [];

    // Extract platform from stack frames
    const bundleUrlFromStack = stack.find((frame) => frame.file?.includes('.bundle'))?.file;
    let mapPlatform = platform;
    if (bundleUrlFromStack) {
      try {
        const urlObj = new URL(bundleUrlFromStack);
        const platformParam = urlObj.searchParams.get('platform');
        if (platformParam) {
          mapPlatform = platformParam as 'ios' | 'android' | 'web';
        }
      } catch {
        // Invalid URL, use default platform
      }
    }

    const cachedBuild = cachedBuilds.get(mapPlatform);
    if (!cachedBuild?.map) {
      sendJson(res, 200, {
        stack: stack.map((frame) => ({ ...frame })),
        codeFrame: null,
      });
      return;
    }

    // Reuse cached Consumer
    let consumer = sourceMapConsumers.get(mapPlatform);
    if (!consumer) {
      const metroSourceMap = await import('metro-source-map');
      const { Consumer } = metroSourceMap;
      const sourceMap = JSON.parse(cachedBuild.map);
      consumer = new Consumer(sourceMap);
      sourceMapConsumers.set(mapPlatform, consumer);
    }

    // Symbolicate each frame
    const symbolicatedStack = stack.map((frame) => {
      if (!frame.file || frame.lineNumber == null) {
        return { ...frame };
      }

      try {
        const originalPos = consumer.originalPositionFor({
          line: frame.lineNumber as any,
          column: (frame.column ?? 0) as any,
        });

        if (originalPos.source == null || originalPos.line == null) {
          return { ...frame };
        }

        // Handle Metro-style source paths like [metro-project]/App.tsx
        // Convert to actual file path for symbolication
        let sourcePath: string;
        if (originalPos.source.startsWith('[metro-project]/')) {
          // Remove [metro-project]/ prefix and resolve from project root
          const relativePath = originalPos.source.slice('[metro-project]/'.length);
          sourcePath = resolve(config.root, relativePath);
        } else if (originalPos.source.startsWith('[metro-watchFolders]/')) {
          // Handle [metro-watchFolders]/{i}/ paths
          // For now, try to resolve from project root (can be improved)
          const relativePath = originalPos.source.replace(/^\[metro-watchFolders\]\/\d+\//, '');
          sourcePath = resolve(config.root, relativePath);
        } else if (originalPos.source.startsWith('/')) {
          sourcePath = originalPos.source;
        } else {
          sourcePath = resolve(config.root, originalPos.source);
        }

        const originalLine =
          typeof originalPos.line === 'number' ? originalPos.line : Number(originalPos.line);
        const originalColumn =
          typeof originalPos.column === 'number'
            ? originalPos.column
            : Number(originalPos.column ?? 0);

        return {
          ...frame,
          file: sourcePath,
          lineNumber: originalLine,
          column: originalColumn,
          methodName: originalPos.name ?? frame.methodName,
        };
      } catch {
        return { ...frame };
      }
    });

    // Generate code frame
    let codeFrame: {
      content: string;
      location: { row: number; column: number };
      fileName: string;
    } | null = null;

    for (const frame of symbolicatedStack) {
      if (frame.file && frame.lineNumber != null && !frame.file.includes('.bundle')) {
        try {
          const sourceCode = readFileSync(frame.file, 'utf-8');
          const lines = sourceCode.split('\n');
          const targetLine = (frame.lineNumber ?? 1) - 1;
          if (targetLine >= 0 && targetLine < lines.length) {
            const column = frame.column ?? 0;
            const startLine = Math.max(0, targetLine - 2);
            const endLine = Math.min(lines.length - 1, targetLine + 2);
            const context = lines.slice(startLine, endLine + 1);
            const pointer = ' '.repeat(Math.max(0, column)) + '^';
            codeFrame = {
              content: context.join('\n') + '\n' + pointer,
              location: {
                row: frame.lineNumber ?? 1,
                column: frame.column ?? 0,
              },
              fileName: frame.file,
            };
            break;
          }
        } catch {
          // Failed to read file
        }
      }
    }

    sendJson(res, 200, { stack: symbolicatedStack, codeFrame });
  } catch (error) {
    console.error('Symbolication failed:', error);
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}
