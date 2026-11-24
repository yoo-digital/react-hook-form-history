import { defaultClientConditions } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolve @yoo-digital/rhf-history to its TypeScript source, so tests need no build of it.
  resolve: { conditions: ['@yoo-digital/source', ...defaultClientConditions] },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
  },
});
