import { describe, expect, it } from 'vitest'
import { sanitizeRequestUrl } from './sanitize-url.js'

describe('sanitizeRequestUrl', () => {
  it('保留路径和查询参数名，隐藏全部参数值', () => {
    const sanitized = sanitizeRequestUrl('/api/orders?receiver=张三&phone=13800138000&receiver=李四')
    expect(sanitized).toBe('/api/orders?receiver=%5Bredacted%5D&phone=%5Bredacted%5D')
    expect(sanitized).not.toContain('张三')
    expect(sanitized).not.toContain('13800138000')
  })

  it('无查询参数时保留原路径', () => {
    expect(sanitizeRequestUrl('/api/products?page=2')).toBe('/api/products?page=%5Bredacted%5D')
    expect(sanitizeRequestUrl('/api/healthy')).toBe('/api/healthy')
  })
})
