/// <reference types="vitest" />
import { coverageConfigDefaults, defineConfig } from 'vitest/config';

const setupFiles = '@kinvolk/headlamp-plugin/config/setupTests.js';

export default defineConfig({
  test: {
    globals: true,
    clearMocks: true,
    coverage: {
      provider: 'istanbul',
      reporter: [['text', { maxCols: 200 }], ['html']],
      exclude: [
        ...coverageConfigDefaults.exclude,
        'src/**/*.stories*.{ts,tsx}',
        'src/**/*.guidepup.test.tsx',
      ],
      include: ['src/**/*.{ts,tsx}'],
    },
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'jsdom',
          setupFiles,
          include: ['src/**/*.test.{ts,tsx}'],
          exclude: ['src/**/*.guidepup.test.tsx'],
        },
      },
      {
        test: {
          name: 'a11y',
          environment: 'jsdom',
          pool: 'threads',
          setupFiles,
          include: ['src/**/*.guidepup.test.tsx'],
          testTimeout: 30000,
        },
      },
    ],
  },
});
