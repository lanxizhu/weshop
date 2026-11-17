export class KeyedSerialQueue {
  private tails = new Map<string | number, Promise<unknown>>()

  run<T>(key: string | number, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve()
    const result = previous.catch(() => {}).then(task)
    this.tails.set(key, result)

    const cleanup = () => {
      if (this.tails.get(key) === result)
        this.tails.delete(key)
    }
    result.then(cleanup, cleanup)
    return result
  }
}
