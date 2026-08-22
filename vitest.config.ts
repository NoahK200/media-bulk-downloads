import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'packages/core/vitest.config.ts',
      'packages/storage/vitest.config.ts',
      'packages/platform/vitest.config.ts',
    ],
    maxWorkers: '50%',
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      include: ['packages/{core,storage,platform}/src/**/*.ts'],
      exclude: ['packages/**/src/**/*.d.ts'],
      thresholds: {
        statements: 89,
        branches: 81,
        functions: 93,
        lines: 92,
      },
    },
  },
});
