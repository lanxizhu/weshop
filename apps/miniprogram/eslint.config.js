import weshop from '@weshop/eslint-config'

export default weshop(
  {
    react: true,
  },
  {
    // Taro 小程序没有 Fast Refresh，react-refresh 规则不适用
    files: ['src/**/*.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    // babel.config.js 是 CommonJS
    files: ['babel.config.js'],
    languageOptions: { sourceType: 'commonjs' },
  },
)
