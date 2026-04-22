import { describe, test, expect } from 'bun:test';
import type { IncomingMessage } from 'http';
import { EventEmitter } from 'events';

import { readJsonBody } from '../utils';

/**
 * Node http IncomingMessage 의 최소 모킹 — stream 의 data/end/error 이벤트 + connect /
 * Express middleware 가 덧붙이는 `body` / `rawBody` 필드를 조합해 각 분기 검증.
 */
class FakeReq extends EventEmitter {
  readable = true;
  complete = false;
  body?: unknown;
  rawBody?: string | Buffer | null;

  /** stream 이 살아있는 상태에서 body chunk → end 를 순차 발화. */
  feed(chunks: string[]) {
    queueMicrotask(() => {
      for (const c of chunks) this.emit('data', Buffer.from(c));
      this.readable = false;
      this.complete = true;
      this.emit('end');
    });
  }
}

function asReq(fake: FakeReq): IncomingMessage {
  return fake as unknown as IncomingMessage;
}

describe('readJsonBody', () => {
  test('stream 모드: data → end 로 JSON 파싱', async () => {
    const fake = new FakeReq();
    fake.feed(['{"hello":', '"world"}']);
    const body = await readJsonBody<{ hello: string }>(asReq(fake));
    expect(body.hello).toBe('world');
  });

  test('stream 모드: 잘못된 JSON 은 reject', async () => {
    const fake = new FakeReq();
    fake.feed(['not-json']);
    await expect(readJsonBody(asReq(fake))).rejects.toThrow();
  });

  test('drain + express.json() parsed body (object) 재사용', async () => {
    // @rozenite/middleware 가 router.use(express.json()) 로 주입하는 대표 케이스.
    const fake = new FakeReq();
    fake.readable = false;
    fake.complete = true;
    fake.body = { stack: [{ file: 'x', lineNumber: 1 }] };
    const body = await readJsonBody<{ stack: { file: string; lineNumber: number }[] }>(
      asReq(fake),
    );
    expect(body.stack).toHaveLength(1);
    expect(body.stack[0].file).toBe('x');
  });

  test('drain + raw-body-middleware 가 저장한 string 파싱', async () => {
    const fake = new FakeReq();
    fake.readable = false;
    fake.complete = true;
    fake.body = JSON.stringify({ cached: true });
    const body = await readJsonBody<{ cached: boolean }>(asReq(fake));
    expect(body.cached).toBe(true);
  });

  test('drain + rawBody Buffer 파싱 (RN cli-server-api `/symbolicate`)', async () => {
    const fake = new FakeReq();
    fake.readable = false;
    fake.complete = true;
    fake.rawBody = Buffer.from(JSON.stringify({ buffered: 42 }));
    const body = await readJsonBody<{ buffered: number }>(asReq(fake));
    expect(body.buffered).toBe(42);
  });

  test('drain + 캐시 없음: 빈 객체 반환 (hang 방지)', async () => {
    const fake = new FakeReq();
    fake.readable = false;
    fake.complete = true;
    const body = await readJsonBody<{ stack?: unknown }>(asReq(fake));
    expect(body).toEqual({});
  });
});
