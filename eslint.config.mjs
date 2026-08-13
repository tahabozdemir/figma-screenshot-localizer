import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * Beyond the usual recommended sets, this config encodes the two architectural
 * rules that are otherwise only prose in CONTRIBUTING.md:
 *
 *   1. Each layer may only reach for the globals its runtime actually has.
 *      `shared/` is compiled into both threads, so it gets neither.
 *   2. The panel never builds markup from strings. Layer names and translations
 *      are document content, and the panel holds API keys.
 *
 * Both used to be conventions you had to already know. They are now errors.
 */
export default tseslint.config(
  {
    ignores: ['dist/', 'dist-test/', 'node_modules/'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  /* ---- TypeScript sources ----
     Each group is parsed against the project it is actually compiled by; the
     two threads have incompatible globals, so there is no single one. */
  {
    files: ['src/plugin/**/*.ts', 'src/shared/**/*.ts'],
    languageOptions: {
      parserOptions: { project: './tsconfig.json', tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ['src/ui/**/*.ts', 'src/providers/**/*.ts'],
    languageOptions: {
      parserOptions: { project: './tsconfig.ui.json', tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ['test/**/*.ts'],
    languageOptions: {
      parserOptions: { project: './tsconfig.test.json', tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      // The Figma API is loosely typed in places and the provider responses are
      // genuinely `any`; the casts are deliberate and commented where they matter.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  /* ---- Where `any` is the honest type ----
     Two boundaries in this codebase are genuinely untyped: the Figma plugin
     API (loosely typed, and it shifts between @figma/plugin-typings versions)
     and a provider's JSON response (which is whatever the server sent). Both
     are narrowed defensively at the point of use — `typeof` checks, shape
     guards, and the tests that drive them with hostile input. The unsafe-any
     family cannot see that narrowing and would need ~90 inline disables to say
     so, which is worse than saying it once, here.

     It stays ON for shared/ and ui/, which have no such excuse. */
  {
    files: ['src/plugin/**/*.ts', 'src/providers/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },

  /* ---- Layering: each thread may only reach for what it actually has ---- */
  {
    files: ['src/shared/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'figma', message: 'shared/ is compiled into both threads — no Figma API here.' },
        { name: 'document', message: 'shared/ is compiled into both threads — no DOM here.' },
        { name: 'window', message: 'shared/ is compiled into both threads — no DOM here.' },
        { name: 'fetch', message: 'shared/ is compiled into both threads — no network here.' },
      ],
    },
  },
  {
    files: ['src/plugin/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'document', message: 'The plugin sandbox has no DOM.' },
        { name: 'window', message: 'The plugin sandbox has no DOM.' },
      ],
    },
  },
  {
    files: ['src/ui/**/*.ts', 'src/providers/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'figma',
          message:
            'The UI iframe cannot touch the document — send a message to the sandbox instead.',
        },
      ],
    },
  },

  /* ---- The panel never builds markup from strings ---- */
  {
    files: ['src/ui/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          property: 'innerHTML',
          message: 'Use el()/replace() from ui/dom.ts. Layer names are untrusted document content.',
        },
        {
          property: 'outerHTML',
          message: 'Use el()/replace() from ui/dom.ts. Layer names are untrusted document content.',
        },
        {
          property: 'insertAdjacentHTML',
          message: 'Use el()/replace() from ui/dom.ts. Layer names are untrusted document content.',
        },
      ],
    },
  },

  /* ---- Node-side files: build script and tests ---- */
  {
    files: ['build.mjs', 'eslint.config.mjs', 'test/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
      sourceType: 'module',
    },
    ...tseslint.configs.disableTypeChecked,
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      'no-console': 'off',
      // Tests seed a DOM from the real template, and drive globals on purpose.
      'no-undef': 'off',
    },
  },

  // Last: turns off everything Prettier owns, so the two never disagree.
  prettier
);
