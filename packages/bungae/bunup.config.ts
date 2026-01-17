import { defineConfig } from 'bunup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  outDir: 'dist',
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: 'linked',
  target: 'node',
  external: ['react-native'],
});
