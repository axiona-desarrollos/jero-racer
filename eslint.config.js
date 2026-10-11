export default [
  {
    files: ['src/**/*.js', 'tests/**/*.js', 'scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { window:'readonly', document:'readonly', navigator:'readonly',
        performance:'readonly', requestAnimationFrame:'readonly',
        cancelAnimationFrame:'readonly', addEventListener:'readonly',
        devicePixelRatio:'readonly', innerWidth:'readonly', innerHeight:'readonly',
        console:'readonly', fetch:'readonly', Buffer:'readonly', process:'readonly',
        __dirname:'readonly', URLSearchParams:'readonly', location:'readonly',
        setTimeout:'readonly', clearTimeout:'readonly', setInterval:'readonly',
        clearInterval:'readonly', KeyboardEvent:'readonly', Event:'readonly', localStorage:'readonly',
        screen:'readonly', removeEventListener:'readonly', DeviceOrientationEvent:'readonly' },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'prefer-const': 'warn',
      eqeqeq: ['warn', 'smart'],
    },
  },
];
