import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useLatestRequest } from './use-latest-request'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('useLatestRequest', () => {
  it('旧请求后完成时返回 undefined，只保留最新结果', async () => {
    const { result } = renderHook(() => useLatestRequest())
    const first = deferred<string>()
    const second = deferred<string>()

    const firstResult = result.current(() => first.promise)
    const secondResult = result.current(() => second.promise)
    second.resolve('新结果')
    await expect(secondResult).resolves.toBe('新结果')
    first.resolve('旧结果')
    await expect(firstResult).resolves.toBeUndefined()
  })

  it('卸载后忽略在途结果', async () => {
    const { result, unmount } = renderHook(() => useLatestRequest())
    const response = deferred<string>()
    const pending = result.current(() => response.promise)

    unmount()
    response.resolve('旧结果')
    await expect(pending).resolves.toBeUndefined()
  })
})
