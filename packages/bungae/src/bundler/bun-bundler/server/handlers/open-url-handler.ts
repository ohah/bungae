/**
 * Open URL handler
 */

import { spawn } from 'child_process';
import type { IncomingMessage, ServerResponse } from 'http';

import { readJsonBody, sendJson } from '../utils';

/**
 * Handle open-url request
 */
export async function handleOpenUrl(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await readJsonBody<{ url?: string }>(req);
    const targetUrl = body?.url;
    if (targetUrl && typeof targetUrl === 'string') {
      let command: string;
      let args: string[];

      if (process.platform === 'win32') {
        command = 'cmd';
        args = ['/c', 'start', '', targetUrl];
      } else if (process.platform === 'darwin') {
        command = 'open';
        args = [targetUrl];
      } else {
        command = 'xdg-open';
        args = [targetUrl];
      }

      const proc = spawn(command, args, {
        detached: true,
        stdio: 'ignore',
      });
      proc.unref();

      console.log(`Opening URL in browser: ${targetUrl}`);
      sendJson(res, 200, { success: true });
    } else {
      sendJson(res, 400, { error: 'Invalid URL' });
    }
  } catch (error) {
    console.error('Error opening URL:', error);
    sendJson(res, 500, { error: 'Failed to open URL' });
  }
}
