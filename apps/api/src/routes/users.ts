import { Router } from 'express'
import type { Address, Order, UserDetail, UserListItem } from '@weshop/shared'
import { db, getUserById } from '../db.js'
import { getOrderItems } from './orders.js'

// 鉴权由 app.ts 挂载点的 requireAdmin 统一处理
export const usersRouter = Router()

/** 管理端用户列表（按注册倒序，附收货地址数量） */
usersRouter.get('/', (_req, res) => {
  const users = db
    .prepare(
      `SELECT u.*, (SELECT COUNT(*) FROM addresses a WHERE a.user_id = u.id) AS address_count
       FROM users u ORDER BY u.id DESC`
    )
    .all() as unknown as UserListItem[]
  res.json({ users })
})

/** 用户详情：基础信息 + 地址数 / 订单数 / 累计消费（paid/shipped/completed）/ 最近下单时间 + 地址列表 */
usersRouter.get('/:id', (req, res) => {
  const user = db
    .prepare(
      `SELECT u.*,
              (SELECT COUNT(*) FROM addresses a WHERE a.user_id = u.id) AS address_count,
              (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS order_count,
              COALESCE(ROUND((SELECT SUM(total_amount) FROM orders o
                WHERE o.user_id = u.id AND o.status IN ('paid','shipped','completed')), 2), 0) AS total_spent,
              (SELECT MAX(created_at) FROM orders o WHERE o.user_id = u.id) AS last_order_at
       FROM users u WHERE u.id = ?`
    )
    .get(req.params.id) as unknown as UserDetail | undefined
  if (!user) return res.status(404).json({ errors: ['用户不存在'] })
  const addresses = db
    .prepare('SELECT * FROM addresses WHERE user_id=? ORDER BY is_default DESC, id DESC')
    .all(req.params.id) as unknown as Address[]
  res.json({ user: { ...user, addresses } })
})

/** 该用户的订单列表（倒序分页，每条带明细） */
usersRouter.get('/:id/orders', (req, res) => {
  if (!getUserById(Number(req.params.id))) return res.status(404).json({ errors: ['用户不存在'] })
  const page = Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1)
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(String(req.query.pageSize ?? '10'), 10) || 10))

  const { n: total } = db.prepare('SELECT COUNT(*) AS n FROM orders WHERE user_id=?').get(req.params.id) as { n: number }
  const rows = db
    .prepare('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC LIMIT ? OFFSET ?')
    .all(req.params.id, pageSize, (page - 1) * pageSize) as unknown as Array<Omit<Order, 'items'>>
  res.json({ orders: rows.map((o) => ({ ...o, items: getOrderItems(o.id) })), total, page, pageSize })
})

/** 禁用 / 恢复用户 */
usersRouter.patch('/:id/status', (req, res) => {
  const status = String((req.body as { status?: unknown })?.status ?? '')
  if (!['normal', 'disabled'].includes(status)) return res.status(400).json({ errors: ['状态不合法'] })
  const r = db
    .prepare(`UPDATE users SET status=?, updated_at=datetime('now','localtime') WHERE id=?`)
    .run(status, req.params.id)
  if (r.changes === 0) return res.status(404).json({ errors: ['用户不存在'] })
  res.json({ user: getUserById(Number(req.params.id)) })
})
