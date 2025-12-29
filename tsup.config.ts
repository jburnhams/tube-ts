import { defineConfig } from 'tsup';

export default defineConfig([
  // ESM and CJS builds (unbundled dependencies for consumers using bundlers)
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true,
    outDir: 'dist',
    // Do not bundle dependencies for library usage
    external: ['shaka-player', 'youtubei.js', 'googlevideo', 'bgutils-js'],
    treeshake: true,
  },
  // Browser bundle (IIFE) - self-contained
  {
    entry: ['src/index.ts'],
    format: ['iife'],
    name: 'TubeTS', // Global variable name
    globalName: 'TubeTS',
    dts: false,
    splitting: false,
    sourcemap: true,
    // Bundle everything for the browser script
    noExternal: ['shaka-player', 'youtubei.js', 'googlevideo', 'bgutils-js'],
    outDir: 'dist/browser',
    target: 'es2020',
    platform: 'browser',
    treeshake: true,
    // Add banner/footer if needed, or replacements
    esbuildOptions(options) {
      options.define = {
        // 'process.env.NODE_ENV': '"production"'
      };
      // Polyfill node built-ins if needed by dependencies
      // options.inject = ['./shim.js']
    }
  },
  // Bundled ESM for those who want a single file (optional, matching old structure)
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: false,
    splitting: false,
    sourcemap: true,
    noExternal: ['shaka-player', 'youtubei.js', 'googlevideo', 'bgutils-js'],
    outDir: 'dist/bundles',
    outExtension() {
      return {
        js: '.esm.js',
      }
    },
    target: 'es2020',
    treeshake: true,
  }
]);
