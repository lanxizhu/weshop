import Taro from '@tarojs/taro'

/** 请求层已经提示过的错误，页面层收到后不再重复 toast */
export class HandledToastError extends Error {}

export function toast(value: unknown, fallback = '操作失败') {
  if (value instanceof HandledToastError)
    return
  const message = value instanceof Error ? value.message : typeof value === 'string' ? value : fallback
  if (message)
    Taro.showToast({ title: message, icon: 'none' })
}
