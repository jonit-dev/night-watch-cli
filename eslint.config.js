import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Flexible defaults — avoid noisy rules
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'interface',
          format: ['PascalCase'],
          prefix: ['I'],
        },
        {
          selector: 'memberLike',
          modifiers: ['private'],
          format: null,
          leadingUnderscore: 'forbid',
        },
      ],
      'no-console': 'off',
      'no-useless-escape': 'warn',
      'no-useless-assignment': 'warn',
      'prefer-const': 'warn',
      'preserve-caught-error': 'off',
      'sort-imports': ['error', { ignoreDeclarationSort: true }],

      // SRP: flag god files (warn only — don't break CI on existing code)
      'max-lines': ['warn', { max: 500, skipBlankLines: true, skipComments: true }],

      'no-restricted-imports': [
        'warn',
        {
          paths: [
            {
              name: 'reflect-metadata',
              message:
                'Only import reflect-metadata in entrypoints (cli.ts, di/container.ts) or test files.',
            },
          ],
          patterns: [
            {
              regex: '^\\.\\./\\.\\.[\\/]',
              message: 'Avoid deep relative imports (../../). Use @/* path aliases instead.',
            },
            {
              regex: '^@night-watch/core/.+',
              message:
                "Import from '@night-watch/core' barrel instead of deep paths (e.g. import { X } from '@night-watch/core').",
            },
          ],
        },
      ],
    },
  },
  // Allow reflect-metadata in entrypoints and test files
  {
    files: ['**/cli.ts', '**/di/container.ts', '**/__tests__/**'],
    rules: {
      'no-restricted-imports': [
        'warn',
        {
          patterns: [
            {
              regex: '^\\.\\./\\.\\.[\\/]',
              message: 'Avoid deep relative imports (../../). Use @/* path aliases instead.',
            },
          ],
        },
      ],
    },
  },
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'scripts/',
      'templates/',
      'web/',
      '**/*.test.ts',
      '**/__tests__/**',
      // Compiled TypeScript output files that live alongside source in src/
      'packages/**/src/**/*.js',
      'packages/**/src/**/*.d.ts',
    ],
  },
);
