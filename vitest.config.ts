import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/tests/**/*.test.ts', 'apps/*/tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
