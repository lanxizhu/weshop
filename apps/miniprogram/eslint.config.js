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
    // Babel 配置保留 CommonJS，供 Taro 加载
    files: ['babel.config.cjs'],
    languageOptions: { sourceType: 'commonjs' },
  },
)
