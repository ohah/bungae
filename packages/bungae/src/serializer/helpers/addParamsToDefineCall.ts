/**
 * Add parameters to __d() call
 * Based on metro-transform-plugins/addParamsToDefineCall
 */

/**
 * Add additional parameters to the end of __d() calls
 * @param code - Module code (will be wrapped in function if not already wrapped)
 * @param globalPrefix - Global prefix for __d (e.g., '__BUNGAE__' or '')
 * @param paramsToAdd - Additional parameters to add (moduleId, dependencies, etc.)
 */
export function addParamsToDefineCall(
  code: string,
  globalPrefix: string = '',
  ...paramsToAdd: Array<unknown>
): string {
  const defineFn = globalPrefix ? `${globalPrefix}__d` : '__d';
  const defineCall = `${defineFn}(`;

  // Check if code already starts with __d( or __BUNGAE____d(
  if (code.trim().startsWith(defineCall) || code.trim().startsWith('__d(')) {
    // Code already has __d(), just add parameters before the closing paren
    const index = code.lastIndexOf(')');
    if (index === -1) {
      // No closing paren found, append at the end
      const params = paramsToAdd.map((param) =>
        param !== undefined ? JSON.stringify(param) : 'undefined',
      );
      return code + (params.length > 0 ? ',' + params.join(',') : '') + ');';
    }

    const params = paramsToAdd.map((param) =>
      param !== undefined ? JSON.stringify(param) : 'undefined',
    );

    return code.slice(0, index) + ',' + params.join(',') + code.slice(index);
  }

  // Code doesn't have __d(), wrap it in a function
  // Metro's FactoryFn signature: function(global, require, metroImportDefault, metroImportAll, moduleObject, exports, dependencyMap)
  // Metro's transformer converts CommonJS modules and wraps them in this signature
  // But the actual code inside uses: require, module, exports
  // Metro's factory call passes: (global, metroRequire, metroImportDefault, metroImportAll, moduleObject, exports, dependencyMap)
  // So we need to map: require = metroRequire (2nd param), module = moduleObject (5th param), exports = exports (6th param)
  const params = paramsToAdd.map((param) =>
    param !== undefined ? JSON.stringify(param) : 'undefined',
  );

  // Wrap code in a function expression matching Metro's FactoryFn signature
  // Metro format: function(global, _$$_REQUIRE, _$$_IMPORT_DEFAULT, _$$_IMPORT_ALL, module, exports, _dependencyMap) { ... }
  // But our transformer doesn't rename variables, so we use: function(global, require, metroImportDefault, metroImportAll, module, exports, dependencyMap) { ... }
  // The code inside uses: require, module, exports (which map to params 2, 5, 6)
  const wrappedCode = `function(global, require, metroImportDefault, metroImportAll, module, exports, dependencyMap) { ${code} }`;

  return `${defineCall}${wrappedCode}${params.length > 0 ? ',' + params.join(',') : ''});`;
}
