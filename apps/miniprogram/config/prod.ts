export default {
  env: {
    NODE_ENV: '"production"',
  },
  defineConstants: {
    // TODO 上线前改为正式 API 域名，并在小程序后台配置 request 合法域名
    API_BASE: '"http://192.168.10.43:7101"',
  },
  mini: {},
  h5: {},
}
