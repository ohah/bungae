/**
 * CJS sync function config fixture for testing
 */

module.exports = (defaultConfig) => {
  return {
    resolver: {
      sourceExts: ['json', 're', ...(defaultConfig?.resolver?.sourceExts || [])],
    },
  };
};
