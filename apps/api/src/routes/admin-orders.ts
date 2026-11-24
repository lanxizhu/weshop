import { Router } from 'express'
import type { AdminOrder, Order, OrderStatus } from '@weshop/shared'
import { db, inTransaction } from '../db.js'
import { escapeCsvCell } from '../utils/csv.js'
import { cancelOrderAndRestock, getOrderItems, getOrderItemsForOrders } from './orders.js'

// 鉴权由 app.ts 挂载点的 requireAdmin 统一处理
export const adminOrdersRouter = Router()

const ORDER_STATUSES: OrderStatus[] = ['pending', 'paid', 'shipped', 'completed', 'cancelled']

interface AdminOrderRow extends Omit<Order, 'items'> {
  nick_name: string
}

async function getAdminOrder(id: number | string): Promise<AdminOrder | undefined> {
  const order = await db.prepare(
    'SELECT o.*, u.nick_name FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id=?',
  ).get<AdminOrderRow>(id)
  return order ? { ...order, items: await getOrderItems(order.id) } : undefined
}

/** 组装订单过滤条件（状态 + 关键词），供列表与 CSV 导出复用 */
function buildOrderFilter(query: { status?: unknown, keyword?: unknown }) {
  const status = String(query.status ?? 'all')
  const keyword = String(query.keyword ?? '').trim()
  const conditions: string[] = []
  const params: (string | number)[] = []
  if (status !== 'all' && ORDER_STATUSES.includes(status as OrderStatus)) {
    conditions.push('o.status=?')
    params.push(status)
  }
  if (keyword) {
    conditions.push('(o.order_no LIKE ? OR o.receiver LIKE ?)')
    params.push(`%${keyword}%`, `%${keyword}%`)
  }
  return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params }
}

const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: '待支付',
  paid: '待发货',
  shipped: '待收货',
  completed: '已完成',
  cancelled: '已取消',
}

/** 订单列表：状态筛选 + 关键词（订单号/收货人）+ 分页 */
adminOrdersRouter.get('/', async (req, res) => {
  const page = Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1)
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(String(req.query.pageSize ?? '10'), 10) || 10))
  const { where, params } = buildOrderFilter(req.query)

  const count = (await db.prepare(`SELECT COUNT(*) AS n FROM orders o ${where}`).get<{ n: number }>(...params))!
  const rows = await db.prepare(
    `SELECT o.*, u.nick_name FROM orders o JOIN users u ON u.id = o.user_id
     ${where} ORDER BY o.id DESC LIMIT ? OFFSET ?`,
  ).all<AdminOrderRow>(...params, pageSize, (page - 1) * pageSize)

  const itemsByOrder = await getOrderItemsForOrders(rows.map((order) => order.id))
  res.json({
    orders: rows.map((order) => ({ ...order, items: itemsByOrder.get(order.id) ?? [] })),
    total: count.n,
    page,
    pageSize,
  })
})

/** 导出当前过滤条件下的订单为 CSV（带 BOM，Excel 打开不乱码；最多 5000 条） */
adminOrdersRouter.get('/export.csv', async (req, res) => {
  const { where, params } = buildOrderFilter(req.query)
  const rows = await db.prepare(
    `SELECT o.*, u.nick_name FROM orders o JOIN users u ON u.id = o.user_id
     ${where} ORDER BY o.id DESC LIMIT 5000`,
  ).all<AdminOrderRow>(...params)

  const escape = escapeCsvCell
  const itemsByOrder = await getOrderItemsForOrders(rows.map((order) => order.id))
  const header = '订单号,买家昵称,收货人,电话,收货地址,商品摘要,件数,金额,状态,备注,下单时间,支付时间,发货时间,完成时间,取消原因'
  const lines = rows.map((order) => {
    const items = itemsByOrder.get(order.id) ?? []
    const summary = items.map((item) => item.sku_name ? `${item.product_name}[${item.sku_name}] x${item.quantity}` : item.product_name).join('; ')
    const quantity = items.reduce((sum, item) => sum + item.quantity, 0)
    return [
      escape(order.order_no),
      escape(order.nick_name),
      escape(order.receiver),
      escape(order.phone),
      escape(`${order.province}${order.city}${order.district}${order.detail}`),
      escape(summary),
      quantity,
      order.total_amount,
      escape(STATUS_LABELS[order.status] ?? order.status),
      escape(order.remark),
      escape(order.created_at),
      escape(order.paid_at),
      escape(order.shipped_at),
      escape(order.completed_at),
      escape(order.cancel_reason),
    ].join(',')
  })
  const csv = `\uFEFF${header}\n${lines.join('\n')}\n`

  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', 'attachment; filename="orders.csv"')
  res.send(csv)
})

/** 订单详情（含明细与买家信息） */
adminOrdersRouter.get('/:id', async (req, res) => {
  const order = await getAdminOrder(req.params.id)
  if (!order) return res.status(404).json({ errors: ['订单不存在'] })
  res.json({ order })
})

/** 发货：paid → shipped */
adminOrdersRouter.post('/:id/ship', async (req, res) => {
  const order = await getAdminOrder(req.params.id)
  if (!order) return res.status(404).json({ errors: ['订单不存在'] })
  if (order.status !== 'paid') return res.status(400).json({ errors: ['仅待发货订单可发货'] })

  const changed = await db.prepare(
    `UPDATE orders SET status='shipped', shipped_at=NOW(), updated_at=NOW()
     WHERE id=? AND status='paid'`,
  ).run(order.id)
  if (changed.changes === 0) return res.status(400).json({ errors: ['仅待发货订单可发货'] })
  res.json({ order: await getAdminOrder(order.id) })
})

/** 商家取消：pending/paid → cancelled，条件认领后在同一事务内回补库存 */
adminOrdersRouter.post('/:id/cancel', async (req, res) => {
  const order = await getAdminOrder(req.params.id)
  if (!order) return res.status(404).json({ errors: ['订单不存在'] })
  if (order.status !== 'pending' && order.status !== 'paid') {
    return res.status(400).json({ errors: ['当前订单状态不可取消'] })
  }

  const reason = String((req.body as Record<string, unknown> | null)?.reason ?? '').trim() || '商家取消'
  const claimed = await inTransaction(async () => {
    const changed = await db.prepare(
      `UPDATE orders SET status='cancelled' WHERE id=? AND status IN ('pending','paid')`,
    ).run(order.id)
    if (changed.changes === 0) return false
    await cancelOrderAndRestock(order.id, reason, `admin:${res.locals.adminId}`)
    return true
  })
  if (!claimed) return res.status(400).json({ errors: ['当前订单状态不可取消'] })
  res.json({ order: await getAdminOrder(order.id) })
})
