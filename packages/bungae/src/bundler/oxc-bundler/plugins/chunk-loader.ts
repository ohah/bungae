/**
 * Chunk Loader Plugin for Rolldown
 *
 * Transforms Rolldown's ESM chunk output to work in React Native:
 *
 * 1. Replaces dynamic `import("./chunk-xxx.js")` with `__bungae_loadChunk("chunk-xxx.js")`
 * 2. Replaces static `import { x } from "./chunk-xxx.js"` with global chunk registry reads
 * 3. Replaces `export { x }` in non-entry chunks with global chunk registry writes
 * 4. Inlines shared (non-dynamic) chunks into the entry chunk via generateBundle
 *
 * This is necessary because React Native has no native ESM support.
 * Chunks communicate via `globalThis.__bungae_chunks` registry instead of ESM import/export.
 *
 * Chunks are loaded via:
 * - Dev: fetch() from dev server + globalEvalWithSourceUrl()
 * - Prod: read from local filesystem + globalEvalWithSourceUrl()
 */

import type { Plugin, RenderedChunk, OutputChunk } from 'rolldown';

export interface ChunkLoaderOptions {
  /** Dev server host (used for dev mode chunk fetching) */
  host?: string;
  /** Dev server port (used for dev mode chunk fetching) */
  port?: number;
  /** Whether this is a development build */
  dev?: boolean;
}

/**
 * Generate the __bungae_loadChunk runtime code.
 * This function is injected into the entry chunk's intro.
 */
export function generateChunkLoaderRuntime(options: ChunkLoaderOptions): string {
  const { host = 'localhost', port = 8081, dev = true } = options;

  return `
// Bungae chunk loader runtime
(function() {
  var _loaded = {};
  var _registry = globalThis.__bungae_chunks = globalThis.__bungae_chunks || {};
  var _baseUrl = ${dev ? `"http://${host}:" + ${port} + "/chunks/"` : '""'};

  globalThis.__bungae_loadChunk = function(chunkId) {
    if (_loaded[chunkId]) return _loaded[chunkId];

    _loaded[chunkId] = fetch(_baseUrl + chunkId)
      .then(function(r) {
        if (!r.ok) throw new Error("Failed to load chunk: " + chunkId + " (" + r.status + ")");
        return r.text();
      })
      .then(function(code) {
        globalThis.globalEvalWithSourceUrl
          ? globalThis.globalEvalWithSourceUrl(code, chunkId)
          : new Function(code)();
        return _registry[chunkId] || {};
      });

    return _loaded[chunkId];
  };

  globalThis.__bungae_loadChunkSync = function(chunkId) {
    var chunk = _registry[chunkId];
    if (!chunk) {
      console.warn("[bungae] Chunk not found in registry: " + chunkId);
      console.warn("[bungae] Available chunks:", Object.keys(_registry));
    }
    return chunk || {};
  };
})();
/* __BUNGAE_SHARED_CHUNKS__ */
`.trim();
}

/**
 * Transform ESM import/export in chunk code to use the global chunk registry.
 * Exported for testing.
 */
