/**
 * Copyright (c) 2026 ohah
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { runInNewContext, isContext, runInContext, createContext } from 'vm';

/**
 * Execute bundle code in a new context
 * Identical to Metro's execBundle implementation
 *
 * Metro's execBundle simply executes the bundle code as-is.
 * The bundle code includes metro-runtime which sets up global functions
 * (__r, __d, etc.) and executes the entry point, returning module.exports.
 */
export function execBundle(code: string, context: Record<string, unknown> = {}): unknown {
  if (isContext(context as any)) {
    return runInContext(code, context as any);
  }

  // Create a context with minimal globals
  // Bundle code includes metro-runtime which sets up everything needed
  // Metro uses __METRO_GLOBAL_PREFIX__ which defaults to empty string
  // The bundle code sets up global[`${__METRO_GLOBAL_PREFIX__}__d`] = define via metro-runtime
  // We need to ensure 'global' and 'globalThis' are available and point to the context
  const bundleContext = createContext({
    console,
    Date,
    JSON,
    Error,
    ...context,
  });

  // Set global and globalThis to point to the context (so global.xxx = yyy works)
  bundleContext.global = bundleContext as any;
  bundleContext.globalThis = bundleContext as any;

  return runInNewContext(code, bundleContext);
}
