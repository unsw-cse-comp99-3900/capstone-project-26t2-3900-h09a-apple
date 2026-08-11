import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
    // Default node for lib unit tests; *.test.tsx files set jsdom via pragma.
    environment: 'node',
    coverage: {
      provider: 'v8',
      // Unit surface: client helpers + pure nav model. Pages stay manual / E2E.
      include: ['src/lib/**/*.{ts,tsx}', 'src/components/shell/nav-items.ts'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/*.d.ts'],
      reporter: ['text', 'text-summary'],
    },
  },
});
