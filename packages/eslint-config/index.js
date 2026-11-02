import antfu from '@antfu/eslint-config'

// 全仓统一 ESLint 入口，内部基于 @antfu/eslint-config。
// 参数与 antfu 完全一致：weshop(options, ...userConfigs)，各应用按需传入自己的选项与追加配置。
export default function weshop(options = {}, ...userConfigs) {
  return antfu(options, ...userConfigs)
}
