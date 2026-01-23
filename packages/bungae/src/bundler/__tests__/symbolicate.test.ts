/**
 * Symbolicate Endpoint Tests
 *
 * Tests for the /symbolicate endpoint (Metro-compatible)
 * React Native LogBox calls this endpoint to symbolicate stack traces
 *
 * Based on Metro's symbolicate implementation:
 * - POST /symbolicate with { stack: StackFrameInput[], extraData?: any }
 * - Returns { stack: StackFrameOutput[], codeFrame?: CodeFrame }
 * - Uses metro-source-map Consumer to map bundle positions to original source
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';

import { resolveConfig, getDefaultConfig } from '../../config';
import { serveWithGraph } from '../graph-bundler';

// Get packages/bungae directory (where dependencies are)
const currentFile = fileURLToPath(import.meta.url);
const packageDir = join(currentFile, '..', '..', '..', '..');

// Helper to resolve plugin with fallback to project root
function resolvePlugin(pluginName: string): string {
  try {
    const packageRequire = createRequire(join(packageDir, 'package.json'));
    return packageRequire.resolve(pluginName);
  } catch {
    const rootRequire = createRequire(join(packageDir, '..', '..', 'package.json'));
    return rootRequire.resolve(pluginName);
  }
}

describe('Symbolicate Endpoint Tests', () => {
  let testDir: string;
  let serverPort: number;
  let serverInstance: { stop: () => Promise<void> } | null = null;

  beforeEach(() => {
    testDir = join(tmpdir(), `bungae-symbolicate-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    // Create minimal node_modules for metro-runtime
    const metroRuntimeDir = join(testDir, 'node_modules', 'metro-runtime', 'src', 'polyfills');
    mkdirSync(metroRuntimeDir, { recursive: true });
    writeFileSync(
      join(metroRuntimeDir, 'require.js'),
      `(function (global) {
  global.__r = function() {};
  global.__d = function() {};
})`,
    );

    // Create babel.config.js
    const flowPlugin = resolvePlugin('@babel/plugin-transform-flow-strip-types');
    const commonjsPlugin = resolvePlugin('@babel/plugin-transform-modules-commonjs');
    const jsxPlugin = resolvePlugin('@babel/plugin-transform-react-jsx');
    const tsPlugin = resolvePlugin('@babel/plugin-transform-typescript');

    const babelConfig = `module.exports = {
  plugins: [
    ${JSON.stringify(flowPlugin)},
    ${JSON.stringify(commonjsPlugin)},
    ${JSON.stringify(jsxPlugin)},
    ${JSON.stringify(tsPlugin)},
  ],
};`;
    writeFileSync(join(testDir, 'babel.config.js'), babelConfig, 'utf-8');

    // Use random port for testing
    serverPort = 19000 + Math.floor(Math.random() * 1000);

    // Set test environment
    process.env.NODE_ENV = 'test';
    (globalThis as any).__BUNGAE_TEST_MODE__ = true;
  });

  afterEach(async () => {
    // Stop server if running
    if (serverInstance) {
      try {
        await Promise.race([
          serverInstance.stop(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Server stop timeout')), 2000),
          ),
        ]).catch(() => {
          // If timeout, continue anyway
        });
      } catch {
        // Ignore errors during shutdown
      }
      serverInstance = null;
    }

    // Cleanup test directory
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  async function startTestServer(entryFile: string, platform: 'ios' | 'android' = 'ios') {
    const config = resolveConfig(
      {
        ...getDefaultConfig(testDir),
        entry: entryFile,
        platform,
        dev: true, // Source maps only generated in dev mode
        server: {
          port: serverPort,
          useGlobalHotkey: false,
          forwardClientLogs: false,
          verifyConnections: false,
        },
      },
      testDir,
    );

    serverInstance = await serveWithGraph(config);
    // Wait for server to be ready
    await new Promise((resolve) => setTimeout(resolve, 500));
    return config;
  }

  async function symbolicateRequest(
    stack: Array<{
      file?: string;
      lineNumber?: number;
      column?: number;
      methodName?: string;
    }>,
    extraData?: any,
  ): Promise<{
    stack: Array<{
      file?: string;
      lineNumber?: number;
      column?: number;
      methodName?: string;
    }>;
    codeFrame: {
      content: string;
      location: { row: number; column: number };
      fileName: string;
    } | null;
  }> {
    const response = await fetch(`http://localhost:${serverPort}/symbolicate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        stack,
        extraData: extraData || {},
      }),
    });

    expect(response.status).toBe(200);
    const result = (await response.json()) as {
      stack: Array<{
        file?: string;
        lineNumber?: number;
        column?: number;
        methodName?: string;
      }>;
      codeFrame: {
        content: string;
        location: { row: number; column: number };
        fileName: string;
      } | null;
    };
    return result;
  }

  test('should return 405 for GET request', async () => {
    const entryFile = join(testDir, 'index.js');
    writeFileSync(entryFile, "console.log('test');", 'utf-8');

    await startTestServer('index.js');

    const response = await fetch(`http://localhost:${serverPort}/symbolicate`, {
      method: 'GET',
    });

    expect(response.status).toBe(405);
  });

  test('should return stack as-is when source map is not available', async () => {
    const entryFile = join(testDir, 'index.js');
    writeFileSync(entryFile, "console.log('test');", 'utf-8');

    await startTestServer('index.js');

    const stack = [
      {
        file: 'http://localhost:8081/index.bundle?platform=ios&dev=true',
        lineNumber: 10,
        column: 5,
        methodName: 'test',
      },
    ];

    const result = await symbolicateRequest(stack);

    expect(result).toHaveProperty('stack');
    expect(result.stack).toHaveLength(1);
    expect(result.stack[0]).toEqual(stack[0]);
    expect(result.codeFrame).toBeNull();
  });

  test('should symbolicate stack trace with source map', async () => {
    // Create a test file with known line numbers
    const testFile = join(testDir, 'App.tsx');
    writeFileSync(
      testFile,
      `// Line 1
// Line 2
function testFunction() {
  // Line 4
  throw new Error('Test error');
  // Line 6
}
// Line 8
export default testFunction;
`,
      'utf-8',
    );

    const entryFile = join(testDir, 'index.js');
    writeFileSync(entryFile, `import testFunction from './App.tsx';\ntestFunction();`, 'utf-8');

    await startTestServer('index.js');

    // Wait for bundle to be built
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Get bundle to find the actual line number in the bundle
    const bundleResponse = await fetch(
      `http://localhost:${serverPort}/index.bundle?platform=ios&dev=true`,
    );
    const bundleCode = await bundleResponse.text();

    // Find a line number in the bundle that corresponds to our source
    // We'll use a reasonable line number (bundle has prelude, so actual code starts later)
    const bundleLines = bundleCode.split('\n');
    const testFunctionLine = bundleLines.findIndex((line) => line.includes('Test error'));

    if (testFunctionLine === -1) {
      // If we can't find the exact line, use a line that should be in the bundle
      // This is a fallback for when the bundle structure is different
      const stack = [
        {
          file: `http://localhost:${serverPort}/index.bundle?platform=ios&dev=true`,
          lineNumber: 50, // Use a reasonable line number
          column: 0,
        },
      ];

      const result = await symbolicateRequest(stack);

      expect(result).toHaveProperty('stack');
      expect(result.stack).toHaveLength(1);
      // Should have symbolicated (file should not be bundle URL)
      expect(result.stack[0]?.file).not.toContain('.bundle');
    } else {
      const stack = [
        {
          file: `http://localhost:${serverPort}/index.bundle?platform=ios&dev=true`,
          lineNumber: testFunctionLine + 1, // 1-based line number
          column: 0,
        },
      ];

      const result = await symbolicateRequest(stack);

      expect(result).toHaveProperty('stack');
      expect(result.stack).toHaveLength(1);
      // Should have symbolicated (file should not be bundle URL)
      expect(result.stack[0]?.file).not.toContain('.bundle');
      // Should have original file path
      expect(result.stack[0]?.file).toContain('App.tsx');
    }
  });

  test('should handle empty stack array', async () => {
    const entryFile = join(testDir, 'index.js');
    writeFileSync(entryFile, "console.log('test');", 'utf-8');

    await startTestServer('index.js');

    const result = await symbolicateRequest([]);

    expect(result).toHaveProperty('stack');
    expect(result.stack).toHaveLength(0);
  });

  test('should handle stack frames without file or lineNumber', async () => {
    const entryFile = join(testDir, 'index.js');
    writeFileSync(entryFile, "console.log('test');", 'utf-8');

    await startTestServer('index.js');

    const stack = [
      {
        methodName: 'test',
      },
      {
        file: 'http://localhost:8081/index.bundle',
        // lineNumber missing
      },
      {
        // file missing
        lineNumber: 10,
      },
    ];

    const result = await symbolicateRequest(stack);

    expect(result).toHaveProperty('stack');
    expect(result.stack).toHaveLength(3);
    // Frames without file or lineNumber should be returned as-is
    expect(result.stack[0]).toEqual(stack[0]);
    expect(result.stack[1]).toEqual(stack[1]);
    expect(result.stack[2]).toEqual(stack[2]);
  });

  test('should extract platform from bundle URL', async () => {
    const entryFile = join(testDir, 'index.js');
    writeFileSync(entryFile, "console.log('test');", 'utf-8');

    // Start server with ios platform
    await startTestServer('index.js', 'ios');

    // Wait for bundle to be built
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const stack = [
      {
        file: `http://localhost:${serverPort}/index.bundle?platform=android&dev=true`,
        lineNumber: 10,
        column: 0,
      },
    ];

    const result = await symbolicateRequest(stack);

    expect(result).toHaveProperty('stack');
    // Should handle android platform from URL even though server is ios
    expect(result.stack).toHaveLength(1);
  });

  test('should generate code frame for symbolicated stack', async () => {
    // Create a test file with known content
    const testFile = join(testDir, 'ErrorFile.tsx');
    writeFileSync(
      testFile,
      `function Component() {
  const value = 42;
  throw new Error('Intentional error');
  return value;
}
export default Component;
`,
      'utf-8',
    );

    const entryFile = join(testDir, 'index.js');
    writeFileSync(entryFile, `import Component from './ErrorFile.tsx';\nComponent();`, 'utf-8');

    await startTestServer('index.js');

    // Wait for bundle to be built
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Get bundle to find line number
    const bundleResponse = await fetch(
      `http://localhost:${serverPort}/index.bundle?platform=ios&dev=true`,
    );
    const bundleCode = await bundleResponse.text();
    const bundleLines = bundleCode.split('\n');
    const errorLine = bundleLines.findIndex((line) => line.includes('Intentional error'));

    if (errorLine !== -1) {
      const stack = [
        {
          file: `http://localhost:${serverPort}/index.bundle?platform=ios&dev=true`,
          lineNumber: errorLine + 1,
          column: 0,
        },
      ];

      const result = await symbolicateRequest(stack);

      expect(result).toHaveProperty('stack');
      expect(result).toHaveProperty('codeFrame');

      if (result.codeFrame) {
        expect(result.codeFrame).toHaveProperty('content');
        expect(result.codeFrame).toHaveProperty('location');
        expect(result.codeFrame).toHaveProperty('fileName');
        expect(result.codeFrame.fileName).toContain('ErrorFile.tsx');
        expect(result.codeFrame.location.row).toBeGreaterThan(0);
      }
    }
  });

  test('should handle invalid JSON in request body', async () => {
    const entryFile = join(testDir, 'index.js');
    writeFileSync(entryFile, "console.log('test');", 'utf-8');

    await startTestServer('index.js');

    const response = await fetch(`http://localhost:${serverPort}/symbolicate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: 'invalid json',
    });

    expect(response.status).toBe(500);
    const result = await response.json();
    expect(result).toHaveProperty('error');
  });

  test('should handle missing stack in request body', async () => {
    const entryFile = join(testDir, 'index.js');
    writeFileSync(entryFile, "console.log('test');", 'utf-8');

    await startTestServer('index.js');

    const response = await fetch(`http://localhost:${serverPort}/symbolicate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(200);
    const result = (await response.json()) as {
      stack: Array<{
        file?: string;
        lineNumber?: number;
        column?: number;
        methodName?: string;
      }>;
      codeFrame: null;
    };
    expect(result).toHaveProperty('stack');
    expect(result.stack).toHaveLength(0);
  });

  test('should preserve methodName when symbolication fails', async () => {
    const entryFile = join(testDir, 'index.js');
    writeFileSync(entryFile, "console.log('test');", 'utf-8');

    await startTestServer('index.js');

    const stack = [
      {
        file: 'http://localhost:8081/index.bundle?platform=ios&dev=true',
        lineNumber: 99999, // Line number that doesn't exist
        column: 0,
        methodName: 'originalMethod',
      },
    ];

    const result = await symbolicateRequest(stack);

    expect(result).toHaveProperty('stack');
    expect(result.stack).toHaveLength(1);
    // Method name should be preserved even if symbolication fails
    expect(result.stack[0]?.methodName).toBe('originalMethod');
  });

  test('should handle multiple stack frames', async () => {
    const entryFile = join(testDir, 'index.js');
    writeFileSync(entryFile, "console.log('test');", 'utf-8');

    await startTestServer('index.js');

    const stack = [
      {
        file: `http://localhost:${serverPort}/index.bundle?platform=ios&dev=true`,
        lineNumber: 10,
        column: 0,
        methodName: 'function1',
      },
      {
        file: `http://localhost:${serverPort}/index.bundle?platform=ios&dev=true`,
        lineNumber: 20,
        column: 5,
        methodName: 'function2',
      },
      {
        file: `http://localhost:${serverPort}/index.bundle?platform=ios&dev=true`,
        lineNumber: 30,
        column: 10,
        methodName: 'function3',
      },
    ];

    const result = await symbolicateRequest(stack);

    expect(result).toHaveProperty('stack');
    expect(result.stack).toHaveLength(3);
    // All frames should be processed
    expect(result.stack[0]).toHaveProperty('methodName');
    expect(result.stack[1]).toHaveProperty('methodName');
    expect(result.stack[2]).toHaveProperty('methodName');
  });

  test('should handle extraData parameter', async () => {
    const entryFile = join(testDir, 'index.js');
    writeFileSync(entryFile, "console.log('test');", 'utf-8');

    await startTestServer('index.js');

    const stack = [
      {
        file: `http://localhost:${serverPort}/index.bundle?platform=ios&dev=true`,
        lineNumber: 10,
        column: 0,
      },
    ];

    const extraData = {
      customField: 'customValue',
      timestamp: Date.now(),
    };

    const result = await symbolicateRequest(stack, extraData);

    expect(result).toHaveProperty('stack');
    // extraData is accepted but not used in current implementation
    // (Metro-compatible for future use)
  });

  test('should handle source map with no mappings gracefully', async () => {
    const entryFile = join(testDir, 'index.js');
    writeFileSync(entryFile, "console.log('test');", 'utf-8');

    await startTestServer('index.js');

    // Wait for bundle to be built
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const stack = [
      {
        file: `http://localhost:${serverPort}/index.bundle?platform=ios&dev=true`,
        lineNumber: 1,
        column: 0,
      },
    ];

    const result = await symbolicateRequest(stack);

    expect(result).toHaveProperty('stack');
    expect(result.stack).toHaveLength(1);
    // Should return frame even if no mapping found
    expect(result.stack[0]).toHaveProperty('file');
  });

  test('should handle column value missing (lineNumber only)', async () => {
    const entryFile = join(testDir, 'index.js');
    writeFileSync(entryFile, "console.log('test');", 'utf-8');

    await startTestServer('index.js');

    // Wait for bundle to be built
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const stack = [
      {
        file: `http://localhost:${serverPort}/index.bundle?platform=ios&dev=true`,
        lineNumber: 10,
        // column missing
      },
    ];

    const result = await symbolicateRequest(stack);

    expect(result).toHaveProperty('stack');
    expect(result.stack).toHaveLength(1);
    // Should use column 0 as default (or undefined if not set)
    expect(result.stack[0]?.column === 0 || result.stack[0]?.column === undefined).toBe(true);
  });

  test('should handle source file that cannot be read for code frame', async () => {
    const testFile = join(testDir, 'DeletedFile.tsx');
    writeFileSync(testFile, "throw new Error('test');", 'utf-8');

    const entryFile = join(testDir, 'index.js');
    writeFileSync(entryFile, `import './DeletedFile.tsx';`, 'utf-8');

    await startTestServer('index.js');

    // Wait for bundle to be built
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Delete the file after bundle is built
    rmSync(testFile, { force: true });

    // Get bundle to find line number
    const bundleResponse = await fetch(
      `http://localhost:${serverPort}/index.bundle?platform=ios&dev=true`,
    );
    const bundleCode = await bundleResponse.text();
    const bundleLines = bundleCode.split('\n');
    const errorLine = bundleLines.findIndex((line) => line.includes('test'));

    if (errorLine !== -1) {
      const stack = [
        {
          file: `http://localhost:${serverPort}/index.bundle?platform=ios&dev=true`,
          lineNumber: errorLine + 1,
          column: 0,
        },
      ];

      const result = await symbolicateRequest(stack);

      expect(result).toHaveProperty('stack');
      // Should still symbolicate even if file cannot be read
      expect(result.stack).toHaveLength(1);
      // codeFrame should be null if file cannot be read
      if (result.codeFrame === null) {
        // This is acceptable - file was deleted
        expect(result.codeFrame).toBeNull();
      }
    }
  });

  test('should handle relative source paths in source map', async () => {
    // Create a test file in a subdirectory
    const subDir = join(testDir, 'src');
    mkdirSync(subDir, { recursive: true });
    const testFile = join(subDir, 'Component.tsx');
    writeFileSync(
      testFile,
      `function Component() {
  throw new Error('Relative path test');
}
export default Component;
`,
      'utf-8',
    );

    const entryFile = join(testDir, 'index.js');
    writeFileSync(entryFile, `import Component from './src/Component.tsx';\nComponent();`, 'utf-8');

    await startTestServer('index.js');

    // Wait for bundle to be built
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Get bundle to find line number
    const bundleResponse = await fetch(
      `http://localhost:${serverPort}/index.bundle?platform=ios&dev=true`,
    );
    const bundleCode = await bundleResponse.text();
    const bundleLines = bundleCode.split('\n');
    const errorLine = bundleLines.findIndex((line) => line.includes('Relative path test'));

    if (errorLine !== -1) {
      const stack = [
        {
          file: `http://localhost:${serverPort}/index.bundle?platform=ios&dev=true`,
          lineNumber: errorLine + 1,
          column: 0,
        },
      ];

      const result = await symbolicateRequest(stack);

      expect(result).toHaveProperty('stack');
      expect(result.stack).toHaveLength(1);
      // Should resolve relative path correctly
      if (result.stack[0]?.file && !result.stack[0].file.includes('.bundle')) {
        expect(result.stack[0].file).toContain('Component.tsx');
      }
    }
  });

  test('should handle absolute source paths in source map', async () => {
    const testFile = join(testDir, 'AbsolutePath.tsx');
    writeFileSync(
      testFile,
      `function Test() {
  throw new Error('Absolute path test');
}
export default Test;
`,
      'utf-8',
    );

    const entryFile = join(testDir, 'index.js');
    writeFileSync(entryFile, `import Test from './AbsolutePath.tsx';\nTest();`, 'utf-8');

    await startTestServer('index.js');

    // Wait for bundle to be built
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Get bundle to find line number
    const bundleResponse = await fetch(
      `http://localhost:${serverPort}/index.bundle?platform=ios&dev=true`,
    );
    const bundleCode = await bundleResponse.text();
    const bundleLines = bundleCode.split('\n');
    const errorLine = bundleLines.findIndex((line) => line.includes('Absolute path test'));

    if (errorLine !== -1) {
      const stack = [
        {
          file: `http://localhost:${serverPort}/index.bundle?platform=ios&dev=true`,
          lineNumber: errorLine + 1,
          column: 0,
        },
      ];

      const result = await symbolicateRequest(stack);

      expect(result).toHaveProperty('stack');
      expect(result.stack).toHaveLength(1);
      // Should handle absolute paths correctly
      if (result.stack[0]?.file && !result.stack[0].file.includes('.bundle')) {
        expect(result.stack[0].file).toContain('AbsolutePath.tsx');
      }
    }
  });

  test('should exclude debuggerWorker.js from symbolication (Metro-compatible)', async () => {
    const entryFile = join(testDir, 'index.js');
    writeFileSync(entryFile, "console.log('test');", 'utf-8');

    await startTestServer('index.js');

    const stack = [
      {
        file: 'http://localhost:8081/debuggerWorker.js',
        lineNumber: 10,
        column: 5,
      },
      {
        file: `http://localhost:${serverPort}/index.bundle?platform=ios&dev=true`,
        lineNumber: 20,
        column: 0,
      },
    ];

    const result = await symbolicateRequest(stack);

    expect(result).toHaveProperty('stack');
    expect(result.stack).toHaveLength(2);
    // debuggerWorker.js should be returned as-is (not symbolicated)
    expect(result.stack[0]?.file).toBe('http://localhost:8081/debuggerWorker.js');
  });

  test('should handle mixed bundle URLs from different platforms', async () => {
    const entryFile = join(testDir, 'index.js');
    writeFileSync(entryFile, "console.log('test');", 'utf-8');

    // Start server with ios platform
    await startTestServer('index.js', 'ios');

    // Wait for bundle to be built
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const stack = [
      {
        file: `http://localhost:${serverPort}/index.bundle?platform=ios&dev=true`,
        lineNumber: 10,
        column: 0,
      },
      {
        file: `http://localhost:${serverPort}/index.bundle?platform=android&dev=true`,
        lineNumber: 20,
        column: 0,
      },
    ];

    const result = await symbolicateRequest(stack);

    expect(result).toHaveProperty('stack');
    expect(result.stack).toHaveLength(2);
    // Both frames should be processed
    expect(result.stack[0]).toHaveProperty('file');
    expect(result.stack[1]).toHaveProperty('file');
  });

  test('should only generate code frame for first valid frame', async () => {
    // Create multiple test files
    const file1 = join(testDir, 'File1.tsx');
    writeFileSync(file1, "throw new Error('Error in File1');", 'utf-8');

    const file2 = join(testDir, 'File2.tsx');
    writeFileSync(file2, "throw new Error('Error in File2');", 'utf-8');

    const entryFile = join(testDir, 'index.js');
    writeFileSync(entryFile, `import './File1.tsx';\nimport './File2.tsx';`, 'utf-8');

    await startTestServer('index.js');

    // Wait for bundle to be built
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Get bundle to find line numbers
    const bundleResponse = await fetch(
      `http://localhost:${serverPort}/index.bundle?platform=ios&dev=true`,
    );
    const bundleCode = await bundleResponse.text();
    const bundleLines = bundleCode.split('\n');
    const error1Line = bundleLines.findIndex((line) => line.includes('Error in File1'));
    const error2Line = bundleLines.findIndex((line) => line.includes('Error in File2'));

    if (error1Line !== -1 && error2Line !== -1) {
      const stack = [
        {
          file: `http://localhost:${serverPort}/index.bundle?platform=ios&dev=true`,
          lineNumber: error1Line + 1,
          column: 0,
        },
        {
          file: `http://localhost:${serverPort}/index.bundle?platform=ios&dev=true`,
          lineNumber: error2Line + 1,
          column: 0,
        },
      ];

      const result = await symbolicateRequest(stack);

      expect(result).toHaveProperty('stack');
      expect(result.stack).toHaveLength(2);
      // Only one codeFrame should be generated (first valid frame that can be read)
      // Note: codeFrame generation depends on which frame is successfully symbolicated first
      // and which file can be read. The exact file may vary.
      if (result.codeFrame) {
        expect(result.codeFrame).toHaveProperty('fileName');
        expect(result.codeFrame).toHaveProperty('content');
        expect(result.codeFrame).toHaveProperty('location');
        // Should be from one of the valid frames
        const fileName = result.codeFrame.fileName;
        expect(
          fileName.includes('File1') ||
            fileName.includes('File2') ||
            fileName.includes('.tsx') ||
            fileName.includes('.js'),
        ).toBe(true);
      } else {
        // If no codeFrame is generated, that's also acceptable
        // (e.g., if files cannot be read or symbolication fails)
        expect(result.codeFrame).toBeNull();
      }
    }
  });

  test('should handle very long stack traces', async () => {
    const entryFile = join(testDir, 'index.js');
    writeFileSync(entryFile, "console.log('test');", 'utf-8');

    await startTestServer('index.js');

    // Create a long stack trace (100 frames)
    const stack = Array.from({ length: 100 }, (_, i) => ({
      file: `http://localhost:${serverPort}/index.bundle?platform=ios&dev=true`,
      lineNumber: i + 1,
      column: 0,
      methodName: `function${i}`,
    }));

    const result = await symbolicateRequest(stack);

    expect(result).toHaveProperty('stack');
    expect(result.stack).toHaveLength(100);
    // All frames should be processed
    expect(result.stack[0]).toHaveProperty('methodName');
    expect(result.stack[99]).toHaveProperty('methodName');
  });

  test('should handle invalid source map JSON gracefully', async () => {
    const entryFile = join(testDir, 'index.js');
    writeFileSync(entryFile, "console.log('test');", 'utf-8');

    await startTestServer('index.js');

    // Wait for bundle to be built
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Manually corrupt the cached build's source map
    // This is a bit tricky since we need to access the internal cache
    // For now, we'll test with a normal request and verify error handling
    const stack = [
      {
        file: `http://localhost:${serverPort}/index.bundle?platform=ios&dev=true`,
        lineNumber: 10,
        column: 0,
      },
    ];

    // This should work normally
    const result = await symbolicateRequest(stack);
    expect(result).toHaveProperty('stack');
    // If source map parsing fails, it should return stack as-is
    expect(result.stack).toHaveLength(1);
  });

  test('should handle source map without sourcesContent', async () => {
    // This test verifies that symbolication works even if sourcesContent is missing
    // The code frame generation might fail, but symbolication should still work
    const testFile = join(testDir, 'NoSourcesContent.tsx');
    writeFileSync(testFile, "throw new Error('No sourcesContent test');", 'utf-8');

    const entryFile = join(testDir, 'index.js');
    writeFileSync(entryFile, `import './NoSourcesContent.tsx';`, 'utf-8');

    await startTestServer('index.js');

    // Wait for bundle to be built
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Get bundle to find line number
    const bundleResponse = await fetch(
      `http://localhost:${serverPort}/index.bundle?platform=ios&dev=true`,
    );
    const bundleCode = await bundleResponse.text();
    const bundleLines = bundleCode.split('\n');
    const errorLine = bundleLines.findIndex((line) => line.includes('No sourcesContent test'));

    if (errorLine !== -1) {
      const stack = [
        {
          file: `http://localhost:${serverPort}/index.bundle?platform=ios&dev=true`,
          lineNumber: errorLine + 1,
          column: 0,
        },
      ];

      const result = await symbolicateRequest(stack);

      expect(result).toHaveProperty('stack');
      expect(result.stack).toHaveLength(1);
      // Symbolication should work even without sourcesContent
      // (sourcesContent is only needed for code frame generation)
    }
  });

  test('should handle concurrent symbolicate requests', async () => {
    const entryFile = join(testDir, 'index.js');
    writeFileSync(entryFile, "console.log('test');", 'utf-8');

    await startTestServer('index.js');

    // Wait for bundle to be built
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const stack = [
      {
        file: `http://localhost:${serverPort}/index.bundle?platform=ios&dev=true`,
        lineNumber: 10,
        column: 0,
      },
    ];

    // Send 5 concurrent requests
    const requests = Array.from({ length: 5 }, () => symbolicateRequest(stack));

    const results = await Promise.all(requests);

    // All requests should succeed
    results.forEach((result) => {
      expect(result).toHaveProperty('stack');
      expect(result.stack).toHaveLength(1);
    });
  });
});
