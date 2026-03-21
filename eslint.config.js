import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Global ignores
  { ignores: ['dist', 'coverage', 'node_modules', '*.config.js', 'src/setupTests.ts'] },

  // Base configuration for all JS/TS files
  {
    files: ['**/*.{js,mjs,cjs,ts,jsx,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    rules: {
      // React Hooks rules for all files that might use hooks
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },

  // React-specific configuration
  {
    files: ['**/*.{jsx,tsx}'],
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    extends: [react.configs.flat.recommended, react.configs.flat['jsx-runtime']],
    settings: {
      react: {
        version: 'detect',
        fragment: 'Fragment',
      },
    },
    rules: {
      // React Refresh rules
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],

      // React best practices - optimized based on Context7 docs
      'react/jsx-uses-react': 'off', // Not needed with new JSX transform
      'react/react-in-jsx-scope': 'off', // Not needed with new JSX transform
      'react/prop-types': 'off', // Using TypeScript for prop validation
      'react/jsx-key': 'error',
      'react/jsx-no-duplicate-props': 'error',
      'react/jsx-no-undef': 'error',
      'react/jsx-uses-vars': 'error',
      'react/no-children-prop': 'error',
      'react/no-danger-with-children': 'error',
      'react/no-deprecated': 'error',
      'react/no-direct-mutation-state': 'error',
      'react/no-find-dom-node': 'error',
      'react/no-is-mounted': 'error',
      'react/no-render-return-value': 'error',
      'react/no-string-refs': 'error',
      'react/no-unescaped-entities': 'off', // Allow unescaped entities in JSX (common in text)
      'react/no-unknown-property': 'error',
      'react/require-render-return': 'error',

      // TypeScript-specific React rules - based on Context7 best practices
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        {
          prefer: 'type-imports',
          fixStyle: 'separate-type-imports',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  // Test files configuration - strict type safety enforced
  {
    files: ['**/*.{test,spec}.{js,mjs,cjs,ts,jsx,tsx}', '**/__tests__/**/*'],
    languageOptions: {
      globals: {
        ...globals.jest,
        ...globals.node,
      },
    },
    rules: {
      // Enforce strict type safety in tests - this is a production project
      '@typescript-eslint/no-explicit-any': 'error',
      'react/display-name': 'off', // Allow anonymous components in tests
    },
  },

  // Test utilities - react-refresh not applicable
  {
    files: ['**/test-utils/**/*.{jsx,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  }
);