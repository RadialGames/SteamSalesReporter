import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs['flat/recommended'],
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  // General rules for all TypeScript files
  {
    files: ['**/*.ts'],
    rules: {
      // Strict unused variable checking
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // TypeScript handles undeclared variables
      'no-undef': 'off',
      // Allow functions to be used before definition (hoisting)
      '@typescript-eslint/no-use-before-define': ['error', { functions: false }],
      // Disallow variable shadowing
      '@typescript-eslint/no-shadow': 'error',
      // Disallow explicit any
      '@typescript-eslint/no-explicit-any': 'error',
      // Prefer const over let
      'prefer-const': 'error',
    },
  },
  // Svelte-specific rules
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
    rules: {
      // Strict unused variable checking
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // TypeScript handles undeclared variables
      'no-undef': 'off',
      // Allow functions to be used before definition (hoisting)
      '@typescript-eslint/no-use-before-define': ['error', { functions: false }],
      // Disallow variable shadowing
      '@typescript-eslint/no-shadow': 'error',
      // Disallow explicit any
      '@typescript-eslint/no-explicit-any': 'error',
      // Svelte's $props() and $derived use let but are reactive/constant
      'prefer-const': 'off',
      // Svelte reactive statements use expression statements for dependency tracking
      '@typescript-eslint/no-unused-expressions': 'off',
      // Svelte specific
      'svelte/no-at-html-tags': 'warn',
      // Each blocks must have keys for performance
      'svelte/require-each-key': 'error',
      // Svelte 5 uses regular Map/Set in many cases
      'svelte/prefer-svelte-reactivity': 'off',
    },
  },
  {
    ignores: [
      'node_modules/',
      'dist/',
      'build/',
      'src-tauri/target/',
      '.svelte-kit/',
      '*.config.js',
      '*.config.ts',
    ],
  }
);
