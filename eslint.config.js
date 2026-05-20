import { defineConfig } from '@entwico/eslint-config';

export default defineConfig({
  root: import.meta.dirname,
  ignores: ['src/benchmark/*'],
  extra: [
    {
      files: ['**/*.spec.ts'],
      rules: {
        '@typescript-eslint/require-await': 'off',
      },
    },
  ],
});
