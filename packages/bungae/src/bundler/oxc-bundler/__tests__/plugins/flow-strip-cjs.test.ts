/**
 * Test that flow-strip plugin correctly preserves CJS module type.
 *
 * Rolldown replaces unresolved namespace members with (void 0).
 * When flow-strip returns moduleType: 'jsx' for CJS files, Rolldown treats
 * them as ESM and can't resolve named exports → (void 0) replacement.
 */

import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { rolldown } from 'rolldown';

import { flowStripPlugin, containsFlowSyntax } from '../../plugins/flow-strip';
import { getDefaultConfig } from '../../../../config/defaults';

const TMP_DIR = join(import.meta.dir, '__tmp_flow_cjs__');

function createTestConfig(root: string) {
  const config = getDefaultConfig(root);
  config.outDir = join(root, 'dist');
  return config;
}

beforeAll(() => {
  mkdirSync(TMP_DIR, { recursive: true });

  // CJS module with Flow types
  const libDir = join(TMP_DIR, 'node_modules', 'flow-cjs-lib');
  mkdirSync(libDir, { recursive: true });
  writeFileSync(
    join(libDir, 'index.js'),
    `/**
 * @flow
 */

type Props = {
  children: string,
};

function FlowComponent(props: Props) {
  return props.children;
}

module.exports = { FlowComponent };
`,
  );
  writeFileSync(
    join(libDir, 'package.json'),
    '{"name":"flow-cjs-lib","version":"1.0.0","main":"index.js"}',
  );

  // Entry file that imports from CJS Flow module
  writeFileSync(
    join(TMP_DIR, 'entry.js'),
    `import { FlowComponent } from 'flow-cjs-lib';

function App(props) {
  return props.show && FlowComponent({ children: "hello" });
}

export { App };
`,
  );
});

afterAll(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

describe('flow-strip CJS preservation', () => {
  it('should detect CJS pattern in Flow code', () => {
    expect(containsFlowSyntax('// @flow\nmodule.exports = {}')).toBe(true);
  });

  it('should NOT produce (void 0) for CJS Flow modules', async () => {
    const config = createTestConfig(TMP_DIR);
    const plugin = flowStripPlugin(config);

    const bundle = await rolldown({
      input: join(TMP_DIR, 'entry.js'),
      cwd: TMP_DIR,
      plugins: [plugin],
    });

    const { output } = await bundle.generate({ format: 'esm' });
    const code = output[0].code;

    // Should NOT contain (void 0)( which means unresolved export
    expect(code).not.toContain('(void 0)(');
    // Should contain FlowComponent reference
    expect(code).toContain('FlowComponent');

    await bundle.close();
  });
});
