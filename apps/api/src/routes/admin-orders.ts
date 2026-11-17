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

function getAdminOrder(id: number | string): AdminOrder | undefined {
  const order = db
    .prepare('SELECT o.*, u.nick_name FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id=?')
    .get(id) as AdminOrderRow | undefined
  return order ? { ...order, items: getOrderItems(order.id) } : undefined
}

/** 组装订单过滤条件（状态 + 关键词），供列表与 CSV 导出复用 */
function buildOrderFilter(query: { status?: unknown; keyword?: unknown }) {
  const status = String(query.status ?? 'all')
  const keyword = String(query.keyword ?? '').trim()
  const conds: string[] = []
  const params: (string | number)[] = []
  if (status !== 'all' && ORDER_STATUSES.includes(status as OrderStatus)) {
    conds.push('o.status=?')
    params.push(status)
  }
  if (keyword) {
    conds.push('(o.order_no LIKE ? OR o.receiver LIKE ?)')
    params.push(`%${keyword}%`, `%${keyword}%`)
  }
  return { where: conds.length ? `WHERE ${conds.join(' AND ')}` : '', params }
}

const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: '待支付',
  paid: '待发货',
  shipped: '待收货',
  completed: '已完成',
  cancelled: '已取消',
}

/** 订单列表：状态筛选 + 关键词（订单号/收货人）+ 分页 */
adminOrdersRouter.get('/', (req, res) => {
  const page = Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1)
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(String(req.query.pageSize ?? '10'), 10) || 10))
  const { where, params } = buildOrderFilter(req.query)

  const { n: total } = db.prepare(`SELECT COUNT(*) AS n FROM orders o ${where}`).get(...params) as { n: number }
  const rows = db
    .prepare(
      `SELECT o.*, u.nick_name FROM orders o JOIN users u ON u.id = o.user_id
       ${where} ORDER BY o.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, (page - 1) * pageSize) as unknown as AdminOrderRow[]

  const itemsByOrder = getOrderItemsForOrders(rows.map((o) => o.id))
  res.json({ orders: rows.map((o) => ({ ...o, items: itemsByOrder.get(o.id) ?? [] })), total, page, pageSize })
})

/** 导出当前过滤条件下的订单为 CSV（带 BOM，Excel 打开不乱码；最多 5000 条） */
adminOrdersRouter.get('/export.csv', (req, res) => {
  const { where, params } = buildOrderFilter(req.query)
  const rows = db
    .prepare(
      `SELECT o.*, u.nick_name FROM orders o JOIN users u ON u.id = o.user_id
       ${where} ORDER BY o.id DESC LIMIT 5000`
    )
    .all(...params) as unknown as AdminOrderRow[]

  const esc = escapeCsvCell
  const itemsByOrder = getOrderItemsForOrders(rows.map((o) => o.id))
  const header = '订单号,买家昵称,收货人,电话,收货地址,商品摘要,件数,金额,状态,备注,下单时间,支付时间,发货时间,完成时间,取消原因'
  const lines = rows.map((o) => {
    const items = itemsByOrder.get(o.id) ?? []
    const summary = items.map((i) => (i.sku_name ? `${i.product_name}[${i.sku_name}] x${i.quantity}` : i.product_name)).join('; ')
    const quantity = items.reduce((s, i) => s + i.quantity, 0)
    return [
      esc(o.order_no),
      esc(o.nick_name),
      esc(o.receiver),
      esc(o.phone),
      esc(`${o.province}${o.city}${o.district}${o.detail}`),
      esc(summary),
      quantity,
      o.total_amount,
      esc(STATUS_LABELS[o.status] ?? o.status),
      esc(o.remark),
      esc(o.created_at),
      esc(o.paid_at),
      esc(o.shipped_at),
      esc(o.completed_at),
      esc(o.cancel_reason),
    ].join(',')
  })
  const csv = `\uFEFF${header}\n${lines.join('\n')}\n`

  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', 'attachment; filename="orders.csv"')
  res.send(csv)
})

/** 订单详情（含明细与买家信息） */
adminOrdersRouter.get('/:id', (req, res) => {
  const order = getAdminOrder(req.params.id)
  if (!order) return res.status(404).json({ errors: ['订单不存在'] })
  res.json({ order })
})

/** 发货：paid → shipped */
adminOrdersRouter.post('/:id/ship', (req, res) => {
  const order = getAdminOrder(req.params.id)
  if (!order) return res.status(404).json({ errors: ['订单不存在'] })
  if (order.status !== 'paid') return res.status(400).json({ errors: ['仅待发货订单可发货'] })

  const changed = db
    .prepare(
      `UPDATE orders SET status='shipped', shipped_at=datetime('now','localtime'), updated_at=datetime('now','localtime')
       WHERE id=? AND status='paid'`
    )
    .run(order.id)
  if (changed.changes === 0) return res.status(400).json({ errors: ['仅待发货订单可发货'] })
  res.json({ order: getAdminOrder(order.id) })
})

/** 商家取消：pending/paid → cancelled，条件认领后在同一事务内回补库存 */
adminOrdersRouter.post('/:id/cancel', (req, res) => {
  const order = getAdminOrder(req.params.id)
  if (!order) return res.status(404).json({ errors: ['订单不存在'] })
  if (order.status !== 'pending' && order.status !== 'paid') {
    return res.status(400).json({ errors: ['当前订单状态不可取消'] })
  }

  const reason = String((req.body as Record<string, unknown> | null)?.reason ?? '').trim() || '商家取消'
  const claimed = inTransaction(() => {
    const changed = db
      .prepare(`UPDATE orders SET status='cancelled' WHERE id=? AND status IN ('pending','paid')`)
      .run(order.id)
    if (changed.changes === 0) return false
    cancelOrderAndRestock(order.id, reason, `admin:${res.locals.adminId}`)
    return true
  })
  if (!claimed) return res.status(400).json({ errors: ['当前订单状态不可取消'] })
  res.json({ order: getAdminOrder(order.id) })
})
