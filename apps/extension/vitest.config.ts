import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing';

const chromeMockSetupLast = {
  name: 'chrome-mock-setup-last',
  config: () => ({ test: { setupFiles: ['./tests/unit/setupTests.ts'] } }),
};

export default defineConfig({
  plugins: [WxtVitest(), chromeMockSetupLast],
  test: {
    name: 'extension',
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    globals: true,
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts'],
      thresholds: {
        statements: 87,
        branches: 81,
        functions: 87,
        lines: 90,
      },
    },
  },
});
