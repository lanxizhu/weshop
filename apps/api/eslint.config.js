import weshop from '@weshop/eslint-config'

// apps/api 使用 TypeScript 7（tsgo 预览版），typescript-eslint 尚不支持该版本，
// 因此关闭 TS 感知规则，仅 lint JS 配置文件；TS 源码由 tsgo typecheck 把关。
// test 插件会在加载时硬性引入 typescript-eslint，需一并关闭（本包无单测）。
// 待 typescript-eslint 支持 TS 7 后（或工具链回退 TS 6）可恢复这两项。
export default weshop({
  typescript: false,
  test: false,
})
