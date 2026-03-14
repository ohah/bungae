import { describe, expect, it } from 'bun:test';

import { getDefaultConfig } from '../../../../config/defaults';
import { babelPluginsPlugin } from '../../plugins/babel-plugins';

function createConfig(babelPlugins: any[] = []) {
  const config = getDefaultConfig('/tmp/test-project');
  config.transformer.babelPlugins = babelPlugins;
  return config;
}

describe('babelPluginsPlugin', () => {
  it('should return null when no babelPlugins configured', () => {
    const plugin = babelPluginsPlugin(createConfig([]));
    expect(plugin).toBeNull();
  });

  it('should return null when babelPlugins is undefined', () => {
    const config = getDefaultConfig('/tmp/test-project');
    // @ts-expect-error testing undefined
    config.transformer.babelPlugins = undefined;
    const plugin = babelPluginsPlugin(config);
    expect(plugin).toBeNull();
  });

  it('should return a plugin when babelPlugins are configured', () => {
    // Use a babel plugin that exists in our dependencies
    const plugin = babelPluginsPlugin(createConfig(['@babel/plugin-transform-flow-strip-types']));
    expect(plugin).not.toBeNull();
    expect(plugin!.name).toBe('bungae:babel-plugins');
  });

  it('should support [plugin, options] tuple format', () => {
    const plugin = babelPluginsPlugin(
      createConfig([['@babel/plugin-transform-flow-strip-types', { allowDeclareFields: true }]]),
    );
    expect(plugin).not.toBeNull();
    expect(plugin!.name).toBe('bungae:babel-plugins');
  });

  it('should have a transform function', () => {
    const plugin = babelPluginsPlugin(createConfig(['@babel/plugin-transform-flow-strip-types']));
    expect(plugin).not.toBeNull();
    expect(typeof plugin!.transform).toBe('function');
  });
});
