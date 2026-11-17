import type { RequestHandler } from 'express'

interface RateLimitOptions {
  windowMs: number
  max: number
  message: string
}

interface Bucket {
  count: number
  resetAt: number
}

/** 进程内固定窗口限流：按真实客户端 IP 计数，并返回剩余额度与重试秒数 */
function createRateLimit({ windowMs, max, message }: RateLimitOptions): RequestHandler {
  const buckets = new Map<string, Bucket>()
  const cleanup = setInterval(() => {
    const now = Date.now()
    for (const [ip, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(ip)
    }
  }, windowMs)
  cleanup.unref()

  return (req, res, next) => {
    const now = Date.now()
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown'
    let bucket = buckets.get(ip)
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs }
      buckets.set(ip, bucket)
    }
    bucket.count += 1

    res.setHeader('RateLimit-Limit', String(max))
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - bucket.count)))
    res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)))
    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
      res.setHeader('Retry-After', String(retryAfter))
      res.status(429).json({ errors: [message] })
      return
    }
    next()
  }
}

export const loginRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: '登录尝试过于频繁，请稍后重试',
})

export const orderCreateRateLimit = createRateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  message: '下单请求过于频繁，请稍后重试',
})

export const uploadRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: '上传请求过于频繁，请稍后重试',
})
