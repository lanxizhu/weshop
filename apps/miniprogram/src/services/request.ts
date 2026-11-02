import Taro from '@tarojs/taro'

export const TOKEN_KEY = 'weshop_token'
export const USER_KEY = 'weshop_user'

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface RequestOptions {
  method?: HttpMethod
  data?: Record<string, unknown>
}

/**
 * 统一请求入口。
 * - 自动携带登录令牌（storage 中的 weshop_token）
 * - 401：清除本地登录态并抛「请先登录」
 * - 403：账号被禁用，统一 toast 提示（页面无需各自处理）
 * - 错误归一化与 web 端文案一致：
 *   服务端 { errors: [...] } → 拼接为「；」分隔；网络层失败 → 「服务连接失败」
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', data } = options
  const token = Taro.getStorageSync(TOKEN_KEY)
  let res: Taro.request.SuccessCallbackResult<T | { errors?: unknown }>
  try {
    res = await Taro.request({
      url: `${API_BASE}/api${path}`,
      method,
      data,
      timeout: 15000,
      header: {
        'content-type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
  }
  catch {
    throw new Error('服务连接失败，恢复后请重试')
  }
  if (res.statusCode === 401) {
    Taro.removeStorageSync(TOKEN_KEY)
    Taro.removeStorageSync(USER_KEY)
    throw new Error('请先登录')
  }
  if (res.statusCode === 403)
    Taro.showToast({ title: '账号已被禁用', icon: 'none' })
  if (res.statusCode >= 200 && res.statusCode < 300)
    return res.data as T
  const errors = (res.data as { errors?: unknown }).errors
  if (Array.isArray(errors))
    throw new Error(errors.map(String).join('；'))
  throw new Error('请求失败，请重试')
}

/**
 * 统一上传入口（multipart 表单），与服务端 uploads 路由约定一致：
 * 字段名固定 file，成功（201）返回 { url }，失败返回 { errors: [...] }。
 * 令牌携带、401 清登录态、403 提示、错误归一化规则均与 request() 保持一致；
 * 区别在于 uploadFile 的响应体是字符串，需要自行 JSON.parse。
 */
export async function uploadFile<T>(path: string, filePath: string, name = 'file'): Promise<T> {
  const token = Taro.getStorageSync(TOKEN_KEY)
  let res: Taro.uploadFile.SuccessCallbackResult
  try {
    res = await Taro.uploadFile({
      url: `${API_BASE}/api${path}`,
      filePath,
      name,
      header: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
  }
  catch {
    throw new Error('服务连接失败，恢复后请重试')
  }
  if (res.statusCode === 401) {
    Taro.removeStorageSync(TOKEN_KEY)
    Taro.removeStorageSync(USER_KEY)
    throw new Error('请先登录')
  }
  if (res.statusCode === 403)
    Taro.showToast({ title: '账号已被禁用', icon: 'none' })
  let body: T | { errors?: unknown }
  try {
    body = JSON.parse(res.data) as T | { errors?: unknown }
  }
  catch {
    throw new Error('服务响应异常，请重试')
  }
  if (res.statusCode >= 200 && res.statusCode < 300)
    return body as T
  const errors = (body as { errors?: unknown }).errors
  if (Array.isArray(errors))
    throw new Error(errors.map(String).join('；'))
  throw new Error('请求失败，请重试')
}
