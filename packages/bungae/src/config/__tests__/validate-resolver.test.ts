import { describe, test, expect } from 'bun:test';

import { validateConfig, ConfigValidationError } from '../validate';

describe('validateConfig — Metro 호환 resolver 옵션', () => {
  test('extraNodeModules: 객체면 통과', () => {
    expect(() =>
      validateConfig({
        resolver: {
          extraNodeModules: { crypto: '/path/to/crypto-browserify' },
        },
      }),
    ).not.toThrow();
  });

  test('extraNodeModules: 배열은 거부', () => {
    expect(() =>
      validateConfig({
        resolver: {
          extraNodeModules: [] as unknown as Record<string, string>,
        },
      }),
    ).toThrow(ConfigValidationError);
  });

  test('extraNodeModules: 문자열은 거부', () => {
    expect(() =>
      validateConfig({
        resolver: {
          extraNodeModules: 'invalid' as unknown as Record<string, string>,
        },
      }),
    ).toThrow(/extraNodeModules.*object/);
  });

  test('resolveRequest: 함수면 통과', () => {
    expect(() =>
      validateConfig({
        resolver: {
          resolveRequest: (ctx, name, _platform) => {
            return ctx.resolveRequest(ctx, name, _platform);
          },
        },
      }),
    ).not.toThrow();
  });

  test('resolveRequest: 함수가 아니면 거부', () => {
    expect(() =>
      validateConfig({
        resolver: {
          resolveRequest: 'not-a-function' as never,
        },
      }),
    ).toThrow(/resolveRequest.*function/);
  });

  test('blockList: RegExp 배열 통과 (Metro 시그니처 그대로)', () => {
    expect(() =>
      validateConfig({
        resolver: {
          blockList: [/\/ios\//, /\.bak$/],
        },
      }),
    ).not.toThrow();
  });
});
