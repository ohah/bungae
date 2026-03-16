import { describe, expect, it } from 'bun:test';

import { getDefaultConfig } from '../../../../config/defaults';
import { babelPluginsPlugin } from '../../plugins/babel-plugins';

function createConfig(babel?: { presets?: any[]; plugins?: any[] }) {
  const config = getDefaultConfig('/tmp/test-project');
  config.transformer.babel = babel || { presets: [], plugins: [] };
  return config;
}

describe('babelPluginsPlugin', () => {
  it('should return null when no babel config', () => {
    const plugin = babelPluginsPlugin(createConfig());
    expect(plugin).toBeNull();
  });

  it('should return null when babel is undefined', () => {
    const config = getDefaultConfig('/tmp/test-project');
    config.transformer.babel = undefined;
    const plugin = babelPluginsPlugin(config);
    expect(plugin).toBeNull();
  });

  it('should return a plugin when plugins are configured', () => {
    const plugin = babelPluginsPlugin(
      createConfig({ plugins: ['@babel/plugin-transform-flow-strip-types'] }),
    );
    expect(plugin).not.toBeNull();
    expect(plugin!.name).toBe('bungae:babel-plugins');
  });

  it('should return a plugin when presets are configured', () => {
    const plugin = babelPluginsPlugin(
      createConfig({ presets: ['@babel/preset-flow'] }),
    );
    expect(plugin).not.toBeNull();
    expect(plugin!.name).toBe('bungae:babel-plugins');
  });

  it('should support [plugin, options] tuple format', () => {
    const plugin = babelPluginsPlugin(
      createConfig({ plugins: [['@babel/plugin-transform-flow-strip-types', { allowDeclareFields: true }]] }),
    );
    expect(plugin).not.toBeNull();
    expect(plugin!.name).toBe('bungae:babel-plugins');
  });

  it('should have a transform function', () => {
    const plugin = babelPluginsPlugin(
      createConfig({ plugins: ['@babel/plugin-transform-flow-strip-types'] }),
    );
    expect(plugin).not.toBeNull();
    expect(typeof plugin!.transform).toBe('function');
  });
});
