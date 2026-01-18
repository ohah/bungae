/**
 * Merged config fixture for testing
 * Metro style: chains multiple config functions
 */

const { mergeConfig } = require('../merge');

const secondConfig = (previous) => ({
  resolver: {
    sourceExts: ['before', ...(previous?.resolver?.sourceExts || [])],
  },
});

const thirdConfig = (previous) => ({
  resolver: {
    sourceExts: [...(previous?.resolver?.sourceExts || []), 'after'],
  },
});

module.exports = (metroDefaults) => {
  // Chain config functions like Metro does
  // First apply secondConfig to defaults
  const first = mergeConfig(metroDefaults || {}, secondConfig(metroDefaults));
  // Then apply thirdConfig to the result
  return mergeConfig(first, thirdConfig(first));
};
