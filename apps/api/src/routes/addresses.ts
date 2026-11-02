import { Router } from 'express'
import type { Address } from '@weshop/shared'
import { MAX_ADDRESSES_PER_USER } from '@weshop/shared'
import { requireAuth } from '../auth.js'
import { db, inTransaction } from '../db.js'
import { validateAddress } from '../validate.js'

export const addressesRouter = Router()

// 地址全部接口都需要登录，uid 取自令牌而非请求参数
addressesRouter.use(requireAuth)

function listAddresses(uid: number): Address[] {
  return db
    .prepare('SELECT * FROM addresses WHERE user_id=? ORDER BY is_default DESC, id DESC')
    .all(uid) as unknown as Address[]
}

/** 仅按「归属当前用户」查询地址，防止越权读写他人地址 */
function getOwnedAddress(uid: number, id: number | string): Address | undefined {
  return db.prepare('SELECT * FROM addresses WHERE id=? AND user_id=?').get(id, uid) as Address | undefined
}

/** 地址列表（默认地址在前，其余按创建倒序） */
addressesRouter.get('/', (_req, res) => {
  res.json({ addresses: listAddresses(res.locals.uid as number) })
})

/** 新建地址：首条自动设为默认；显式设默认时清掉旧默认 */
addressesRouter.post('/', (req, res) => {
  const uid = res.locals.uid as number
  const result = validateAddress(req.body)
  if (result.errors) return res.status(400).json({ errors: result.errors })

  const { n } = db.prepare('SELECT COUNT(*) AS n FROM addresses WHERE user_id=?').get(uid) as { n: number }
  if (n >= MAX_ADDRESSES_PER_USER) {
    return res.status(400).json({ errors: [`地址最多保存 ${MAX_ADDRESSES_PER_USER} 条`] })
  }

  const input = result.value
  const isDefault = input.is_default || n === 0
  const address = inTransaction(() => {
    if (isDefault) db.prepare('UPDATE addresses SET is_default=0 WHERE user_id=?').run(uid)
    const r = db
      .prepare(
        `INSERT INTO addresses (user_id, receiver, phone, province, city, district, detail, is_default)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(uid, input.receiver, input.phone, input.province, input.city, input.district, input.detail, isDefault ? 1 : 0)
    return getOwnedAddress(uid, Number(r.lastInsertRowid))!
  })
  res.status(201).json({ address })
})

/** 更新地址（全量字段） */
addressesRouter.put('/:id', (req, res) => {
  const uid = res.locals.uid as number
  const existing = getOwnedAddress(uid, req.params.id)
  if (!existing) return res.status(404).json({ errors: ['地址不存在'] })

  const result = validateAddress(req.body)
  if (result.errors) return res.status(400).json({ errors: result.errors })

  const input = result.value
  inTransaction(() => {
    if (input.is_default) db.prepare('UPDATE addresses SET is_default=0 WHERE user_id=? AND id!=?').run(uid, existing.id)
    db.prepare(
      `UPDATE addresses SET receiver=?, phone=?, province=?, city=?, district=?, detail=?, is_default=?,
       updated_at=datetime('now','localtime') WHERE id=?`
    ).run(
      input.receiver,
      input.phone,
      input.province,
      input.city,
      input.district,
      input.detail,
      input.is_default ? 1 : 0,
      existing.id
    )
  })
  res.json({ address: getOwnedAddress(uid, existing.id) })
})

/** 设为默认地址 */
addressesRouter.patch('/:id/default', (req, res) => {
  const uid = res.locals.uid as number
  const existing = getOwnedAddress(uid, req.params.id)
  if (!existing) return res.status(404).json({ errors: ['地址不存在'] })

  inTransaction(() => {
    db.prepare('UPDATE addresses SET is_default=0 WHERE user_id=?').run(uid)
    db.prepare(`UPDATE addresses SET is_default=1, updated_at=datetime('now','localtime') WHERE id=?`).run(existing.id)
  })
  res.json({ address: getOwnedAddress(uid, existing.id) })
})

/** 删除地址：删的是默认地址且仍有剩余时，把最新一条提为默认 */
addressesRouter.delete('/:id', (req, res) => {
  const uid = res.locals.uid as number
  const existing = getOwnedAddress(uid, req.params.id)
  if (!existing) return res.status(404).json({ errors: ['地址不存在'] })

  inTransaction(() => {
    db.prepare('DELETE FROM addresses WHERE id=?').run(existing.id)
    if (existing.is_default === 1) {
      db.prepare(
        `UPDATE addresses SET is_default=1
         WHERE id=(SELECT id FROM addresses WHERE user_id=? ORDER BY id DESC LIMIT 1)`
      ).run(uid)
    }
  })
  res.json({ ok: true })
})
