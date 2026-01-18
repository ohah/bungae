# Bungae Testing Guide

Guide for testing the Bungae bundler with ExampleApp.

## Setup Complete

- ✅ `bungae.config.ts` - TypeScript configuration file created
- ✅ `package.json` - bungae added as workspace dependency (`workspace:*`)

## Phase-by-Phase Bundling Availability

### Phase 1-3 Completion (Transformation + Serialization)

- ✅ **Actual bundling available**: `bungae build` command can generate bundle files
- Transformation: Code transformation (TypeScript → JavaScript, JSX transformation)
- Serialization: Serialize to Metro-compatible bundle format

### Phase 2 Completion (Development Environment)

- ✅ **Development server**: `bungae serve` command to run development server
- ✅ **HMR**: Automatic updates on file changes
- ✅ **Incremental build**: Rebuild only changed files

## Current Status

- **Phase 1-1**: ✅ Config system completed
- **Phase 1-2**: ✅ Platform Resolver Plugin completed
- **Phase 1-3**: 🔄 Transformation + Serialization (in progress)
- **Phase 2**: ⏳ Development environment (pending)

**Currently `build` and `serve` are TODO**, so actual bundling will be available after Phase 1-3 completion, and development server with HMR will work after Phase 2 completion.

## Usage

Since it's configured as a workspace dependency, you can use it via `npx` or `bunx`:

```bash
# Start development server (works after Phase 2 completion)
npx bungae serve
# or
bunx bungae serve

# Build (generates actual bundle after Phase 1-3 completion)
npx bungae build
# or
bunx bungae build

# Platform-specific builds
npx bungae build --platform ios
npx bungae build --platform android

# Check options
npx bungae --help
```

**Note**: Currently there's an ESM duplicate export issue in the built files, so the ESM version may not work.
In that case, you can use the CJS version directly:

```bash
bun ../../packages/bungae/dist/cli.cjs serve
bun ../../packages/bungae/dist/cli.cjs build
```

## Config File

The `bungae.config.ts` file is automatically loaded. It's written in TypeScript for type safety and imports from the built package (`bungae`).

## Workspace Dependency

In a monorepo environment, use `workspace:*` to reference the local package:

- Use `workspace:*` instead of `file:../../packages/bungae`
- Leverages Bun's workspace support
- Import from `bungae` package name, not from source files
