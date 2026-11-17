import type { SkuInput } from '@weshop/shared'

export type EditableSku = SkuInput & { editorKey: string }
let nextEditorKey = 0

/** 仅用于编辑器稳定 key，不属于 API 商品规格字段 */
export function createEditableSku(sku: SkuInput = { name: '', price: 0, stock: 0, image: '' }): EditableSku {
  return { ...sku, editorKey: `sku-editor-${++nextEditorKey}` }
}
