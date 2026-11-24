import { describe, expect, it } from 'vitest'
import {
  validateAddress,
  validateCartAdd,
  validateCartQuantity,
  validateOrderCreate,
  validatePasswordStrength,
  validateProduct,
  validateProfile,
  validateStockDelta,
  validateSystemSettings,
} from './validate.js'

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


describe('validateSystemSettings', () => {
  it('规范化网站品牌信息与图片地址', () => {
    const result = validateSystemSettings({
      site_name: ' 新商城 ',
      site_description: ' 精选好物 ',
      site_logo_url: ' /uploads/logo.png ',
      site_favicon_url: ' https://example.com/favicon.png ',
    })
    expect(result.errors).toBeUndefined()
    expect(result.value).toEqual({
      site_name: '新商城',
      site_description: '精选好物',
      site_logo_url: '/uploads/logo.png',
      site_favicon_url: 'https://example.com/favicon.png',
    })
  })

  it('拒绝空网站名称和危险图片协议', () => {
    const result = validateSystemSettings({
      site_name: ' ',
      site_description: '',
      site_logo_url: 'data:image/svg+xml;base64,PHN2Zz4=',
      site_favicon_url: 'javascript:alert(1)',
    })
    expect(result.errors).toEqual(expect.arrayContaining([
      '网站名称不能为空',
      '网站 Logo 地址必须是 http(s) 链接或 /uploads/ 路径',
      '网站图标地址必须是 http(s) 链接或 /uploads/ 路径',
    ]))
  })
})

describe('zod 请求边界校验', () => {
  const validSku = { name: '默认规格', price: 9.9, stock: 2 }
  const validProduct = {
    name: '测试商品',
    description: '',
    category: '测试',
    price: 9.9,
    stock: 2,
    status: 'on',
    images: [],
    skus: [validSku],
  }

  it('拒绝商品与 SKU 的小数库存及残缺数字字符串', () => {
    expect(validateProduct({ ...validProduct, stock: '1.9' }).errors).toContain('库存必须是不小于 0 的整数')
    expect(validateProduct({ ...validProduct, stock: '1abc' }).errors).toContain('库存必须是不小于 0 的整数')
    expect(validateProduct({ ...validProduct, skus: [{ ...validSku, stock: '1.9' }] }).errors).toContain(
      '规格 1 库存必须是不小于 0 的整数'
    )
  })

  it('规范化有效数字字符串并将 SKU 价格保留两位小数', () => {
    const result = validateProduct({
      ...validProduct,
      price: '9.90',
      stock: '2',
      skus: [{ ...validSku, price: '1.235', stock: '2' }],
    })
    expect(result.errors).toBeUndefined()
    expect(result.value?.price).toBe(9.9)
    expect(result.value?.stock).toBe(2)
    expect(result.value?.skus[0]?.price).toBe(1.24)
  })

  it.each([null, 'text', 42, []])('非对象请求体返回校验错误而不抛异常：%j', (body) => {
    expect(() => validateCartAdd(body)).not.toThrow()
    expect(validateCartAdd(body).errors?.length).toBeGreaterThan(0)
  })

  it('校验库存调整为范围内的非零整数', () => {
    expect(validateStockDelta({ delta: '-2' }).value).toEqual({ delta: -2 })
    for (const delta of [0, 1.5, '1.5', 1000000, null, '']) {
      expect(validateStockDelta({ delta }).errors).toEqual(['调整量必须是非零整数，且绝对值不超过 999999'])
    }
  })

  it('规范化地址并校验手机号', () => {
    const address = {
      receiver: ' 张三 ',
      phone: '13800138000',
      province: ' 浙江省 ',
      city: ' 杭州市 ',
      district: ' 西湖区 ',
      detail: ' 文一路 1 号 ',
      is_default: 1,
    }
    expect(validateAddress(address).value).toEqual({
      receiver: '张三',
      phone: '13800138000',
      province: '浙江省',
      city: '杭州市',
      district: '西湖区',
      detail: '文一路 1 号',
      is_default: true,
    })
    expect(validateAddress({ ...address, phone: '123' }).errors).toEqual(['手机号格式不正确'])
  })

  it('校验资料至少包含一个有效字段', () => {
    expect(validateProfile({}).errors).toContain('没有需要更新的字段')
    expect(validateProfile({ nick_name: ' 新昵称 ' }).value).toEqual({ nick_name: '新昵称' })
    expect(validateProfile({ avatar_url: 'file:///etc/passwd' }).errors).toContain(
      '头像地址必须是 http(s) 链接或 /uploads/ 路径'
    )
  })

  it('校验并规范化购物车数字字段', () => {
    expect(validateCartAdd({ product_id: '1', sku_id: '2', quantity: '3' }).value).toEqual({
      product_id: 1,
      sku_id: 2,
      quantity: 3,
    })
    expect(validateCartAdd({ product_id: '1.5', sku_id: 0, quantity: 100 }).errors).toEqual(
      expect.arrayContaining(['商品 ID 不合法', '规格 ID 不合法', '数量必须是 1~99 的整数'])
    )
    expect(validateCartQuantity({ quantity: '1.5' }).errors).toEqual(['数量必须是 1~99 的整数'])
  })

  it('校验直接购买并规范化备注与数字字段', () => {
    const result = validateOrderCreate({
      source: { type: 'direct', product_id: '1', sku_id: '2', quantity: '3' },
      address_id: '4',
      remark: ' 尽快发货 ',
    })
    expect(result.errors).toBeUndefined()
    expect(result.value).toEqual({
      source: { type: 'direct', product_id: 1, sku_id: 2, quantity: 3 },
      address_id: 4,
      remark: '尽快发货',
    })
    expect(validateOrderCreate({
      source: { type: 'cart', item_ids: ['1.5'] },
      address_id: 1,
    }).errors).toContain('购物车选中项不合法')
  })
})
