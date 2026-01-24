/**
 * Configuration validation
 */

import type { BungaeConfig } from './types';

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

/**
 * Validate Bungae configuration
 */
export function validateConfig(config: BungaeConfig): void {
  // Validate root
  if (config.root !== undefined && typeof config.root !== 'string') {
    throw new ConfigValidationError(
      `Invalid config: \`root\` must be a string, but received ${typeof config.root}`,
    );
  }

  // Validate entry
  if (config.entry !== undefined && typeof config.entry !== 'string') {
    throw new ConfigValidationError(
      `Invalid config: \`entry\` must be a string, but received ${typeof config.entry}`,
    );
  }

  // Validate platform
  if (config.platform !== undefined) {
    const validPlatforms = ['ios', 'android', 'web'];
    if (!validPlatforms.includes(config.platform)) {
      throw new ConfigValidationError(
        `Invalid config: \`platform\` must be one of ${validPlatforms.join(', ')}, but received ${config.platform}`,
      );
    }
  }

  // Validate mode
  if (config.mode !== undefined) {
    const validModes = ['development', 'production'];
    if (!validModes.includes(config.mode)) {
      throw new ConfigValidationError(
        `Invalid config: \`mode\` must be one of ${validModes.join(', ')}, but received ${config.mode}`,
      );
    }
  }

  // Validate dev
  if (config.dev !== undefined && typeof config.dev !== 'boolean') {
    throw new ConfigValidationError(
      `Invalid config: \`dev\` must be a boolean, but received ${typeof config.dev}`,
    );
  }

  // Validate minify
  if (config.minify !== undefined && typeof config.minify !== 'boolean') {
    throw new ConfigValidationError(
      `Invalid config: \`minify\` must be a boolean, but received ${typeof config.minify}`,
    );
  }

  // Validate outDir
  if (config.outDir !== undefined && typeof config.outDir !== 'string') {
    throw new ConfigValidationError(
      `Invalid config: \`outDir\` must be a string, but received ${typeof config.outDir}`,
    );
  }

  // Validate resolver
  if (config.resolver !== undefined) {
    if (
      typeof config.resolver !== 'object' ||
      config.resolver === null ||
      Array.isArray(config.resolver)
    ) {
      throw new ConfigValidationError(
        `Invalid config: \`resolver\` must be an object, but received ${typeof config.resolver}`,
      );
    }

    if (config.resolver.sourceExts !== undefined && !Array.isArray(config.resolver.sourceExts)) {
      throw new ConfigValidationError(
        `Invalid config: \`resolver.sourceExts\` must be an array, but received ${typeof config.resolver.sourceExts}`,
      );
    }

    if (config.resolver.assetExts !== undefined && !Array.isArray(config.resolver.assetExts)) {
      throw new ConfigValidationError(
        `Invalid config: \`resolver.assetExts\` must be an array, but received ${typeof config.resolver.assetExts}`,
      );
    }

    if (config.resolver.platforms !== undefined && !Array.isArray(config.resolver.platforms)) {
      throw new ConfigValidationError(
        `Invalid config: \`resolver.platforms\` must be an array, but received ${typeof config.resolver.platforms}`,
      );
    }

    if (
      config.resolver.preferNativePlatform !== undefined &&
      typeof config.resolver.preferNativePlatform !== 'boolean'
    ) {
      throw new ConfigValidationError(
        `Invalid config: \`resolver.preferNativePlatform\` must be a boolean, but received ${typeof config.resolver.preferNativePlatform}`,
      );
    }

    if (
      config.resolver.nodeModulesPaths !== undefined &&
      !Array.isArray(config.resolver.nodeModulesPaths)
    ) {
      throw new ConfigValidationError(
        `Invalid config: \`resolver.nodeModulesPaths\` must be an array, but received ${typeof config.resolver.nodeModulesPaths}`,
      );
    }

    if (config.resolver.blockList !== undefined && !Array.isArray(config.resolver.blockList)) {
      throw new ConfigValidationError(
        `Invalid config: \`resolver.blockList\` must be an array, but received ${typeof config.resolver.blockList}`,
      );
    }
  }

  // Validate transformer
  if (config.transformer !== undefined) {
    if (
      typeof config.transformer !== 'object' ||
      config.transformer === null ||
      Array.isArray(config.transformer)
    ) {
      throw new ConfigValidationError(
        `Invalid config: \`transformer\` must be an object, but received ${typeof config.transformer}`,
      );
    }

    if (config.transformer.minifier !== undefined) {
      const validMinifiers = ['bun', 'terser', 'esbuild', 'swc'];
      if (!validMinifiers.includes(config.transformer.minifier)) {
        throw new ConfigValidationError(
          `Invalid config: \`transformer.minifier\` must be one of ${validMinifiers.join(', ')}, but received ${config.transformer.minifier}`,
        );
      }
    }

    if (
      config.transformer.inlineRequires !== undefined &&
      typeof config.transformer.inlineRequires !== 'boolean'
    ) {
      throw new ConfigValidationError(
        `Invalid config: \`transformer.inlineRequires\` must be a boolean, but received ${typeof config.transformer.inlineRequires}`,
      );
    }
  }

  // Validate serializer
  if (config.serializer !== undefined) {
    if (
      typeof config.serializer !== 'object' ||
      config.serializer === null ||
      Array.isArray(config.serializer)
    ) {
      throw new ConfigValidationError(
        `Invalid config: \`serializer\` must be an object, but received ${typeof config.serializer}`,
      );
    }

    if (config.serializer.bundleType !== undefined) {
      const validBundleTypes = ['plain', 'ram-indexed', 'ram-file'];
      if (!validBundleTypes.includes(config.serializer.bundleType)) {
        throw new ConfigValidationError(
          `Invalid config: \`serializer.bundleType\` must be one of ${validBundleTypes.join(', ')}, but received ${config.serializer.bundleType}`,
        );
      }
    }

    if (config.serializer.polyfills !== undefined && !Array.isArray(config.serializer.polyfills)) {
      throw new ConfigValidationError(
        `Invalid config: \`serializer.polyfills\` must be an array, but received ${typeof config.serializer.polyfills}`,
      );
    }

    if (config.serializer.prelude !== undefined && !Array.isArray(config.serializer.prelude)) {
      throw new ConfigValidationError(
        `Invalid config: \`serializer.prelude\` must be an array, but received ${typeof config.serializer.prelude}`,
      );
    }
  }

  // Validate server
  if (config.server !== undefined) {
    if (
      typeof config.server !== 'object' ||
      config.server === null ||
      Array.isArray(config.server)
    ) {
      throw new ConfigValidationError(
        `Invalid config: \`server\` must be an object, but received ${typeof config.server}`,
      );
    }

    if (config.server.port !== undefined && typeof config.server.port !== 'number') {
      throw new ConfigValidationError(
        `Invalid config: \`server.port\` must be a number, but received ${typeof config.server.port}`,
      );
    }

    if (
      config.server.useGlobalHotkey !== undefined &&
      typeof config.server.useGlobalHotkey !== 'boolean'
    ) {
      throw new ConfigValidationError(
        `Invalid config: \`server.useGlobalHotkey\` must be a boolean, but received ${typeof config.server.useGlobalHotkey}`,
      );
    }

    if (
      config.server.forwardClientLogs !== undefined &&
      typeof config.server.forwardClientLogs !== 'boolean'
    ) {
      throw new ConfigValidationError(
        `Invalid config: \`server.forwardClientLogs\` must be a boolean, but received ${typeof config.server.forwardClientLogs}`,
      );
    }

    if (
      config.server.verifyConnections !== undefined &&
      typeof config.server.verifyConnections !== 'boolean'
    ) {
      throw new ConfigValidationError(
        `Invalid config: \`server.verifyConnections\` must be a boolean, but received ${typeof config.server.verifyConnections}`,
      );
    }

    if (
      config.server.unstable_serverRoot !== undefined &&
      config.server.unstable_serverRoot !== null &&
      typeof config.server.unstable_serverRoot !== 'string'
    ) {
      throw new ConfigValidationError(
        `Invalid config: \`server.unstable_serverRoot\` must be a string or null, but received ${typeof config.server.unstable_serverRoot}`,
      );
    }
  }
}