export function transformChunkCode(
  code: string,
  chunk: { isEntry: boolean; fileName: string },
): string {
  let result = code;

  // NOTE: Dynamic import() replacement is done in generateBundle (not here)
  // because renderChunk receives placeholder filenames (e.g., !~{000}~)
  // that haven't been resolved to actual chunk filenames yet.

  // 1. Replace static import from other chunks with registry reads
  result = result.replace(
    /import\s*\{([^}]+)\}\s*from\s*["']\.\/([^"']+)["']\s*;?/g,
    (_match, imports: string, chunkFile: string) => {
      const bindings = imports.split(',').map((s) => s.trim()).filter(Boolean);
      const declarations = bindings.map((binding) => {
        const parts = binding.split(/\s+as\s+/);
        const exportedName = parts[0].trim();
        const localName = (parts[1] || parts[0]).trim();
        return `var ${localName} = globalThis.__bungae_loadChunkSync("${chunkFile}").${exportedName};`;
      });
      return declarations.join('\n');
    },
  );

  // 3. Handle exports
  result = result.replace(
    /export\s*\{([^}]+)\}\s*;?/g,
    (_match, exports: string) => {
      const bindings = exports.split(',').map((s) => s.trim()).filter(Boolean);

      // For non-entry chunks, replace export with registry write (inside IIFE scope)
      if (!chunk.isEntry) {
        const props = bindings.map((binding) => {
          const parts = binding.split(/\s+as\s+/);
          const localName = parts[0].trim();
          const exportedName = (parts[1] || parts[0]).trim();
          return `${exportedName}: ${localName}`;
        }).join(', ');
        return `globalThis.__bungae_chunks = globalThis.__bungae_chunks || {};\nglobalThis.__bungae_chunks["${chunk.fileName}"] = { ${props} };`;
      }

      // For entry chunks, just remove the export
      return '';
    },
  );

  return result;
}

export function chunkLoaderPlugin(options: ChunkLoaderOptions = {}): Plugin {
  return {
    name: 'bungae:chunk-loader',

    renderChunk: {
      handler(code: string, chunk: RenderedChunk) {
        const result = transformChunkCode(code, chunk);

        if (result !== code) {
          return { code: result };
        }

        return null;
      },
    },

    generateBundle: {
      handler(_options, bundle) {
        // Find entry chunk and shared (non-dynamic, non-entry) chunks.
        // Shared chunks must be inlined into the entry chunk because they
        // are statically imported and must execute before the entry code.
        let entryChunk: OutputChunk | null = null;
        const sharedChunks: OutputChunk[] = [];
        const dynamicChunks: OutputChunk[] = [];

        for (const [_fileName, output] of Object.entries(bundle)) {
          if (output.type !== 'chunk') continue;
          if (output.isEntry) {
            entryChunk = output;
          } else if (output.isDynamicEntry) {
            dynamicChunks.push(output);
          } else {
            sharedChunks.push(output);
          }
        }

        // At generateBundle time, Rolldown has resolved all chunk filename
        // placeholders (e.g., !~{000}~ → actual hash). We must do the
        // dynamic import() replacement here, NOT in renderChunk, because
        // renderChunk receives placeholder filenames that don't match.
        //
        // Replace import("./lazy-hash.js") with __bungae_loadChunk("lazy-hash.js")
        // in ALL chunks. Only match .js files (Rolldown chunk output).
        for (const [_fileName, output] of Object.entries(bundle)) {
          if (output.type !== 'chunk') continue;
          output.code = output.code.replace(
            /import\(\s*["']\.\/([^"']+\.js)["']\s*\)/g,
            '__bungae_loadChunk("$1")',
          );
        }

        if (!entryChunk || sharedChunks.length === 0) return;

        // Inline shared chunks at the marker position in the entry chunk.
        // The marker /* __BUNGAE_SHARED_CHUNKS__ */ is placed after the chunk-loader
        // runtime and before the entry's IIFE, so shared chunks execute after the
        // registry is initialized but before any entry code reads from it.
        const sharedCode = sharedChunks
          .map((chunk) => `// [inlined shared chunk: ${chunk.fileName}]\n${chunk.code}`)
          .join('\n');

        const marker = '/* __BUNGAE_SHARED_CHUNKS__ */';
        const markerIndex = entryChunk.code.indexOf(marker);
        if (markerIndex >= 0) {
          entryChunk.code =
            entryChunk.code.slice(0, markerIndex) +
            sharedCode + '\n' +
            entryChunk.code.slice(markerIndex + marker.length);
        }

        // Remove shared chunks from the output (they're now inlined)
        for (const chunk of sharedChunks) {
          delete bundle[chunk.fileName];
        }
      },
    },
  };
}
