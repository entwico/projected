import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // gc() for the tests of what stays in memory
    execArgv: ['--expose-gc'],
    coverage: {
      provider: 'istanbul',
    },
  },
});
