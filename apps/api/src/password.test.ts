import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from './password.js'

describe('password', () => {
  it('异步哈希保留既有格式并支持正确密码校验', async () => {
    const stored = await hashPassword('admin123')

    expect(stored).toMatch(/^scrypt:[\w-]+:[\w-]+$/)
    await expect(verifyPassword('admin123', stored)).resolves.toBe(true)
    await expect(verifyPassword('wrong-password', stored)).resolves.toBe(false)
  })

  it('拒绝格式错误或空哈希', async () => {
    await expect(verifyPassword('admin123', 'invalid')).resolves.toBe(false)
    await expect(verifyPassword('admin123', 'scrypt:c2FsdA==')).resolves.toBe(false)
  })

  it('并发校验期间事件循环仍可处理定时任务', async () => {
    const stored = await hashPassword('admin123')
    let ticks = 0
    const timer = setInterval(() => {
      ticks += 1
    }, 5)
    try {
      const results = await Promise.all(Array.from({ length: 4 }, () => verifyPassword('admin123', stored)))
      expect(results).toEqual([true, true, true, true])
      expect(ticks).toBeGreaterThan(0)
    }
    finally {
      clearInterval(timer)
    }
  })
})
