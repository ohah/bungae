import { describe, expect, it } from 'bun:test';

import {
  chunkLoaderPlugin,
  generateChunkLoaderRuntime,
} from '../../plugins/chunk-loader';

describe('chunkLoaderPlugin', () => {
  const plugin = chunkLoaderPlugin({ host: 'localhost', port: 8081, dev: true });

  it('should have correct plugin name', () => {
    expect(plugin.name).toBe('bungae:chunk-loader');
  });

  it('should have renderChunk hook', () => {
    expect(plugin.renderChunk).toBeDefined();
  });

  // Helper to call renderChunk handler
  function callRenderChunk(code: string, chunk: { isEntry?: boolean; fileName?: string } = {}) {
    const hook = plugin.renderChunk as {
      handler: (code: string, chunk: any) => any;
    };
    return hook.handler(code, {
      isEntry: chunk.isEntry ?? true,
      fileName: chunk.fileName ?? 'index.js',
    });
  }

  describe('dynamic import() replacement', () => {
    it('should replace import("./chunk-name.js") with __bungae_loadChunk()', () => {
      const code = `var settings = import("./settings-abc123.js");`;
      const result = callRenderChunk(code);
      expect(result.code).toContain('__bungae_loadChunk("settings-abc123.js")');
      expect(result.code).not.toContain('import(');
    });

    it('should replace single-quoted import() calls', () => {
      const code = `var mod = import('./profile-def456.js');`;
      const result = callRenderChunk(code);
      expect(result.code).toContain('__bungae_loadChunk("profile-def456.js")');
    });

    it('should replace multiple import() calls', () => {
      const code = `
        var a = import("./chunk-a.js");
        var b = import("./chunk-b.js");
      `;
      const result = callRenderChunk(code);
      expect(result.code).toContain('__bungae_loadChunk("chunk-a.js")');
      expect(result.code).toContain('__bungae_loadChunk("chunk-b.js")');
      expect(result.code).not.toContain('import(');
    });

    it('should not modify code without chunk references', () => {
      const code = `var x = 1; console.log(x);`;
      const result = callRenderChunk(code);
      expect(result).toBeNull();
    });

    it('should handle import() with whitespace', () => {
      const code = `var mod = import(  "./chunk-ws.js"  );`;
      const result = callRenderChunk(code);
      expect(result.code).toContain('__bungae_loadChunk("chunk-ws.js")');
    });
  });

  describe('static import replacement', () => {
    it('should replace static import from chunk with registry read', () => {
      const code = `import { t as __esmMin } from "./chunk-abc123.js";\nvar x = __esmMin;`;
      const result = callRenderChunk(code);
      expect(result.code).toContain('__bungae_loadChunkSync("chunk-abc123.js").t');
      expect(result.code).toContain('var __esmMin');
      expect(result.code).not.toContain('import {');
    });

    it('should handle multiple imports from a chunk', () => {
      const code = `import { a, b as localB } from "./shared-xyz.js";`;
      const result = callRenderChunk(code);
      expect(result.code).toContain('__bungae_loadChunkSync("shared-xyz.js").a');
      expect(result.code).toContain('__bungae_loadChunkSync("shared-xyz.js").b');
      expect(result.code).toContain('var a');
      expect(result.code).toContain('var localB');
    });
  });

  describe('export handling', () => {
    it('should remove exports from entry chunk', () => {
      const code = `var greeting = "hello";\nexport { greeting as default };`;
      const result = callRenderChunk(code, { isEntry: true });
      expect(result.code).not.toContain('export');
      expect(result.code).toContain('var greeting');
    });

    it('should replace exports in non-entry chunk with registry writes', () => {
      const code = `var __esmMin = function() {};\nexport { __esmMin as t };`;
      const result = callRenderChunk(code, {
        isEntry: false,
        fileName: 'chunk-abc123.js',
      });
      expect(result.code).not.toContain('export {');
      expect(result.code).toContain('__bungae_chunks["chunk-abc123.js"]');
      expect(result.code).toContain('t: __esmMin');
    });

    it('should handle multiple exports in non-entry chunk', () => {
      const code = `var a = 1;\nvar b = 2;\nexport { a, b as B };`;
      const result = callRenderChunk(code, {
        isEntry: false,
        fileName: 'chunk-multi.js',
      });
      expect(result.code).toContain('a: a');
      expect(result.code).toContain('B: b');
      expect(result.code).toContain('__bungae_chunks["chunk-multi.js"]');
    });
  });
});

