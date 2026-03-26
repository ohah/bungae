/**
 * Shared React Native resolve configuration constants.
 */

/** Package.json main fields priority for RN module resolution */
export const RN_MAIN_FIELDS = ['react-native', 'browser', 'main', 'module'] as const;

/** Export condition names for RN module resolution */
export const RN_CONDITION_NAMES = ['react-native', 'import', 'require', 'default'] as const;
