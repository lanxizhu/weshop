import { Router } from 'express'
import type { Address, Order, OrderItem, OrderStatus } from '@weshop/shared'
import { requireAuth } from '../auth.js'
import { ORDER_TIMEOUT_SECONDS } from '../config.js'
import { db, inTransaction, syncProductDerivedFields, writeStockLog } from '../db.js'
import { validateOrderCreate } from '../validate.js'

export const ordersRouter = Router()

// 订单 C 端接口都需要登录，uid 取自令牌而非请求参数
ordersRouter.use(requireAuth)

const ORDER_STATUSES: OrderStatus[] = ['pending', 'paid', 'shipped', 'completed', 'cancelled']

export function getOrderItems(orderId: number | string | bigint): OrderItem[] {
  return db.prepare('SELECT * FROM order_items WHERE order_id=? ORDER BY id').all(orderId) as unknown as OrderItem[]
}

/** 批量读取订单明细并保持每组内 id 顺序，供订单列表与导出复用 */
export function getOrderItemsForOrders(orderIds: Array<number | string | bigint>): Map<number, OrderItem[]> {
  const grouped = new Map<number, OrderItem[]>()
  if (orderIds.length === 0) return grouped
  const placeholders = orderIds.map(() => '?').join(',')
  const rows = db
    .prepare(`SELECT * FROM order_items WHERE order_id IN (${placeholders}) ORDER BY order_id, id`)
    .all(...orderIds) as unknown as OrderItem[]
  for (const row of rows) {
    const id = Number(row.order_id)
    grouped.set(id, [...(grouped.get(id) ?? []), row])
  }
  return grouped
}

function withItems(order: Omit<Order, 'items'>): Order {
  return { ...order, items: getOrderItems(order.id) }
}

/** 仅按「归属当前用户」查询订单，防止越权读写他人订单 */
function getOwnedOrder(uid: number, id: number | string): Order | undefined {
  const order = db.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').get(id, uid) as Omit<Order, 'items'> | undefined
  return order ? withItems(order) : undefined
}

function generateOrderNo(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  for (let i = 0; i < 5; i++) {
    const no = `WS${stamp}${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`
    if (!db.prepare('SELECT 1 FROM orders WHERE order_no=?').get(no)) return no
  }
  throw new Error('订单号生成失败，请重试')
}

/** 取消订单并回补库存（须在事务内调用）：只回补明细快照的原规格，规格已删时记录未回补 */
export function cancelOrderAndRestock(orderId: number, reason: string, operator = ''): void {
  const order = db.prepare('SELECT order_no FROM orders WHERE id=?').get(orderId) as { order_no: string } | undefined
  const orderNo = order?.order_no ?? String(orderId)
  const items = getOrderItems(orderId)
  const touchedProducts = new Set<number>()
  for (const item of items) {
    const sku = item.sku_id > 0
      ? db.prepare('SELECT id, name, stock FROM product_skus WHERE id=?').get(item.sku_id) as
        | { id: number; name: string; stock: number }
        | undefined
      : db.prepare(
          `SELECT id, name, stock FROM product_skus
           WHERE product_id=? AND (SELECT COUNT(*) FROM product_skus WHERE product_id=?) = 1 LIMIT 1`
        ).get(item.product_id, item.product_id) as
        | { id: number; name: string; stock: number }
        | undefined
    if (sku) {
      db.prepare(`UPDATE product_skus SET stock=stock+?, updated_at=datetime('now','localtime') WHERE id=?`).run(
        item.quantity,
        sku.id
      )
      writeStockLog({
        product_id: item.product_id,
        sku_id: sku.id,
        sku_name: sku.name,
        delta: item.quantity,
        stock_after: sku.stock + item.quantity,
        reason: 'cancel',
        ref: orderNo,
        operator,
      })
    } else {
      // 原规格不可用或历史多规格订单无法确定原规格：不跨规格回补，但记录流水说明
      writeStockLog({
        product_id: item.product_id,
        sku_id: item.sku_id,
        sku_name: item.sku_name,
        delta: item.quantity,
        stock_after: 0,
        reason: 'cancel',
        ref: `${orderNo}（原规格不可用，库存未回补）`,
        operator,
      })
    }
    touchedProducts.add(item.product_id)
  }
  for (const pid of touchedProducts) syncProductDerivedFields(pid)
  db.prepare(
    `UPDATE orders SET status='cancelled', cancelled_at=datetime('now','localtime'), cancel_reason=?,
     updated_at=datetime('now','localtime') WHERE id=?`
  ).run(reason, orderId)
}

