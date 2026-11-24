import type { SystemSettings } from '@weshop/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { applySystemSettings } from './system-settings'

const SETTINGS: SystemSettings = {
  site_name: '测试商城',
  site_description: '测试站点简介',
  site_logo_url: '/uploads/logo.png',
  site_favicon_url: '/uploads/favicon.png',
}

afterEach(() => {
  document.querySelector('meta[name="description"]')?.remove()
  document.querySelector('link[data-system-settings="favicon"]')?.remove()
})

describe('applySystemSettings', () => {
  it('创建、更新并清除浏览器站点信息', () => {
    applySystemSettings(SETTINGS)

    expect(document.title).toBe('测试商城 管理后台')
    expect(document.querySelector('meta[name="description"]')).toHaveAttribute('content', '测试站点简介')
    const initial = document.querySelector('link[data-system-settings="favicon"]')
    expect(initial).toHaveAttribute('rel', 'icon')
    expect(initial).toHaveAttribute('href', '/uploads/favicon.png')

    applySystemSettings({ ...SETTINGS, site_name: '新商城', site_favicon_url: 'https://example.com/new-icon.png' })
    const updated = document.querySelector('link[data-system-settings="favicon"]')
    expect(document.title).toBe('新商城 管理后台')
    expect(updated).toBe(initial)
    expect(updated).toHaveAttribute('href', 'https://example.com/new-icon.png')

    applySystemSettings({ ...SETTINGS, site_favicon_url: '' })
    expect(document.querySelector('link[data-system-settings="favicon"]')).not.toBeInTheDocument()
  })
})
