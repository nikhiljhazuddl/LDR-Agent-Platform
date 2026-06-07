import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tseslint from '@typescript-eslint/eslint-plugin';

export default [
  js.configs.recommended,
  {
    ignores: ['node_modules/**', 'dist/**', 'coverage/**'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  }
];
