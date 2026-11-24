import { Router } from 'express'
import type { Address, Order, UserDetail, UserListItem } from '@weshop/shared'
import { db, getUserById } from '../db.js'
import { getOrderItemsForOrders } from './orders.js'

// 鉴权由 app.ts 挂载点的 requireAdmin 统一处理
export const usersRouter = Router()

/** 管理端用户列表（按注册倒序分页，附收货地址数量与全量统计） */
usersRouter.get('/', async (req, res) => {
  const page = Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1)
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(String(req.query.pageSize ?? '10'), 10) || 10))

  const counts = (await db.prepare(
    'SELECT (SELECT COUNT(*) FROM users) AS total, (SELECT COUNT(*) FROM addresses) AS addressTotal',
  ).get<{ total: number, addressTotal: number }>())!
  const users = await db.prepare(
    `SELECT u.*, (SELECT COUNT(*) FROM addresses a WHERE a.user_id = u.id) AS address_count
     FROM users u ORDER BY u.id DESC LIMIT ? OFFSET ?`,
  ).all<UserListItem>(pageSize, (page - 1) * pageSize)
  res.json({ users, total: counts.total, addressTotal: counts.addressTotal, page, pageSize })
})

/** 用户详情：基础信息 + 地址数 / 订单数 / 累计消费（paid/shipped/completed）/ 最近下单时间 + 地址列表 */
usersRouter.get('/:id', async (req, res) => {
  const user = await db.prepare(
    `SELECT u.*,
            (SELECT COUNT(*) FROM addresses a WHERE a.user_id = u.id) AS address_count,
            (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS order_count,
            COALESCE(ROUND((SELECT SUM(total_amount) FROM orders o
              WHERE o.user_id = u.id AND o.status IN ('paid','shipped','completed')), 2), 0) AS total_spent,
            (SELECT MAX(created_at) FROM orders o WHERE o.user_id = u.id) AS last_order_at
     FROM users u WHERE u.id = ?`,
  ).get<UserDetail>(req.params.id)
  if (!user) return res.status(404).json({ errors: ['用户不存在'] })
  const addresses = await db.prepare(
    'SELECT * FROM addresses WHERE user_id=? ORDER BY is_default DESC, id DESC',
  ).all<Address>(req.params.id)
  res.json({ user: { ...user, addresses } })
})

/** 该用户的订单列表（倒序分页，每条带明细） */
usersRouter.get('/:id/orders', async (req, res) => {
  if (!await getUserById(Number(req.params.id))) return res.status(404).json({ errors: ['用户不存在'] })
  const page = Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1)
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(String(req.query.pageSize ?? '10'), 10) || 10))

  const count = (await db.prepare('SELECT COUNT(*) AS n FROM orders WHERE user_id=?').get<{ n: number }>(req.params.id))!
  const rows = await db.prepare(
    'SELECT * FROM orders WHERE user_id=? ORDER BY id DESC LIMIT ? OFFSET ?',
  ).all<Omit<Order, 'items'>>(req.params.id, pageSize, (page - 1) * pageSize)
  const itemsByOrder = await getOrderItemsForOrders(rows.map((order) => order.id))
  res.json({
    orders: rows.map((order) => ({ ...order, items: itemsByOrder.get(order.id) ?? [] })),
    total: count.n,
    page,
    pageSize,
  })
})

/** 禁用 / 恢复用户 */
usersRouter.patch('/:id/status', async (req, res) => {
  const status = String((req.body as { status?: unknown })?.status ?? '')
  if (!['normal', 'disabled'].includes(status)) return res.status(400).json({ errors: ['状态不合法'] })
  const result = await db.prepare(
    `UPDATE users SET status=?, updated_at=NOW() WHERE id=?`,
  ).run(status, req.params.id)
  if (result.changes === 0) return res.status(404).json({ errors: ['用户不存在'] })
  res.json({ user: await getUserById(Number(req.params.id)) })
})
