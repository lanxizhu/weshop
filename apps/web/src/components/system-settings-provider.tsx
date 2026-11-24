import type { SystemSettings, SystemSettingsInput } from '@weshop/shared'
import type { PropsWithChildren } from 'react'
import type { SystemSettingsContextValue } from '@/lib/system-settings'
import { DEFAULT_SYSTEM_SETTINGS } from '@weshop/shared'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchSystemSettings,
  restoreSystemSettingsDefaults,
  updateSystemSettings,
  updateSystemSettingsDefaults,
} from '@/lib/api'
import { applySystemSettings, SystemSettingsContext } from '@/lib/system-settings'

export function SystemSettingsProvider({ children }: PropsWithChildren) {
  const [settings, setSettings] = useState<SystemSettings>({ ...DEFAULT_SYSTEM_SETTINGS })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await fetchSystemSettings()
      setSettings(result.settings)
    }
    catch (e) {
      setError(e instanceof Error ? e.message : '系统设置加载失败')
    }
    finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    applySystemSettings(settings)
  }, [settings])

  const saveSettings = useCallback(async (input: SystemSettingsInput) => {
    const result = await updateSystemSettings(input)
    setSettings(result.settings)
    return result.settings
  }, [])

  const saveSettingsAsDefaults = useCallback(async (input: SystemSettingsInput) => {
    const result = await updateSystemSettingsDefaults(input)
    return result.defaults
  }, [])

  const restoreSettingsDefaults = useCallback(async () => {
    const result = await restoreSystemSettingsDefaults()
    setSettings(result.settings)
    return result.settings
  }, [])

  const value = useMemo<SystemSettingsContextValue>(() => ({
    settings,
    loading,
    error,
    refresh,
    saveSettings,
    saveSettingsAsDefaults,
    restoreSettingsDefaults,
  }), [settings, loading, error, refresh, saveSettings, saveSettingsAsDefaults, restoreSettingsDefaults])

  return <SystemSettingsContext value={value}>{children}</SystemSettingsContext>
}
