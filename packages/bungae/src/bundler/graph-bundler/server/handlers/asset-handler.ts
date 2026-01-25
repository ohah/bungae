/**
 * Asset request handler
 */

import { existsSync, readFileSync } from 'fs';
import type { ServerResponse } from 'http';
import { extname, resolve, sep } from 'path';

import type { ResolvedConfig } from '../../../../config/types';
import { sendText } from '../utils';

/**
 * Handle asset request
 */
export function handleAssetRequest(res: ServerResponse, url: URL, config: ResolvedConfig): void {
  try {
    let assetRelativePath: string;
    if (url.pathname.startsWith('/assets/')) {
      // /assets/ is relative to project root
      // /assets/icon.png -> icon.png (project root)
      // /assets/subdir/icon.png -> subdir/icon.png
      assetRelativePath = url.pathname.slice('/assets/'.length);
      const pathSegments = assetRelativePath.split('/');
      const resolvedSegments: string[] = [];
      for (const segment of pathSegments) {
        if (segment === '..') {
          if (resolvedSegments.length > 0) {
            resolvedSegments.pop();
          }
        } else if (segment !== '.' && segment !== '') {
          resolvedSegments.push(segment);
        }
      }
      assetRelativePath = resolvedSegments.join('/');
    } else if (url.pathname.startsWith('/node_modules/')) {
      assetRelativePath = url.pathname.slice('/node_modules/'.length);
      assetRelativePath = `node_modules/${assetRelativePath}`;
    } else {
      sendText(res, 400, 'Bad Request');
      return;
    }

    // Remove scale suffix
    assetRelativePath = assetRelativePath.replace(/@\d+x\./, '.');
    assetRelativePath = assetRelativePath.replace(/\\/g, '/');
    const normalizedPath = assetRelativePath.replace(/\//g, sep);

    let resolvedAssetPath = resolve(config.root, normalizedPath);

    if (!existsSync(resolvedAssetPath)) {
      for (const nodeModulesPath of config.resolver.nodeModulesPaths) {
        const monorepoPath = resolve(config.root, nodeModulesPath);
        const alternativePath = resolve(monorepoPath, '..', normalizedPath);
        if (existsSync(alternativePath)) {
          resolvedAssetPath = alternativePath;
          break;
        }
      }
    }

    const normalizedAssetPath = resolve(resolvedAssetPath);
    const normalizedRoot = resolve(config.root);

    let isAllowed = normalizedAssetPath.startsWith(normalizedRoot);
    if (!isAllowed) {
      isAllowed = config.resolver.nodeModulesPaths.some((p) => {
        const monorepoNodeModules = resolve(config.root, p);
        return normalizedAssetPath.startsWith(monorepoNodeModules);
      });
    }

    if (!isAllowed) {
      console.warn(`Asset path outside allowed directories: ${normalizedAssetPath}`);
      sendText(res, 403, 'Forbidden');
      return;
    }

    if (!existsSync(normalizedAssetPath)) {
      console.warn(`Asset not found: ${normalizedAssetPath} (requested: ${url.pathname})`);
      sendText(res, 404, 'Not Found');
      return;
    }

    const ext = extname(normalizedAssetPath).toLowerCase();
    const contentTypeMap: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.json': 'application/json',
    };
    const contentType = contentTypeMap[ext] || 'application/octet-stream';

    const fileContent = readFileSync(normalizedAssetPath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000',
      'Content-Length': fileContent.length,
    });
    res.end(fileContent);
  } catch (error) {
    console.error(`Error serving asset ${url.pathname}:`, error);
    sendText(res, 500, 'Internal Server Error');
  }
}
