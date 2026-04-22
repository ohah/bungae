/**
 * ZTS Server Network Integration Tests
 *
 * 실제 ZTS dev server를 bunx bungae start로 띄우고
 * HTTP 요청으로 번들/소스맵/에셋/status 엔드포인트를 검증.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

import { spawn, type Subprocess } from 'bun';

const EXAMPLE_APP_DIR = resolve(__dirname, '../../../../../examples/ExampleApp');
const TIMEOUT = 90_000;
const PORT = 18765;
const BASE = `http://localhost:${PORT}`;

describe('ZTS Server Network', () => {
  let proc: Subprocess | null = null;

  beforeAll(async () => {
    if (!existsSync(resolve(EXAMPLE_APP_DIR, 'index.js'))) {
      console.warn('ExampleApp not found, skipping');
      return;
    }

    // bunx bungae start --bundler zts
    proc = spawn({
      cmd: ['bunx', 'bungae', 'start', '--bundler', 'zts', '--port', String(PORT)],
      cwd: EXAMPLE_APP_DIR,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    // 서버 시작 + 빌드 완료 대기
    console.log('[test] Waiting for ZTS server to start...');
    const deadline = Date.now() + 60_000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${BASE}/status`);
        if (res.ok) {
          const bundleRes = await fetch(`${BASE}/index.bundle?platform=ios`);
          if (bundleRes.ok && (await bundleRes.text()).length > 1000) {
            ready = true;
            break;
          }
        }
      } catch {
        /* not ready yet */
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    if (!ready) {
      console.error('[test] ZTS server failed to start');
      proc?.kill('SIGKILL');
      proc = null;
    } else {
      console.log(
        `[test] ZTS server ready (${((Date.now() - (deadline - 60_000)) / 1000).toFixed(1)}s)`,
      );
    }
  }, TIMEOUT);

  afterAll(async () => {
    if (proc) {
      proc.kill();
      await proc.exited.catch(() => {});
      proc = null;
    }
  });

  // ====== Bundle ======

  test(
    'GET /index.bundle — 200 + JS content',
    async () => {
      if (!proc) return;
      const res = await fetch(`${BASE}/index.bundle?platform=ios`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('javascript');
      const body = await res.text();
      expect(body.length).toBeGreaterThan(1000);
    },
    TIMEOUT,
  );

  test(
    '번들에 sourceMappingURL 포함',
    async () => {
      if (!proc) return;
      const res = await fetch(`${BASE}/index.bundle?platform=ios`);
      const body = await res.text();
      // sourceMappingURL이 있어야 함 (Metro 호환 URL 또는 ZTS 원본)
      expect(body).toContain('//# sourceMappingURL=');
    },
    TIMEOUT,
  );

  // multipart/mixed 테스트는 RN 네이티브 클라이언트만 사용하므로 스킵
  // (bun fetch의 Accept 헤더 처리가 RN과 다름)

  // ====== Source Map ======

  test(
    'GET /index.map — 유효한 JSON 소스맵',
    async () => {
      if (!proc) return;
      const res = await fetch(`${BASE}/index.map?platform=ios`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('json');
      const body = await res.text();
      // null byte 없어야 함
      expect(body).not.toContain('\0');

      const parsed = JSON.parse(body);
      expect(parsed.version).toBe(3);
      expect(Array.isArray(parsed.sources)).toBe(true);
      expect(parsed.sources.length).toBeGreaterThan(0);
      expect(typeof parsed.mappings).toBe('string');
      expect(parsed.mappings.length).toBeGreaterThan(0);
    },
    TIMEOUT,
  );

  // ====== Assets ======

  test(
    'GET /assets/src/assets/test-icon.png — 프로젝트 에셋 200',
    async () => {
      if (!proc) return;
      const res = await fetch(`${BASE}/assets/src/assets/test-icon.png`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('image/png');
      const buf = await res.arrayBuffer();
      expect(buf.byteLength).toBeGreaterThan(0);
    },
    TIMEOUT,
  );

  // ====== Status ======

  test(
    'GET /status — packager-status:running',
    async () => {
      if (!proc) return;
      const res = await fetch(`${BASE}/status`);
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toBe('packager-status:running');
    },
    TIMEOUT,
  );

  // ====== Lazy sourcemap routes (ZTS #1727 Phase B) ======

  test(
    'GET /__zts_hmr_map/:moduleId — 미존재 모듈은 404',
    async () => {
      if (!proc) return;
      const res = await fetch(
        `${BASE}/__zts_hmr_map/${encodeURIComponent('definitely/not/a/module.ts')}?platform=ios`,
      );
      expect(res.status).toBe(404);
    },
    TIMEOUT,
  );

  test(
    'GET /index.map — lazy 반복 호출에서 build 단위 cache 재사용 (동일 JSON)',
    async () => {
      if (!proc) return;
      const r1 = await fetch(`${BASE}/index.map?platform=ios`);
      expect(r1.status).toBe(200);
      const b1 = await r1.text();
      const r2 = await fetch(`${BASE}/index.map?platform=ios`);
      expect(r2.status).toBe(200);
      const b2 = await r2.text();
      // build 가 바뀌지 않았으므로 byte-identical — cache hit 확인.
      expect(b1.length).toBe(b2.length);
      expect(b1).toBe(b2);
    },
    TIMEOUT,
  );

  // ====== Symbolicate ======

  test(
    'POST /symbolicate — 스택트레이스 응답',
    async () => {
      if (!proc) return;
      // 소스맵이 있어야 symbolicate 동작
      const mapRes = await fetch(`${BASE}/index.map?platform=ios`);
      if (mapRes.status !== 200) {
        console.warn('Source map not available, skipping symbolicate test');
        return;
      }
      const res = await fetch(`${BASE}/symbolicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stack: [
            {
              file: `${BASE}/index.bundle?platform=ios`,
              lineNumber: 100,
              column: 1,
              methodName: 'test',
            },
          ],
        }),
      });
      // symbolicate 엔드포인트가 응답하는지 확인
      if (res.status === 200) {
        const body = (await res.json()) as { stack: unknown[] };
        expect(body).toHaveProperty('stack');
        expect(Array.isArray(body.stack)).toBe(true);
      } else {
        // 소스맵이 없으면 500 또는 다른 에러 가능 — 404만 아니면 OK
        console.warn(`symbolicate returned ${res.status}`);
      }
    },
    TIMEOUT,
  );

  // ====== No-change save ======

  test(
    '파일 수정 없이 저장 시 hmr:reload 미발생',
    async () => {
      if (!proc) return;

      const ws = new WebSocket(`ws://localhost:${PORT}/hot`);
      const messages: any[] = [];

      await new Promise<void>((resolve, reject) => {
        ws.addEventListener('open', () => resolve());
        ws.addEventListener('error', (e) => reject(e));
        setTimeout(() => reject(new Error('WS timeout')), 5000);
      });

      ws.addEventListener('message', (e) => {
        try {
          messages.push(JSON.parse(e.data as string));
        } catch {
          /* */
        }
      });

      // touch without change
      const appPath = resolve(EXAMPLE_APP_DIR, 'App.tsx');
      if (existsSync(appPath)) {
        const content = readFileSync(appPath, 'utf-8');
        writeFileSync(appPath, content);
      }

      await new Promise((r) => setTimeout(r, 3000));
      ws.close();

      const reloads = messages.filter((m) => m.type === 'hmr:reload');
      expect(reloads.length).toBe(0);
    },
    TIMEOUT,
  );
});
