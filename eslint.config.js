import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Architecture guardrails (AGENTS.md):
 * - src/domain is pure logic: no React/DOM/IndexedDB/browser globals.
 * - Browser GPS / Wake Lock APIs are only touched inside src/adapters.
 * - UI never talks to IndexedDB directly (only via src/data/repositories).
 */
const DOMAIN_FORBIDDEN_IMPORTS = [
  'react',
  'react-dom',
  'react-router',
  'zustand',
  'leaflet',
  'react-leaflet',
  'dexie',
  'dexie-react-hooks',
  'chart.js',
  'react-chartjs-2',
];

export default defineConfig([
  globalIgnores([
    'dist',
    'coverage',
    'playwright-report',
    'test-results',
    'blob-report',
    'node_modules',
    'docs',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.strictTypeChecked,
      reactHooks.configs.flat['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
      parserOptions: {
        project: ['./tsconfig.app.json', './tsconfig.node.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-restricted-properties': [
        'error',
        {
          object: 'navigator',
          property: 'geolocation',
          message: 'Chỉ src/adapters/geolocation được truy cập Geolocation API.',
        },
        {
          object: 'navigator',
          property: 'wakeLock',
          message: 'Chỉ src/adapters/wake-lock được truy cập Screen Wake Lock API.',
        },
      ],
    },
  },
  {
    files: ['src/domain/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: DOMAIN_FORBIDDEN_IMPORTS.map((name) => ({
            name,
            message: 'src/domain phải là pure logic (không React/DOM/IndexedDB/UI libs).',
          })),
          patterns: [
            {
              group: [
                '@/adapters/*',
                '@/data/*',
                '@/components/*',
                '@/pages/*',
                '@/stores/*',
                '@/hooks/*',
                '@/app/*',
              ],
              message: 'src/domain không được phụ thuộc vào tầng adapter/data/UI; dùng ports + DI.',
            },
          ],
        },
      ],
      // Domain logs through an injected logger, never the console.
      'no-console': 'error',
      'no-restricted-globals': [
        'error',
        'globalThis',
        'window',
        'document',
        'navigator',
        'localStorage',
        'sessionStorage',
        'indexedDB',
        'location',
      ],
    },
  },
  {
    files: ['src/components/**/*.{ts,tsx}', 'src/pages/**/*.{ts,tsx}', 'src/stores/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'dexie',
              message: 'UI không gọi IndexedDB trực tiếp; dùng repository qua hooks.',
            },
          ],
          patterns: [
            { group: ['@/data/db', '@/data/db.*'], message: 'UI không gọi IndexedDB trực tiếp.' },
          ],
        },
      ],
    },
  },
  {
    files: ['src/adapters/geolocation/**/*.ts'],
    rules: { 'no-restricted-properties': 'off' },
  },
  {
    files: ['src/adapters/wake-lock/**/*.ts'],
    rules: { 'no-restricted-properties': 'off' },
  },
  {
    files: ['**/*.test.{ts,tsx}', 'src/tests/**/*.{ts,tsx}', 'e2e/**/*.ts'],
    rules: {
      // Tests install fake browser APIs on purpose.
      'no-restricted-properties': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  {
    files: ['e2e/**/*.ts', 'vite.config.ts', 'playwright.config.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { 'react-hooks/rules-of-hooks': 'off' },
  },
  {
    files: ['**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
]);
