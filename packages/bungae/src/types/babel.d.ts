/**
 * Type declarations for Babel plugins that don't have their own types
 */

declare module '@babel/plugin-transform-flow-strip-types' {
  import type { PluginObj } from '@babel/core';
  const plugin: (api: any, options?: { all?: boolean }) => PluginObj;
  export default plugin;
}

declare module '@babel/preset-flow' {
  import type { PluginObj } from '@babel/core';
  const preset: (api: any, options?: { all?: boolean }) => { plugins: PluginObj[] };
  export default preset;
}

declare module 'babel-plugin-syntax-hermes-parser' {
  import type { PluginObj } from '@babel/core';
  const plugin: (api: any, options?: { parseLangTypes?: 'flow' | 'all' }) => PluginObj;
  export default plugin;
}
