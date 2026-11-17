import { useCallback, useEffect, useRef } from 'react'

/** 只接收最后一次请求的结果；组件卸载后忽略全部在途请求 */
export function useLatestRequest() {
  const requestIdRef = useRef(0)

  useEffect(() => () => {
    requestIdRef.current += 1
  }, [])

  return useCallback(async <T>(request: () => Promise<T>): Promise<T | undefined> => {
    const id = ++requestIdRef.current
    try {
      const result = await request()
      return id === requestIdRef.current ? result : undefined
    }
    catch (error) {
      if (id === requestIdRef.current)
        throw error
      return undefined
    }
  }, [])
}
