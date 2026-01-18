/**
 * Get prelude code - Variable declarations
 */

/**
 * Get prelude code with variable declarations
 */
export function getPreludeCode(options: {
  isDev: boolean;
  globalPrefix: string;
  requireCycleIgnorePatterns?: RegExp[];
}): string {
  const { isDev, globalPrefix, requireCycleIgnorePatterns = [] } = options;

  const vars = [
    '__BUNDLE_START_TIME__=globalThis.nativePerformanceNow?nativePerformanceNow():Date.now()',
    `__DEV__=${String(isDev)}`,
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
