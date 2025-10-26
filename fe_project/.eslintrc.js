module.exports = {
  root: true,
  env: {
    node: true,
    es2021: true,
  },
  parserOptions: {
    ecmaVersion: 12,
  },
  extends: ['eslint:recommended'],
  rules: {
    // allow console in server-side code
    'no-console': 'off',
    // prefer semicolons
    semi: ['error', 'always'],
    // warn about unused vars but allow unused function args that start with _
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    // limit line length to a reasonable value
    'max-len': ['warn', { code: 120 }],
  },
};
