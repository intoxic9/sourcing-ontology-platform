import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/.turbo/**', '**/coverage/**', '**/scripts/**'],
  },

  js.configs.recommended,
  tseslint.configs.strictTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        // projectService resolves each workspace package's own tsconfig.json, which is
        // what lets one root config type-check every package.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // The non-negotiables from .cursor/rules/project.md, as errors rather than trust.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',

      // explicit-module-boundary-types is deliberately absent. A generic Zod schema
      // factory such as tracked() has a return type TypeScript cannot verify against a
      // hand-written one while the type parameter is unresolved, so the rule can only
      // be satisfied by weakening the annotation to something less true than the
      // inferred type. The goal it serves — nothing untyped crossing a boundary — is
      // already covered by strict mode, no-explicit-any and the no-unsafe-* rules.
    },
  },

  // Config and tooling files sit outside the packages' tsconfigs, so type-aware rules
  // have no program to consult for them.
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
