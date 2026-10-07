import js from '@eslint/js'
import ts from 'typescript-eslint'
export default ts.config(
  { ignores: ['out/**', 'node_modules/**', '.local/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  { files: ['**/*.ts', '**/*.tsx'], rules: {
    'no-undef': 'off', // TypeScript resolves DOM/Node globals with the correct types.
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
  } }
)
