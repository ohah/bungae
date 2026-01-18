/**
 * Bad server config fixture for testing validation
 */

module.exports = {
  server: {
    // useGlobalHotkey should be a boolean, not a string
    useGlobalHotkey: 'test',
  },
};
