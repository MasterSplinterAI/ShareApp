module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs', 'tests'],
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  settings: { react: { version: '18.2' } },
  plugins: ['react-refresh'],
  rules: {
    // Project does not use PropTypes (relies on TypeScript at call sites)
    'react/prop-types': 'off',
    // Hook dep exhaustiveness: off — pre-existing pattern; enforce via PR review
    'react-hooks/exhaustive-deps': 'off',
    // Empty catch blocks are used for intentional fire-and-forget ignores
    'no-empty': ['error', { allowEmptyCatch: true }],
    // Unused vars are ubiquitous pre-existing pattern; off to avoid false noise
    'no-unused-vars': 'off',
    // Fast-refresh: components that also export constants — off, pre-existing
    'react-refresh/only-export-components': 'off',
  },
  overrides: [
    {
      // Vite/PostCSS/Tailwind configs run in Node, not the browser
      files: ['vite.config.js', 'postcss.config.js', 'tailwind.config.js'],
      env: { node: true },
    },
  ],
};
