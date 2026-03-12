/**
 * Quick test script for OXC bundler with ExampleApp
 * Usage: npx tsx scripts/test-oxc-bundler.ts
 */

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { buildWithOxc } from '../packages/bungae/src/bundler/oxc-bundler/index.js';
import { resolveConfig } from '../packages/bungae/src/config/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../examples/ExampleApp');

const config = resolveConfig({
  root,
  entry: 'index.js',
  platform: 'ios',
  dev: true,
  bundler: 'oxc',
  resolver: {
    nodeModulesPaths: [resolve(__dirname, '../node_modules'), resolve(root, 'node_modules')],
  },
});

async function main() {
  try {
    const startTime = Date.now();
    const result = await buildWithOxc(config, undefined, { hermes: false });
    const totalTime = Date.now() - startTime;

    console.log('\n=== OXC 번들러 테스트 결과 ===');
    console.log(`총 시간: ${totalTime}ms`);
    console.log(`코드 크기: ${(result.code.length / 1024).toFixed(1)}KB`);
    console.log(`소스맵: ${result.map ? 'yes' : 'no'}`);
    console.log(`에셋: ${result.assets.length} files`);
    console.log('\n--- 코드 앞 500자 ---');
    console.log(result.code.substring(0, 500));
    console.log('\n--- 코드 뒤 200자 ---');
    console.log(result.code.substring(result.code.length - 200));
  } catch (err: any) {
    console.error('\n❌ 에러:', err.message);
    if (err.stack) {
      console.error(err.stack.split('\n').slice(0, 15).join('\n'));
    }
  }
}

main();
