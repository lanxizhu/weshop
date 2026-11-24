import { Router } from 'express'
import type { SystemSettings } from '@weshop/shared'
import { DEFAULT_SYSTEM_SETTINGS } from '@weshop/shared'
import { requireAdmin } from '../auth.js'
import { db, inTransaction } from '../db.js'
import { validateSystemSettings } from '../validate.js'

const SETTING_KEYS = Object.keys(DEFAULT_SYSTEM_SETTINGS) as Array<keyof SystemSettings>
type SettingsTable = 'system_settings' | 'system_setting_defaults'

async function readSettings(table: SettingsTable): Promise<SystemSettings> {
  const settings = { ...DEFAULT_SYSTEM_SETTINGS }
  const placeholders = SETTING_KEYS.map(() => '?').join(',')
  const rows = await db.prepare(
    `SELECT \`key\`, value FROM ${table} WHERE \`key\` IN (${placeholders})`,
  ).all<{ key: keyof SystemSettings, value: string }>(...SETTING_KEYS)
  const stored = new Map(rows.map((row) => [row.key, row.value]))
  for (const key of SETTING_KEYS) settings[key] = stored.get(key) ?? settings[key]
  return settings
}

async function writeSettings(table: SettingsTable, settings: SystemSettings): Promise<void> {
  await inTransaction(async () => {
    const statement = db.prepare(
      `INSERT INTO ${table} (\`key\`, value, updated_at)
       VALUES (?, ?, NOW())
       ON DUPLICATE KEY UPDATE value=VALUES(value), updated_at=VALUES(updated_at)`,
    )
    for (const key of SETTING_KEYS) await statement.run(key, settings[key])
  })
}

export const settingsRouter = Router()

/** 公开读取站点品牌信息，供登录页、小程序等客户端使用 */
settingsRouter.get('/', async (_req, res) => {
  res.json({ settings: await readSettings('system_settings') })
})

/** 读取默认配置快照；尚未设置时回退到代码内置配置 */
settingsRouter.get('/defaults', requireAdmin, async (_req, res) => {
  res.json({ defaults: await readSettings('system_setting_defaults') })
})

/** 全量更新当前系统设置，仅管理员可操作 */
settingsRouter.put('/', requireAdmin, async (req, res) => {
  const result = validateSystemSettings(req.body)
  if (result.errors) return res.status(400).json({ errors: result.errors })

  await writeSettings('system_settings', result.value)
  res.json({ settings: await readSettings('system_settings') })
})

/** 把请求中的已保存配置写入默认快照，不修改当前设置 */
settingsRouter.put('/defaults', requireAdmin, async (req, res) => {
  const result = validateSystemSettings(req.body)
  if (result.errors) return res.status(400).json({ errors: result.errors })

  await writeSettings('system_setting_defaults', result.value)
  res.json({ defaults: await readSettings('system_setting_defaults') })
})

/** 用最近的默认快照覆盖当前设置；从未保存快照时恢复内置配置 */
settingsRouter.post('/restore-defaults', requireAdmin, async (_req, res) => {
  const defaults = await readSettings('system_setting_defaults')
  await writeSettings('system_settings', defaults)
  res.json({ settings: await readSettings('system_settings') })
})
