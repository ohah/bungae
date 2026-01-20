/**
 * Bundler module - Exports bundling functions
 */

// Bun.build() whole-graph bundler (has module execution order issues with React Native)
export { buildWithBun, serveWithBun } from './bun-bundler';
export type { BuildResult } from './bun-bundler';

// Graph bundler with Metro __d()/__r() module system (recommended for React Native)
export { buildWithGraph, serveWithGraph } from './graph-bundler';
