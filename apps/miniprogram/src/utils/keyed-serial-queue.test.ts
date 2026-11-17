import { describe, expect, it, vi } from 'vitest'
import { KeyedSerialQueue } from './keyed-serial-queue'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('keyedSerialQueue', () => {
  it('同一行连续修改按提交顺序执行，不同行可以并行', async () => {
    const queue = new KeyedSerialQueue()
    const firstResponse = deferred()
    const update = vi.fn((id: number, quantity: number) => {
      if (id === 1 && quantity === 2)
        return firstResponse.promise
      return Promise.resolve()
    })

    const first = queue.run(1, () => update(1, 2))
    const second = queue.run(1, () => update(1, 3))
    const other = queue.run(2, () => update(2, 4))

    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(2))
    expect(update.mock.calls).toEqual([[1, 2], [2, 4]])

    firstResponse.resolve()
    await Promise.all([first, second, other])
    expect(update.mock.calls).toEqual([[1, 2], [2, 4], [1, 3]])
  })

  it('前一次失败不会阻断同一行的后续修改', async () => {
    const queue = new KeyedSerialQueue()
    await expect(queue.run(1, () => Promise.reject(new Error('失败')))).rejects.toThrow('失败')
    await expect(queue.run(1, () => Promise.resolve('成功'))).resolves.toBe('成功')
  })
})