/** 关闭超时未支付订单并回补库存；条件认领保证重复扫描或并发实例不会重复回补 */
export function closeExpiredOrders(): number {
  const expired = db
    .prepare(
      `SELECT id FROM orders
       WHERE status='pending' AND datetime(created_at) <= datetime('now','localtime', ?)
       ORDER BY id`
    )
    .all(`-${ORDER_TIMEOUT_SECONDS} seconds`) as unknown as Array<{ id: number }>
  let closed = 0
  for (const { id } of expired) {
    const changed = inTransaction(() => {
      const claimed = db.prepare(`UPDATE orders SET status='cancelled' WHERE id=? AND status='pending'`).run(id)
      if (claimed.changes === 0) return false
      cancelOrderAndRestock(id, '超时未支付，系统自动取消', 'system:order-timeout')
      return true
    })
    if (changed) closed += 1
  }
  return closed
}

/** 下单：事务内校验商品与规格 → 原子扣 SKU 库存 → 写订单与快照 → 写流水 → 同步派生字段 → 清理购物车 */
ordersRouter.post('/', (req, res) => {
  const uid = res.locals.uid as number
  const result = validateOrderCreate(req.body)
  if (result.errors) return res.status(400).json({ errors: result.errors })

  const { source, address_id, remark } = result.value
  const address = db.prepare('SELECT * FROM addresses WHERE id=? AND user_id=?').get(address_id, uid) as
    | Address
    | undefined
  if (!address) return res.status(400).json({ errors: ['收货地址不存在'] })

  interface Line {
    product_id: number
    sku_id: number
    quantity: number
    cart_item_id?: number
  }
  const lines: Line[] = []
  if (source.type === 'cart') {
    const placeholders = source.item_ids.map(() => '?').join(',')
    const rows = db
      .prepare(`SELECT id AS cart_item_id, product_id, sku_id, quantity FROM cart_items WHERE user_id=? AND id IN (${placeholders})`)
      .all(uid, ...source.item_ids) as unknown as Line[]
    if (rows.length !== source.item_ids.length) return res.status(400).json({ errors: ['购物车选中项不存在，请刷新购物车'] })
    lines.push(...rows)
  } else {
    lines.push({ product_id: source.product_id, sku_id: source.sku_id, quantity: source.quantity })
  }

  try {
    const order = inTransaction(() => {
      let total = 0
      const insertItem = db.prepare(
        'INSERT INTO order_items (order_id, product_id, sku_id, sku_name, product_name, product_image, price, quantity) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      const deduct = db.prepare(
        `UPDATE product_skus SET stock=stock-?, updated_at=datetime('now','localtime') WHERE id=? AND product_id=? AND stock>=?`
      )
      const touchedProducts = new Set<number>()

      const orderNo = generateOrderNo()
      const orderId = (() => {
        const r = db
          .prepare(
            `INSERT INTO orders (order_no, user_id, total_amount, receiver, phone, province, city, district, detail, remark)
             VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(orderNo, uid, address.receiver, address.phone, address.province, address.city, address.district, address.detail, remark ?? '')
        return Number(r.lastInsertRowid)
      })()

      for (const line of lines) {
        const sku = db
          .prepare(
            `SELECT s.id, s.name AS sku_name, s.price, s.stock, s.image AS sku_image,
                    p.name AS product_name, p.status
             FROM product_skus s JOIN products p ON p.id = s.product_id
             WHERE s.id=? AND p.id=?`
          )
          .get(line.sku_id, line.product_id) as
          | { id: number; sku_name: string; price: number; stock: number; sku_image: string; product_name: string; status: string }
          | undefined
        if (!sku) throw new Error('商品规格不存在，请刷新后重试')
        if (sku.status !== 'on') throw new Error(`商品已下架：${sku.product_name}`)
        if (deduct.run(line.quantity, line.sku_id, line.product_id, line.quantity).changes === 0) {
          throw new Error(`库存不足：${sku.product_name}（${sku.sku_name}）`)
        }
        const image =
          sku.sku_image ||
          (db.prepare('SELECT url FROM product_images WHERE product_id=? ORDER BY sort_order, id LIMIT 1').get(line.product_id) as
            | { url: string }
            | undefined)?.url ||
          ''
        insertItem.run(orderId, line.product_id, line.sku_id, sku.sku_name, sku.product_name, image, sku.price, line.quantity)
        total += sku.price * line.quantity
        touchedProducts.add(line.product_id)
        writeStockLog({
          product_id: line.product_id,
          sku_id: line.sku_id,
          sku_name: sku.sku_name,
          delta: -line.quantity,
          stock_after: sku.stock - line.quantity,
          reason: 'order',
          ref: orderNo,
          operator: `user:${uid}`,
        })
        if (line.cart_item_id !== undefined) db.prepare('DELETE FROM cart_items WHERE id=?').run(line.cart_item_id)
      }

      for (const pid of touchedProducts) syncProductDerivedFields(pid)
      db.prepare('UPDATE orders SET total_amount=? WHERE id=?').run(Math.round(total * 100) / 100, orderId)
      return getOwnedOrder(uid, orderId)!
    })
    res.status(201).json({ order })
  } catch (e) {
    res.status(400).json({ errors: [e instanceof Error ? e.message : '下单失败，请重试'] })
  }
})

/** 本人订单列表（可按状态筛选，每条带明细） */
ordersRouter.get('/', (req, res) => {
  const uid = res.locals.uid as number
  const status = String(req.query.status ?? 'all')
  const page = Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1)
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(String(req.query.pageSize ?? '10'), 10) || 10))

  const conds = ['user_id=?']
  const params: (string | number)[] = [uid]
  if (status !== 'all' && ORDER_STATUSES.includes(status as OrderStatus)) {
    conds.push('status=?')
    params.push(status)
  }
  const where = conds.join(' AND ')
  const { n: total } = db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE ${where}`).get(...params) as { n: number }
  const rows = db
    .prepare(`SELECT * FROM orders WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize) as unknown as Array<Omit<Order, 'items'>>

  const itemsByOrder = getOrderItemsForOrders(rows.map((o) => o.id))
  res.json({ orders: rows.map((o) => ({ ...o, items: itemsByOrder.get(o.id) ?? [] })), total, page, pageSize })
})

/** 本人订单详情 */
ordersRouter.get('/:id', (req, res) => {
  const order = getOwnedOrder(res.locals.uid as number, req.params.id)
  if (!order) return res.status(404).json({ errors: ['订单不存在'] })
  res.json({ order })
})

/** 模拟支付：pending → paid（幂等，已支付直接返回成功） */
ordersRouter.post('/:id/pay', (req, res) => {
  const uid = res.locals.uid as number
  const order = getOwnedOrder(uid, req.params.id)
  if (!order) return res.status(404).json({ errors: ['订单不存在'] })
  if (order.status === 'paid') return res.json({ order })
  if (order.status !== 'pending') return res.status(400).json({ errors: ['当前订单状态不可支付'] })

  const changed = db
    .prepare(
      `UPDATE orders SET status='paid', paid_at=datetime('now','localtime'), updated_at=datetime('now','localtime')
       WHERE id=? AND user_id=? AND status='pending'`
    )
    .run(order.id, uid)
  if (changed.changes === 0) {
    const current = getOwnedOrder(uid, order.id)
    if (current?.status === 'paid') return res.json({ order: current })
    return res.status(400).json({ errors: ['当前订单状态不可支付'] })
  }
  res.json({ order: getOwnedOrder(uid, order.id) })
})

/** 取消订单：仅待支付可取消，条件认领后在同一事务内回补库存 */
ordersRouter.post('/:id/cancel', (req, res) => {
  const uid = res.locals.uid as number
  const order = getOwnedOrder(uid, req.params.id)
  if (!order) return res.status(404).json({ errors: ['订单不存在'] })
  if (order.status !== 'pending') return res.status(400).json({ errors: ['当前订单状态不可取消'] })

  const reason = String((req.body as Record<string, unknown> | null)?.reason ?? '').trim() || '用户取消'
  const claimed = inTransaction(() => {
    const changed = db
      .prepare(`UPDATE orders SET status='cancelled' WHERE id=? AND user_id=? AND status='pending'`)
      .run(order.id, uid)
    if (changed.changes === 0) return false
    cancelOrderAndRestock(order.id, reason, `user:${uid}`)
    return true
  })
  if (!claimed) return res.status(400).json({ errors: ['当前订单状态不可取消'] })
  res.json({ order: getOwnedOrder(uid, order.id) })
})

/** 确认收货：shipped → completed */
ordersRouter.post('/:id/confirm', (req, res) => {
  const uid = res.locals.uid as number
  const order = getOwnedOrder(uid, req.params.id)
  if (!order) return res.status(404).json({ errors: ['订单不存在'] })
  if (order.status !== 'shipped') return res.status(400).json({ errors: ['当前订单状态不可确认收货'] })

  const changed = db
    .prepare(
      `UPDATE orders SET status='completed', completed_at=datetime('now','localtime'), updated_at=datetime('now','localtime')
       WHERE id=? AND user_id=? AND status='shipped'`
    )
    .run(order.id, uid)
  if (changed.changes === 0) return res.status(400).json({ errors: ['当前订单状态不可确认收货'] })
  res.json({ order: getOwnedOrder(uid, order.id) })
})
