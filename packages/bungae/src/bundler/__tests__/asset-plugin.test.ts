/**
 * ZTS Asset Plugin Tests
 *
 * httpServerLocation 계산 로직 검증
 */

import { describe, test, expect } from 'bun:test';
import { join } from 'path';

import { computeHttpServerLocation } from '../zts-bundler/asset-plugin';

describe('computeHttpServerLocation', () => {
  const projectRoot = '/Users/dev/project';

  test('프로젝트 내부 에셋 — src/assets/', () => {
    const filePath = join(projectRoot, 'src/assets/icon.png');
    expect(computeHttpServerLocation(filePath, projectRoot)).toBe('/assets/src/assets');
  });

  test('프로젝트 루트 에셋', () => {
    const filePath = join(projectRoot, 'logo.png');
    expect(computeHttpServerLocation(filePath, projectRoot)).toBe('/assets');
  });

  test('node_modules 에셋 (hoisted)', () => {
    const filePath = join(
      projectRoot,
      'node_modules/react-native/Libraries/LogBox/UI/LogBoxImages/close.png',
    );
    expect(computeHttpServerLocation(filePath, projectRoot)).toBe(
      '/assets/node_modules/react-native/Libraries/LogBox/UI/LogBoxImages',
    );
  });

  test('프로젝트 외부 node_modules — ../가 제거됨', () => {
    // monorepo: project root = /Users/dev/project/apps/mobile
    // asset = /Users/dev/project/node_modules/react-native/.../close.png
    const monoRoot = '/Users/dev/project/apps/mobile';
    const filePath = '/Users/dev/project/node_modules/react-native/Libraries/LogBox/close.png';
    const result = computeHttpServerLocation(filePath, monoRoot);
    expect(result).not.toContain('..');
    expect(result).toBe('/assets/node_modules/react-native/Libraries/LogBox');
  });

  test('Bun .bun 디렉토리 에셋 — ../가 제거됨', () => {
    // Bun workspace: .bun 디렉토리가 workspace root에 있음
    const monoRoot = '/Users/dev/workspace/examples/App';
    const filePath =
      '/Users/dev/workspace/node_modules/.bun/react-native@0.83.1+hash/node_modules/react-native/Libraries/LogBox/UI/close.png';
    const result = computeHttpServerLocation(filePath, monoRoot);
    expect(result).not.toContain('..');
    expect(result).toContain('node_modules/.bun/react-native@0.83.1');
  });

  test('깊은 ../도 모두 제거', () => {
    const monoRoot = '/Users/dev/a/b/c/d';
    const filePath = '/Users/dev/node_modules/pkg/icon.png';
    const result = computeHttpServerLocation(filePath, monoRoot);
    expect(result).not.toContain('..');
    expect(result).toBe('/assets/node_modules/pkg');
  });

  test('httpServerLocation에 슬래시 정규화', () => {
    const filePath = join(projectRoot, 'src', 'components', 'icons', 'arrow.png');
    const result = computeHttpServerLocation(filePath, projectRoot);
    expect(result).toBe('/assets/src/components/icons');
    expect(result).not.toContain('\\');
  });
});
