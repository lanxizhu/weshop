import weshop from '@weshop/eslint-config'

export default weshop({
  react: true,
  ignores: [
    // shadcn/ui 生成的组件库，不参与 lint（生成代码保持原样便于后续升级覆盖）
    'src/components/ui/**',
    // 接口文档中的示例代码片段不是可运行组件
    'API.md',
  ],
})
