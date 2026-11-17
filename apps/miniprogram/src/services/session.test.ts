import Taro from '@tarojs/taro'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { logout } from './auth'
import { initializeCartBadge } from './cart'
import { request, TOKEN_KEY, uploadFile, USER_KEY } from './request'
import { getTabbarState, setCartBadge } from './tabbar'

vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync: vi.fn(),
    removeStorageSync: vi.fn(),
    setStorageSync: vi.fn(),
    request: vi.fn(),
    uploadFile: vi.fn(),
    showToast: vi.fn(),
  },
}))

const taro = vi.mocked(Taro)

describe('登录态清理与购物车角标', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('API_BASE', 'http://api.test')
    setCartBadge(0)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('退出登录清除令牌、用户缓存和角标', () => {
    setCartBadge(6)
    logout()

    expect(taro.removeStorageSync).toHaveBeenCalledWith(TOKEN_KEY)
    expect(taro.removeStorageSync).toHaveBeenCalledWith(USER_KEY)
    expect(getTabbarState().cartCount).toBe(0)
  })

  it('请求 401 清除登录态和角标', async () => {
    setCartBadge(6)
    taro.request.mockResolvedValue({ statusCode: 401, data: {} } as Taro.request.SuccessCallbackResult)

    await expect(request('/auth/me')).rejects.toThrow('请先登录')
    expect(taro.removeStorageSync).toHaveBeenCalledWith(TOKEN_KEY)
    expect(taro.removeStorageSync).toHaveBeenCalledWith(USER_KEY)
    expect(getTabbarState().cartCount).toBe(0)
  })

  it('上传 401 也清除登录态和角标', async () => {
    setCartBadge(6)
    taro.uploadFile.mockResolvedValue({ statusCode: 401, data: '{}' } as Taro.uploadFile.SuccessCallbackResult)

    await expect(uploadFile('/uploads', '/tmp/avatar.png')).rejects.toThrow('请先登录')
    expect(taro.removeStorageSync).toHaveBeenCalledWith(TOKEN_KEY)
    expect(taro.removeStorageSync).toHaveBeenCalledWith(USER_KEY)
    expect(getTabbarState().cartCount).toBe(0)
  })

  it('无令牌冷启动清零残留角标且不请求购物车', () => {
    taro.getStorageSync.mockReturnValue('')
    setCartBadge(6)
    initializeCartBadge()

    expect(getTabbarState().cartCount).toBe(0)
    expect(taro.request).not.toHaveBeenCalled()
  })
})
