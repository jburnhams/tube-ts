import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      exclude: ['docs/**', 'scripts/**', 'tests/**', 'dist/**'],
    },
    include: ['tests/**/*.test.ts'],
  },
});
