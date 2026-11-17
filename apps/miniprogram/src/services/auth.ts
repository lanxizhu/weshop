import type { LoginResult, ProfileInput, User } from '@weshop/shared'
import Taro from '@tarojs/taro'
import { clearSession, request, TOKEN_KEY, USER_KEY } from './request'

export function getToken(): string {
  return Taro.getStorageSync(TOKEN_KEY) || ''
}

export function getCachedUser(): User | null {
  const u = Taro.getStorageSync(USER_KEY)
  return u ? (u as User) : null
}

function saveSession(token: string, user: User): void {
  Taro.setStorageSync(TOKEN_KEY, token)
  Taro.setStorageSync(USER_KEY, user)
}

/** 微信登录：wx.login 拿 code → 后端换 openid → 存令牌与用户信息 */
export async function login(): Promise<User> {
  const { code } = await Taro.login()
  if (!code)
    throw new Error('微信登录失败，请重试')
  const res = await request<LoginResult>('/auth/login', { method: 'POST', data: { code } })
  saveSession(res.token, res.user)
  return res.user
}

/** 拉取最新用户信息并刷新本地缓存 */
export async function fetchMe(): Promise<User> {
  const { user } = await request<{ user: User }>('/auth/me')
  Taro.setStorageSync(USER_KEY, user)
  return user
}

/** 更新昵称 / 头像并刷新缓存 */
export async function updateProfile(input: ProfileInput): Promise<User> {
  const data: Record<string, unknown> = {}
  if (input.nick_name !== undefined)
    data.nick_name = input.nick_name
  if (input.avatar_url !== undefined)
    data.avatar_url = input.avatar_url
  const { user } = await request<{ user: User }>('/auth/me', { method: 'PUT', data })
  Taro.setStorageSync(USER_KEY, user)
  return user
}

export function logout(): void {
  clearSession()
}

/**
 * 确保已登录：有令牌则校验并刷新用户信息，否则走登录流程。
 * 令牌失效（401）时 request 已清除本地态，这里会重新登录。
 */
export async function ensureLogin(): Promise<User> {
  if (getToken()) {
    try {
      return await fetchMe()
    }
    catch (err) {
      if (err instanceof Error && err.message !== '请先登录')
        throw err
    }
  }
  return login()
}
