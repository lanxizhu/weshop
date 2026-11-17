import { describe, expect, it } from 'vitest'
import { validateOrderCreate, validatePasswordStrength, validateProduct } from './validate.js'

describe('validateProduct', () => {
  it('规范化有效商品并以 SKU 为规格事实来源', () => {
    const result = validateProduct({
      name: ' 测试商品 ',
      category: ' 测试 ',
      price: 9.9,
      stock: 2,
      description: '',
      status: 'on',
      images: [],
      skus: [{ name: ' 默认规格 ', price: 9.9, stock: 2 }],
    })
    expect(result.errors).toBeUndefined()
    expect(result.value?.name).toBe('测试商品')
    expect(result.value?.skus[0]?.name).toBe('默认规格')
  })

  it('拒绝负价格、零规格和非法图片地址', () => {
    const result = validateProduct({
      name: '测试',
      price: -1,
      stock: 0,
      images: ['file:///etc/passwd'],
      skus: [],
    })
    expect(result.errors).toEqual(expect.arrayContaining([
      '价格必须是不小于 0 的数字',
      '至少需要 1 个规格',
      '图片地址必须是 http(s) 链接或 /uploads/ 路径',
    ]))
  })
})

describe('validateOrderCreate', () => {
  const address_id = 1

  it('对购物车选中项去重', () => {
    const result = validateOrderCreate({ source: { type: 'cart', item_ids: [1, 1, 2] }, address_id })
    expect(result.errors).toBeUndefined()
    expect(result.value?.source).toEqual({ type: 'cart', item_ids: [1, 2] })
  })

  it('拒绝非法下单来源与数量', () => {
    expect(validateOrderCreate({ source: { type: 'unknown' }, address_id }).errors).toContain('下单来源不合法')
    expect(validateOrderCreate({
      source: { type: 'direct', product_id: 1, sku_id: 1, quantity: 0 },
      address_id,
    }).errors).toContain('数量必须是 1~99 的整数')
  })
})

describe('validatePasswordStrength', () => {
  it('要求长度、字母和数字同时满足', () => {
    expect(validatePasswordStrength('short')).not.toHaveLength(0)
    expect(validatePasswordStrength('onlyletters')).not.toHaveLength(0)
    expect(validatePasswordStrength('12345678')).not.toHaveLength(0)
    expect(validatePasswordStrength('admin123')).toHaveLength(0)
  })
})
