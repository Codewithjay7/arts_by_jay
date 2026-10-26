module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',
    'plugin:react-hooks/recommended',
  ],
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  settings: { react: { version: '18.3' } },
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': 'off',
    'react/prop-types': 'off',
    
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  },
  overrides: [
    {
      // React Three Fiber renders three.js objects as JSX elements, so every
      // three.js property (args, position, intensity, castShadow…) looks
      // "unknown" to the React plugin. The rule cannot see the R3F catalogue.
      files: ['src/gallery/**/*.jsx'],
      rules: { 'react/no-unknown-property': 'off' },
    },
  ],
  ignorePatterns: ['dist', 'node_modules'],
};
