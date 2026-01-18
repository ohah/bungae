/**
 * Add parameters to __d() call
 * Based on metro-transform-plugins/addParamsToDefineCall
 */

/**
 * Add additional parameters to the end of __d() calls
 */
export function addParamsToDefineCall(code: string, ...paramsToAdd: Array<unknown>): string {
  // Check if code already starts with __d(
  if (code.trim().startsWith('__d(')) {
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

  // Code doesn't have __d(), wrap it
  const params = paramsToAdd.map((param) =>
    param !== undefined ? JSON.stringify(param) : 'undefined',
  );

  return `__d(${code}${params.length > 0 ? ',' + params.join(',') : ''});`;
}
