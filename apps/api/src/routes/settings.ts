import { Router } from 'express'
import type { SystemSettings } from '@weshop/shared'
import { DEFAULT_SYSTEM_SETTINGS } from '@weshop/shared'
import { requireAdmin } from '../auth.js'
import { db, inTransaction } from '../db.js'
import { validateSystemSettings } from '../validate.js'

const SETTING_KEYS = Object.keys(DEFAULT_SYSTEM_SETTINGS) as Array<keyof SystemSettings>
type SettingsTable = 'system_settings' | 'system_setting_defaults'

function readSettings(table: SettingsTable): SystemSettings {
  const settings = { ...DEFAULT_SYSTEM_SETTINGS }
  const placeholders = SETTING_KEYS.map(() => '?').join(',')
  const rows = db
    .prepare(`SELECT key, value FROM ${table} WHERE key IN (${placeholders})`)
    .all(...SETTING_KEYS) as unknown as Array<{ key: keyof SystemSettings, value: string }>
  const stored = new Map(rows.map(row => [row.key, row.value]))
  for (const key of SETTING_KEYS) settings[key] = stored.get(key) ?? settings[key]
  return settings
}

function writeSettings(table: SettingsTable, settings: SystemSettings): void {
  inTransaction(() => {
    const statement = db.prepare(
      `INSERT INTO ${table} (key, value, updated_at)
       VALUES (?, ?, datetime('now','localtime'))
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`
    )
    for (const key of SETTING_KEYS) statement.run(key, settings[key])
  })
}

export const settingsRouter = Router()

/** 公开读取站点品牌信息，供登录页、小程序等客户端使用 */
settingsRouter.get('/', (_req, res) => {
  res.json({ settings: readSettings('system_settings') })
})

/** 读取默认配置快照；尚未设置时回退到代码内置配置 */
settingsRouter.get('/defaults', requireAdmin, (_req, res) => {
  res.json({ defaults: readSettings('system_setting_defaults') })
})

/** 全量更新当前系统设置，仅管理员可操作 */
settingsRouter.put('/', requireAdmin, (req, res) => {
  const result = validateSystemSettings(req.body)
  if (result.errors) return res.status(400).json({ errors: result.errors })

  writeSettings('system_settings', result.value)
  res.json({ settings: readSettings('system_settings') })
})

/** 把请求中的已保存配置写入默认快照，不修改当前设置 */
settingsRouter.put('/defaults', requireAdmin, (req, res) => {
  const result = validateSystemSettings(req.body)
  if (result.errors) return res.status(400).json({ errors: result.errors })

  writeSettings('system_setting_defaults', result.value)
  res.json({ defaults: readSettings('system_setting_defaults') })
})

/** 用最近的默认快照覆盖当前设置；从未保存快照时恢复内置配置 */
settingsRouter.post('/restore-defaults', requireAdmin, (_req, res) => {
  const defaults = readSettings('system_setting_defaults')
  writeSettings('system_settings', defaults)
  res.json({ settings: readSettings('system_settings') })
})
