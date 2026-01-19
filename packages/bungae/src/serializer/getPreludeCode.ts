/**
 * Get prelude code - Variable declarations
 */

// Reserved variable names that cannot be overridden (Metro-compatible)
const excluded = new Set(['__BUNDLE_START_TIME__', '__DEV__', 'process']);

/**
 * Format extra variables for injection into prelude (Metro-compatible)
 */
function formatExtraVars(extraVars: Record<string, unknown>): string[] {
  const assignments: string[] = [];

  for (const key in extraVars) {
    if (Object.prototype.hasOwnProperty.call(extraVars, key) && !excluded.has(key)) {
      assignments.push(`${key}=${JSON.stringify(extraVars[key])}`);
    }
  }

  return assignments;
}

/**
 * Get prelude code with variable declarations
 */
export function getPreludeCode(options: {
  isDev: boolean;
  globalPrefix: string;
  requireCycleIgnorePatterns?: RegExp[];
  /** Extra global variables to inject (Metro-compatible) */
  extraVars?: Record<string, unknown>;
}): string {
  const { isDev, globalPrefix, requireCycleIgnorePatterns = [], extraVars = {} } = options;

  const vars = [
    '__BUNDLE_START_TIME__=globalThis.nativePerformanceNow?nativePerformanceNow():Date.now()',
    `__DEV__=${String(isDev)}`,
    ...formatExtraVars(extraVars),
    'process=globalThis.process||{}',
    `__METRO_GLOBAL_PREFIX__='${globalPrefix}'`,
  ];

  if (isDev) {
    vars.push(
      `${globalPrefix}__requireCycleIgnorePatterns=[${requireCycleIgnorePatterns
        .map((regex) => regex.toString())
        .join(',')}]`,
    );
  }

  const processEnv = `process.env=process.env||{};process.env.NODE_ENV=process.env.NODE_ENV||${JSON.stringify(
    isDev ? 'development' : 'production',
  )};`;

  return `var ${vars.join(',')};${processEnv}`;
}
