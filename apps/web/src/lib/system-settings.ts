import type { SystemSettings, SystemSettingsInput } from '@weshop/shared'
import { createContext, use } from 'react'

export interface SystemSettingsContextValue {
  settings: SystemSettings
  loading: boolean
  error: string
  refresh: () => Promise<void>
  saveSettings: (input: SystemSettingsInput) => Promise<SystemSettings>
  saveSettingsAsDefaults: (input: SystemSettingsInput) => Promise<SystemSettings>
  restoreSettingsDefaults: () => Promise<SystemSettings>
}

export const SystemSettingsContext = createContext<SystemSettingsContextValue | null>(null)

export function useSystemSettings(): SystemSettingsContextValue {
  const context = use(SystemSettingsContext)
  if (!context) {
    throw new Error('useSystemSettings 必须在 SystemSettingsProvider 内使用')
  }
  return context
}

/** 将公开的站点品牌信息同步到浏览器标题、简介与 favicon */
export function applySystemSettings(settings: SystemSettings): void {
  document.title = `${settings.site_name} 管理后台`

  let description = document.querySelector<HTMLMetaElement>('meta[name="description"]')
  if (!description) {
    description = document.createElement('meta')
    description.name = 'description'
    document.head.appendChild(description)
  }
  description.content = settings.site_description

  let favicon = document.querySelector<HTMLLinkElement>('link[data-system-settings="favicon"]')
  if (!settings.site_favicon_url) {
    favicon?.remove()
    return
  }
  if (!favicon) {
    favicon = document.createElement('link')
    favicon.dataset.systemSettings = 'favicon'
    favicon.rel = 'icon'
    document.head.appendChild(favicon)
  }
  favicon.href = settings.site_favicon_url
}
