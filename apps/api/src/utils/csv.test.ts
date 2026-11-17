import { describe, expect, it } from 'vitest'
import { escapeCsvCell } from './csv.js'

describe('escapeCsvCell', () => {
  it('包装普通值并处理空值', () => {
    expect(escapeCsvCell('商品')).toBe('"商品"')
    expect(escapeCsvCell(null)).toBe('""')
    expect(escapeCsvCell(undefined)).toBe('""')
  })

  it('将单元格内双引号加倍', () => {
    expect(escapeCsvCell(' say "hello" ')).toBe('" say ""hello"" "')
  })

  it.each(['=1+1', '+1', '-1', '@SUM(A1:A2)', '  =1+1'])('阻止公式前缀：%s', (value) => {
    expect(escapeCsvCell(value)).toBe(`"'${value}"`)
  })
})
