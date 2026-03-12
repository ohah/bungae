import { describe, expect, it } from 'bun:test';

import { reactRefreshPlugin } from '../../plugins/react-refresh';

describe('reactRefreshPlugin', () => {
  it('should return two plugins (transform + boundary)', () => {
    const plugins = reactRefreshPlugin();
    expect(plugins).toHaveLength(2);
    expect(plugins[0]!.name).toBe('bungae:transform-react-refresh');
    expect(plugins[1]!.name).toBe('bungae:react-refresh-boundary');
  });

  it('should have transform hooks on both plugins', () => {
    const [transformPlugin, boundaryPlugin] = reactRefreshPlugin();
    expect(transformPlugin!.transform).toBeDefined();
    expect(boundaryPlugin!.transform).toBeDefined();
  });

  it('should include .tsx/.ts/.jsx/.js files', () => {
    const [transformPlugin] = reactRefreshPlugin();
    const transform = transformPlugin!.transform as any;
    const filter = transform.filter;

    expect(filter.id).toBeDefined();
    expect(filter.id.include).toBeDefined();
    expect(filter.id.include.length).toBeGreaterThan(0);

    const includePattern = filter.id.include[0] as RegExp;
    expect(includePattern.test('App.tsx')).toBe(true);
    expect(includePattern.test('utils.ts')).toBe(true);
    expect(includePattern.test('Button.jsx')).toBe(true);
    expect(includePattern.test('main.js')).toBe(true);
  });

  it('should exclude node_modules', () => {
    const [transformPlugin] = reactRefreshPlugin();
    const transform = transformPlugin!.transform as any;
    const filter = transform.filter;

    const excludePattern = filter.id.exclude[0] as RegExp;
    expect(excludePattern.test('/node_modules/')).toBe(true);
    expect(excludePattern.test('/node_modules/react/index.js')).toBe(true);
    expect(excludePattern.test('/src/App.tsx')).toBe(false);
  });

  it('should not wrap non-React code in boundary plugin', () => {
    const [, boundaryPlugin] = reactRefreshPlugin();
    const transform = boundaryPlugin!.transform as any;

    // Plain code without $RefreshReg$ should return undefined (no transform)
    const code = 'const x = 1;\nexport default x;';
    const result = transform.handler.call({}, code, 'utils.ts');
    expect(result).toBeUndefined();
  });

  it('should wrap code with $RefreshReg$ in boundary plugin', () => {
    const [, boundaryPlugin] = reactRefreshPlugin();
    const transform = boundaryPlugin!.transform as any;

    const code = '$RefreshReg$(App, "App");\nexport default App;';
    const result = transform.handler.call({}, code, 'App.tsx');

    expect(result).toBeDefined();
    expect(result.code).toContain('__prev$RefreshReg$');
    expect(result.code).toContain('import.meta.hot');
    expect(result.code).toContain('import.meta.hot.accept');
    expect(result.code).toContain('isReactRefreshBoundary');
    expect(result.code).toContain('enqueueUpdate');
  });

  it('should include module ID in RefreshReg registration', () => {
    const [, boundaryPlugin] = reactRefreshPlugin();
    const transform = boundaryPlugin!.transform as any;

    const code = '$RefreshReg$(MyComponent, "MyComponent");';
    const result = transform.handler.call({}, code, '/src/MyComponent.tsx');

    expect(result.code).toContain(JSON.stringify('/src/MyComponent.tsx'));
  });

  it('should restore previous $RefreshReg$ after wrapper', () => {
    const [, boundaryPlugin] = reactRefreshPlugin();
    const transform = boundaryPlugin!.transform as any;

    const code = '$RefreshReg$(App, "App");';
    const result = transform.handler.call({}, code, 'App.tsx');

    // Should save and restore previous refs
    expect(result.code).toContain('var __prev$RefreshReg$ = globalThis.$RefreshReg$');
    expect(result.code).toContain('globalThis.$RefreshReg$ = __prev$RefreshReg$');
    expect(result.code).toContain('var __prev$RefreshSig$ = globalThis.$RefreshSig$');
    expect(result.code).toContain('globalThis.$RefreshSig$ = __prev$RefreshSig$');
  });
});
