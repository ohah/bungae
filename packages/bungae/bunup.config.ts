import { defineConfig } from 'bunup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts', 'src/cli-impl.ts'],
  outDir: 'dist',
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: 'linked',
  target: 'node',
  splitting: false, // Disable code splitting to prevent duplicate exports
  external: [
    'react-native',
    'hermes-parser',
    'babel-plugin-syntax-hermes-parser',
    '@babel/core',
    '@babel/plugin-transform-flow-strip-types',
    '@swc/core',
    '@react-native/babel-preset',
    '@react-native/babel-plugin-codegen',
    /^@babel\/.*/,
    /^@react-native\/.*/,
  ],
});
