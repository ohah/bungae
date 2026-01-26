/**
 * Bungae version constant
 * Single source of truth for version number
 * Imported from package.json
 */

import packageJson from '../package.json';

export const VERSION: string = packageJson.version;
