import { describe, expect, test } from 'bun:test';

import { createCodegenTransformer } from '../zts-bundler/plugin-core';

describe('codegen view config transformer', () => {
  test('ignores the codegenNativeComponent runtime helper', () => {
    const transform = createCodegenTransformer(process.cwd());
    const code = `
      function codegenNativeComponent<Props>(name: string): mixed {
        return null;
      }
      export default codegenNativeComponent;
    `;

    expect(transform(code, `${process.cwd()}/codegenNativeComponent.js`)).toBeNull();
  });

  test('generates a static view config for NativeComponent specs', () => {
    const transform = createCodegenTransformer(process.cwd());
    const code = `
      import codegenNativeComponent from 'react-native/Libraries/Utilities/codegenNativeComponent';
      import type {ViewProps} from 'react-native/Libraries/Components/View/ViewPropTypes';

      type Props = Readonly<{
        ...ViewProps,
        title?: string,
      }>;

      export default codegenNativeComponent<Props>('RCTTestView');
    `;

    const result = transform(code, `${process.cwd()}/TestViewNativeComponent.js`);

    expect(result).toContain('__INTERNAL_VIEW_CONFIG');
    expect(result).toContain('NativeComponentRegistry.get');
    expect(result).toContain('uiViewClassName: "RCTTestView"');
    expect(result).toContain('title: true');
  });
});