describe('chunkLoaderPlugin generateBundle', () => {
  const plugin = chunkLoaderPlugin({ host: 'localhost', port: 8081, dev: true });

  function callGenerateBundle(bundle: Record<string, any>) {
    const hook = plugin.generateBundle as {
      handler: (options: any, bundle: any) => void;
    };
    hook.handler({}, bundle);
  }

  it('should inline shared chunks into entry chunk', () => {
    const marker = '/* __BUNGAE_SHARED_CHUNKS__ */';
    const bundle: Record<string, any> = {
      'index.js': {
        type: 'chunk',
        isEntry: true,
        isDynamicEntry: false,
        fileName: 'index.js',
        code: `prelude\n${marker}\n(function() { entry code }).call(globalThis);`,
      },
      'chunk-shared.js': {
        type: 'chunk',
        isEntry: false,
        isDynamicEntry: false,
        fileName: 'chunk-shared.js',
        code: '(function() { shared code }).call(globalThis);',
      },
      'lazy.js': {
        type: 'chunk',
        isEntry: false,
        isDynamicEntry: true,
        fileName: 'lazy.js',
        code: '(function() { lazy code }).call(globalThis);',
      },
    };

    callGenerateBundle(bundle);

    // Shared chunk should be inlined into entry
    expect(bundle['index.js'].code).toContain('shared code');
    // Shared chunk should be removed from output
    expect(bundle['chunk-shared.js']).toBeUndefined();
    // Dynamic chunk should remain
    expect(bundle['lazy.js']).toBeDefined();
  });

  it('should not modify bundle without shared chunks', () => {
    const marker = '/* __BUNGAE_SHARED_CHUNKS__ */';
    const bundle: Record<string, any> = {
      'index.js': {
        type: 'chunk',
        isEntry: true,
        isDynamicEntry: false,
        fileName: 'index.js',
        code: `prelude\n${marker}\n(function() { entry code }).call(globalThis);`,
      },
      'lazy.js': {
        type: 'chunk',
        isEntry: false,
        isDynamicEntry: true,
        fileName: 'lazy.js',
        code: '(function() { lazy code }).call(globalThis);',
      },
    };

    const originalEntryCode = bundle['index.js'].code;
    callGenerateBundle(bundle);

    // Entry should be unchanged (no shared chunks to inline)
    expect(bundle['index.js'].code).toBe(originalEntryCode);
    expect(bundle['lazy.js']).toBeDefined();
  });
});

describe('generateChunkLoaderRuntime', () => {
  it('should generate runtime with dev server URL', () => {
    const runtime = generateChunkLoaderRuntime({
      host: 'localhost',
      port: 8081,
      dev: true,
    });

    expect(runtime).toContain('__bungae_loadChunk');
    expect(runtime).toContain('__bungae_loadChunkSync');
    expect(runtime).toContain('__bungae_chunks');
    expect(runtime).toContain('fetch');
    expect(runtime).toContain('globalEvalWithSourceUrl');
    expect(runtime).toContain('8081');
  });

  it('should use empty base URL for production', () => {
    const runtime = generateChunkLoaderRuntime({
      host: 'localhost',
      port: 8081,
      dev: false,
    });

    expect(runtime).toContain('__bungae_loadChunk');
    expect(runtime).toContain('_baseUrl = ""');
  });

  it('should use default values', () => {
    const runtime = generateChunkLoaderRuntime({});

    expect(runtime).toContain('__bungae_loadChunk');
    expect(runtime).toContain('8081');
  });
});
