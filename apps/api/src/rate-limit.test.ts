import type { Request, Response } from 'express'
import { describe, expect, it, vi } from 'vitest'
import { loginRateLimit } from './rate-limit.js'

function mockRequest(ip: string): Request {
  return { ip, socket: { remoteAddress: ip } } as unknown as Request
}

function mockResponse() {
  const res = {
    setHeader: vi.fn(),
    status: vi.fn(),
    json: vi.fn(),
  }
  res.status.mockReturnValue(res)
  res.json.mockReturnValue(res)
  return res
}

describe('loginRateLimit', () => {
  it('允许窗口额度内请求，超限返回 429 与 Retry-After', () => {
    const ip = '203.0.113.250'
    const next = vi.fn()
    const res = mockResponse()

    for (let i = 0; i < 10; i++)
      loginRateLimit(mockRequest(ip), res as unknown as Response, next)

    expect(next).toHaveBeenCalledTimes(10)
    expect(res.setHeader).toHaveBeenCalledWith('RateLimit-Remaining', '0')

    loginRateLimit(mockRequest(ip), res as unknown as Response, next)
    expect(next).toHaveBeenCalledTimes(10)
    expect(res.status).toHaveBeenCalledWith(429)
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String))
    expect(res.json).toHaveBeenCalledWith({ errors: ['登录尝试过于频繁，请稍后重试'] })

    loginRateLimit(mockRequest('203.0.113.251'), res as unknown as Response, next)
    expect(next).toHaveBeenCalledTimes(11)
  })
})
