import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DEFAULT_SYSTEM_SETTINGS } from '@weshop/shared'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { uploadImage } from '@/lib/api'
import { useSystemSettings } from '@/lib/system-settings'
import SystemSettingsPage from './SystemSettings'

vi.mock('@/lib/api', () => ({
  uploadImage: vi.fn(),
}))

vi.mock('@/lib/system-settings', () => ({
  useSystemSettings: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const saveSettings = vi.fn()
const saveSettingsAsDefaults = vi.fn()
const restoreSettingsDefaults = vi.fn()

beforeEach(() => {
  vi.resetAllMocks()
  saveSettings.mockImplementation(async input => input)
  saveSettingsAsDefaults.mockImplementation(async input => input)
  restoreSettingsDefaults.mockResolvedValue({ ...DEFAULT_SYSTEM_SETTINGS })
  vi.mocked(useSystemSettings).mockReturnValue({
    settings: { ...DEFAULT_SYSTEM_SETTINGS },
    loading: false,
    error: '',
    refresh: vi.fn(),
    saveSettings,
    saveSettingsAsDefaults,
    restoreSettingsDefaults,
  })
})

describe('system settings page', () => {
  it('规范化并保存网站名称、简介和 Logo', async () => {
    render(<SystemSettingsPage />)

    expect(screen.getByLabelText('网站名称 *')).toHaveValue('WeShop')
    fireEvent.change(screen.getByLabelText('网站名称 *'), { target: { value: '  新商城  ' } })
    fireEvent.change(screen.getByLabelText('网站简介'), { target: { value: '  精选好物  ' } })
    fireEvent.change(screen.getByLabelText('网站 Logo'), { target: { value: ' /uploads/logo.png ' } })
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))

    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({
      site_name: '新商城',
      site_description: '精选好物',
      site_logo_url: '/uploads/logo.png',
      site_favicon_url: '',
    }))
    expect(toast.success).toHaveBeenCalledWith('系统设置已保存并生效')
  })

  it('上传 favicon 后随设置一起保存', async () => {
    vi.mocked(uploadImage).mockResolvedValue('/uploads/favicon.png')
    render(<SystemSettingsPage />)

    const file = new File(['png'], 'favicon.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('上传浏览器 favicon'), { target: { files: [file] } })

    await waitFor(() => expect(uploadImage).toHaveBeenCalledWith(file))
    await waitFor(() => expect(screen.getByLabelText('浏览器 favicon')).toHaveValue('/uploads/favicon.png'))
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      site_favicon_url: '/uploads/favicon.png',
    })))
  })

  it('把已保存的当前设置保存为默认配置', async () => {
    render(<SystemSettingsPage />)

    fireEvent.click(screen.getByRole('button', { name: '将当前设置存为默认' }))
    expect(screen.getByText('保存为默认配置？')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认保存' }))

    await waitFor(() => expect(saveSettingsAsDefaults).toHaveBeenCalledWith(DEFAULT_SYSTEM_SETTINGS))
    expect(toast.success).toHaveBeenCalledWith('已将当前设置保存为默认配置')
  })

  it('确认后恢复默认配置并丢弃未保存修改', async () => {
    const restored = { ...DEFAULT_SYSTEM_SETTINGS, site_name: '默认商城' }
    restoreSettingsDefaults.mockResolvedValue(restored)
    render(<SystemSettingsPage />)

    fireEvent.change(screen.getByLabelText('网站名称 *'), { target: { value: '未保存修改' } })
    fireEvent.click(screen.getByRole('button', { name: '恢复默认设置' }))
    expect(screen.getByText('恢复默认设置？')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认恢复' }))

    await waitFor(() => expect(restoreSettingsDefaults).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByLabelText('网站名称 *')).toHaveValue('默认商城'))
    expect(toast.success).toHaveBeenCalledWith('已恢复默认设置')
  })
})
