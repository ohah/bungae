/**
 * Index page handler
 */

import type { ServerResponse } from 'http';

import { VERSION } from '../../../../index';

/**
 * Send index page
 */
export function sendIndexPage(res: ServerResponse, port: number): void {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bungae Dev Server</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
      font-size: 14px;
      line-height: 1.6;
      color: #333;
      margin: 0;
      padding: 30px;
      background: #fafafa;
    }
    h1 { font-size: 28px; margin-bottom: 8px; font-weight: 600; color: #222; }
    h2 { font-size: 18px; margin: 30px 0 15px 0; font-weight: 600; color: #444; padding-bottom: 8px; border-bottom: 2px solid #e0e0e0; }
    p { margin: 8px 0; color: #666; }
    a { color: #007aff; text-decoration: none; }
    a:hover { color: #0051d5; text-decoration: underline; }
    ul { list-style: none; padding: 0; margin: 15px 0; }
    li { margin: 10px 0; padding: 8px 0; }
    code { background: #f0f0f0; padding: 4px 8px; border-radius: 4px; font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace; font-size: 13px; color: #333; border: 1px solid #e0e0e0; }
    a code { background: #e8f4fd; border-color: #007aff; color: #007aff; }
    a:hover code { background: #d0e9fc; }
  </style>
</head>
<body>
  <h1>Bungae Dev Server</h1>
  <p>Lightning Fast React Native Bundler v${VERSION}</p>
  <h2>Bundles</h2>
  <ul>
    <li><a href="/index.bundle?platform=ios&dev=true"><code>/index.bundle?platform=ios&dev=true</code></a></li>
    <li><a href="/index.bundle?platform=android&dev=true"><code>/index.bundle?platform=android&dev=true</code></a></li>
  </ul>
  <h2>Source Maps</h2>
  <ul>
    <li><a href="/index.bundle.map?platform=ios"><code>/index.bundle.map?platform=ios</code></a></li>
    <li><a href="/index.bundle.map?platform=android"><code>/index.bundle.map?platform=android</code></a></li>
  </ul>
  <h2>HMR</h2>
  <ul>
    <li><code>ws://localhost:${port}/hot</code></li>
  </ul>
</body>
</html>`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}
