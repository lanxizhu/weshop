import { describe, expect, it } from 'vitest'
import { LatestRequest } from './latest-request'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('latestRequest', () => {
  it('旧请求延迟返回时只允许最新结果写入', async () => {
    const guard = new LatestRequest()
    const firstResponse = deferred<string>()
    const secondResponse = deferred<string>()
    let value = ''

    async function load(id: number, response: Promise<string>) {
      const result = await response
      if (guard.isLatest(id))
        value = result
    }

    const first = load(guard.next(), firstResponse.promise)
    const second = load(guard.next(), secondResponse.promise)
    secondResponse.resolve('新结果')
    await second
    firstResponse.resolve('旧结果')
    await first

    expect(value).toBe('新结果')
  })

  it('卸载失效后忽略全部在途结果', () => {
    const guard = new LatestRequest()
    const id = guard.next()
    guard.invalidate()
    expect(guard.isLatest(id)).toBe(false)
  })
})
