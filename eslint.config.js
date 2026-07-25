import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Global ignores
  { ignores: ['dist', 'dist-cli', '**/dist/**', 'coverage', '**/coverage/**', 'node_modules', '.claude/**', '*.config.js', 'src/setupTests.ts'] },

  // Base configuration for all JS/TS files. Type-aware linting is enabled via
  // `projectService` + `recommendedTypeChecked` (audit M-08). Newly-surfaced
  // type-checked rules are set to 'warn' below as a ratchet so lint stays green
  // while the noise is paid down incrementally.
  {
    files: ['**/*.{js,mjs,cjs,ts,jsx,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
    ],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    rules: {
      // React Hooks rules for all files that might use hooks
      'react-hooks/rules-of-hooks': 'error',
      // audit M-09: a missing/extra dep is a real stale-closure bug, not a style nit.
      'react-hooks/exhaustive-deps': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      // audit M-08 ratchet: type-aware rules that are noisy on the current
      // codebase are downgraded to 'warn' so CI lint stays green. Promote to
      // 'error' as each is paid down.
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-misused-promises': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-redundant-type-constituents': 'warn',
      '@typescript-eslint/restrict-template-expressions': 'warn',
      '@typescript-eslint/require-await': 'warn',
      '@typescript-eslint/unbound-method': 'warn',
      '@typescript-eslint/await-thenable': 'warn',
      '@typescript-eslint/no-base-to-string': 'warn',
      '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
    },
  },

  // Config / tooling files and the Node-side eval scripts are not part of the
  // app tsconfig project graph; lint them without type information to avoid
  // "file not found by the project service" parsing errors (audit M-08).
  {
    files: ['**/*.config.{js,ts}', 'eslint.config.js', 'evals/**/*.{ts,tsx}', 'scripts/**/*.{js,mjs,cjs,ts}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // The CLI has its own strict TypeScript project and runs in Node.js.
  {
    files: ['packages/cli/src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
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
      // audit M-09: an explicit type prevents <button> defaulting to type="submit"
      // and accidentally submitting an enclosing form. 'warn' to ratchet in.
      'react/button-has-type': 'warn',

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
