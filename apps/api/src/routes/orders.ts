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

type EntityId = number | string | bigint

export async function getOrderItems(orderId: EntityId): Promise<OrderItem[]> {
  return db.prepare('SELECT * FROM order_items WHERE order_id=? ORDER BY id').all<OrderItem>(orderId)
}

/** 批量读取订单明细并保持每组内 id 顺序，供订单列表与导出复用 */
export async function getOrderItemsForOrders(orderIds: EntityId[]): Promise<Map<number, OrderItem[]>> {
  const grouped = new Map<number, OrderItem[]>()
  if (orderIds.length === 0) return grouped
  const placeholders = orderIds.map(() => '?').join(',')
  const rows = await db.prepare(
    `SELECT * FROM order_items WHERE order_id IN (${placeholders}) ORDER BY order_id, id`,
  ).all<OrderItem>(...orderIds)
  for (const row of rows) {
    const id = Number(row.order_id)
    grouped.set(id, [...(grouped.get(id) ?? []), row])
  }
  return grouped
}

async function withItems(order: Omit<Order, 'items'>): Promise<Order> {
  return { ...order, items: await getOrderItems(order.id) }
}

/** 仅按「归属当前用户」查询订单，防止越权读写他人订单 */
async function getOwnedOrder(uid: number, id: number | string): Promise<Order | undefined> {
  const order = await db.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').get<Omit<Order, 'items'>>(id, uid)
  return order ? withItems(order) : undefined
}

async function generateOrderNo(): Promise<string> {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  for (let index = 0; index < 5; index++) {
    const orderNo = `WS${stamp}${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`
    if (!await db.prepare('SELECT 1 FROM orders WHERE order_no=?').get(orderNo)) return orderNo
  }
  throw new Error('订单号生成失败，请重试')
}

/** 取消订单并回补库存（须在事务内调用）：只回补明细快照的原规格，规格已删时记录未回补 */
export async function cancelOrderAndRestock(orderId: number, reason: string, operator = ''): Promise<void> {
  const order = await db.prepare('SELECT order_no FROM orders WHERE id=?').get<{ order_no: string }>(orderId)
  const orderNo = order?.order_no ?? String(orderId)
  const items = await getOrderItems(orderId)
  const touchedProducts = new Set<number>()
  for (const item of items) {
    const sku = item.sku_id > 0
      ? await db.prepare('SELECT id, name, stock FROM product_skus WHERE id=?').get<{
        id: number, name: string, stock: number
      }>(item.sku_id)
      : await db.prepare(
        `SELECT id, name, stock FROM product_skus
         WHERE product_id=? AND (SELECT COUNT(*) FROM product_skus WHERE product_id=?) = 1 LIMIT 1`,
      ).get<{ id: number, name: string, stock: number }>(item.product_id, item.product_id)
    if (sku) {
      await db.prepare(`UPDATE product_skus SET stock=stock+?, updated_at=NOW() WHERE id=?`).run(
        item.quantity,
        sku.id,
      )
      await writeStockLog({
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
      await writeStockLog({
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
  for (const productId of touchedProducts) await syncProductDerivedFields(productId)
  await db.prepare(
    `UPDATE orders SET status='cancelled', cancelled_at=NOW(), cancel_reason=?,
     updated_at=NOW() WHERE id=?`,
  ).run(reason, orderId)
}

function formatDateTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** 关闭超时未支付订单并回补库存；条件认领保证重复扫描或并发实例不会重复回补 */
export async function closeExpiredOrders(): Promise<number> {
  const cutoff = formatDateTime(new Date(Date.now() - ORDER_TIMEOUT_SECONDS * 1000))
  const expired = await db.prepare(
    `SELECT id FROM orders
     WHERE status='pending' AND created_at <= ?
     ORDER BY id`,
  ).all<{ id: number }>(cutoff)
  let closed = 0
  for (const { id } of expired) {
    const changed = await inTransaction(async () => {
      const claimed = await db.prepare(`UPDATE orders SET status='cancelled' WHERE id=? AND status='pending'`).run(id)
      if (claimed.changes === 0) return false
      await cancelOrderAndRestock(id, '超时未支付，系统自动取消', 'system:order-timeout')
      return true
    })
    if (changed) closed += 1
  }
  return closed
}

/** 下单：事务内校验商品与规格 → 原子扣 SKU 库存 → 写订单与快照 → 写流水 → 同步派生字段 → 清理购物车 */
ordersRouter.post('/', async (req, res) => {
  const uid = res.locals.uid as number
  const result = validateOrderCreate(req.body)
  if (result.errors) return res.status(400).json({ errors: result.errors })

  const { source, address_id, remark } = result.value
  const address = await db.prepare('SELECT * FROM addresses WHERE id=? AND user_id=?').get<Address>(address_id, uid)
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
    const rows = await db.prepare(
      `SELECT id AS cart_item_id, product_id, sku_id, quantity FROM cart_items WHERE user_id=? AND id IN (${placeholders})`,
    ).all<Line>(uid, ...source.item_ids)
    if (rows.length !== source.item_ids.length) return res.status(400).json({ errors: ['购物车选中项不存在，请刷新购物车'] })
    lines.push(...rows)
  } else {
    lines.push({ product_id: source.product_id, sku_id: source.sku_id, quantity: source.quantity })
  }

  try {
    const order = await inTransaction(async () => {
      let total = 0
      const insertItem = db.prepare(
        'INSERT INTO order_items (order_id, product_id, sku_id, sku_name, product_name, product_image, price, quantity) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      const deduct = db.prepare(
        `UPDATE product_skus SET stock=stock-?, updated_at=NOW() WHERE id=? AND product_id=? AND stock>=?`,
      )
      const touchedProducts = new Set<number>()

      const orderNo = await generateOrderNo()
      const inserted = await db.prepare(
        `INSERT INTO orders (order_no, user_id, total_amount, receiver, phone, province, city, district, detail, remark)
         VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(orderNo, uid, address.receiver, address.phone, address.province, address.city, address.district, address.detail, remark ?? '')
      const orderId = inserted.lastInsertRowid

      for (const line of lines) {
        const sku = await db.prepare(
          `SELECT s.id, s.name AS sku_name, s.price, s.stock, s.image AS sku_image,
                  p.name AS product_name, p.status
           FROM product_skus s JOIN products p ON p.id = s.product_id
           WHERE s.id=? AND p.id=?`,
        ).get<{
          id: number, sku_name: string, price: number, stock: number, sku_image: string, product_name: string, status: string
        }>(line.sku_id, line.product_id)
        if (!sku) throw new Error('商品规格不存在，请刷新后重试')
        if (sku.status !== 'on') throw new Error(`商品已下架：${sku.product_name}`)
        if ((await deduct.run(line.quantity, line.sku_id, line.product_id, line.quantity)).changes === 0) {
          throw new Error(`库存不足：${sku.product_name}（${sku.sku_name}）`)
        }
        const firstImage = sku.sku_image ? undefined : await db.prepare(
          'SELECT url FROM product_images WHERE product_id=? ORDER BY sort_order, id LIMIT 1',
        ).get<{ url: string }>(line.product_id)
        const image = sku.sku_image || firstImage?.url || ''
        await insertItem.run(orderId, line.product_id, line.sku_id, sku.sku_name, sku.product_name, image, sku.price, line.quantity)
        total += sku.price * line.quantity
        touchedProducts.add(line.product_id)
        await writeStockLog({
          product_id: line.product_id,
          sku_id: line.sku_id,
          sku_name: sku.sku_name,
          delta: -line.quantity,
          stock_after: sku.stock - line.quantity,
          reason: 'order',
          ref: orderNo,
          operator: `user:${uid}`,
        })
        if (line.cart_item_id !== undefined) await db.prepare('DELETE FROM cart_items WHERE id=?').run(line.cart_item_id)
      }

      for (const productId of touchedProducts) await syncProductDerivedFields(productId)
      await db.prepare('UPDATE orders SET total_amount=? WHERE id=?').run(Math.round(total * 100) / 100, orderId)
      return (await getOwnedOrder(uid, orderId))!
    })
    res.status(201).json({ order })
  } catch (error) {
    res.status(400).json({ errors: [error instanceof Error ? error.message : '下单失败，请重试'] })
  }
})

/** 本人订单列表（可按状态筛选，每条带明细） */
ordersRouter.get('/', async (req, res) => {
  const uid = res.locals.uid as number
  const status = String(req.query.status ?? 'all')
  const page = Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1)
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(String(req.query.pageSize ?? '10'), 10) || 10))

  const conditions = ['user_id=?']
  const params: (string | number)[] = [uid]
  if (status !== 'all' && ORDER_STATUSES.includes(status as OrderStatus)) {
    conditions.push('status=?')
    params.push(status)
  }
  const where = conditions.join(' AND ')
  const count = (await db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE ${where}`).get<{ n: number }>(...params))!
  const rows = await db.prepare(
    `SELECT * FROM orders WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
  ).all<Omit<Order, 'items'>>(...params, pageSize, (page - 1) * pageSize)

  const itemsByOrder = await getOrderItemsForOrders(rows.map((order) => order.id))
  res.json({
    orders: rows.map((order) => ({ ...order, items: itemsByOrder.get(order.id) ?? [] })),
    total: count.n,
    page,
    pageSize,
  })
})

/** 本人订单详情 */
ordersRouter.get('/:id', async (req, res) => {
  const order = await getOwnedOrder(res.locals.uid as number, req.params.id)
  if (!order) return res.status(404).json({ errors: ['订单不存在'] })
  res.json({ order })
})

/** 模拟支付：pending → paid（幂等，已支付直接返回成功） */
ordersRouter.post('/:id/pay', async (req, res) => {
  const uid = res.locals.uid as number
  const order = await getOwnedOrder(uid, req.params.id)
  if (!order) return res.status(404).json({ errors: ['订单不存在'] })
  if (order.status === 'paid') return res.json({ order })
  if (order.status !== 'pending') return res.status(400).json({ errors: ['当前订单状态不可支付'] })

  const changed = await db.prepare(
    `UPDATE orders SET status='paid', paid_at=NOW(), updated_at=NOW()
     WHERE id=? AND user_id=? AND status='pending'`,
  ).run(order.id, uid)
  if (changed.changes === 0) {
    const current = await getOwnedOrder(uid, order.id)
    if (current?.status === 'paid') return res.json({ order: current })
    return res.status(400).json({ errors: ['当前订单状态不可支付'] })
  }
  res.json({ order: await getOwnedOrder(uid, order.id) })
})

/** 取消订单：仅待支付可取消，条件认领后在同一事务内回补库存 */
ordersRouter.post('/:id/cancel', async (req, res) => {
  const uid = res.locals.uid as number
  const order = await getOwnedOrder(uid, req.params.id)
  if (!order) return res.status(404).json({ errors: ['订单不存在'] })
  if (order.status !== 'pending') return res.status(400).json({ errors: ['当前订单状态不可取消'] })

  const reason = String((req.body as Record<string, unknown> | null)?.reason ?? '').trim() || '用户取消'
  const claimed = await inTransaction(async () => {
    const changed = await db.prepare(
      `UPDATE orders SET status='cancelled' WHERE id=? AND user_id=? AND status='pending'`,
    ).run(order.id, uid)
    if (changed.changes === 0) return false
    await cancelOrderAndRestock(order.id, reason, `user:${uid}`)
    return true
  })
  if (!claimed) return res.status(400).json({ errors: ['当前订单状态不可取消'] })
  res.json({ order: await getOwnedOrder(uid, order.id) })
})

/** 确认收货：shipped → completed */
ordersRouter.post('/:id/confirm', async (req, res) => {
  const uid = res.locals.uid as number
  const order = await getOwnedOrder(uid, req.params.id)
  if (!order) return res.status(404).json({ errors: ['订单不存在'] })
  if (order.status !== 'shipped') return res.status(400).json({ errors: ['当前订单状态不可确认收货'] })

  const changed = await db.prepare(
    `UPDATE orders SET status='completed', completed_at=NOW(), updated_at=NOW()
     WHERE id=? AND user_id=? AND status='shipped'`,
  ).run(order.id, uid)
  if (changed.changes === 0) return res.status(400).json({ errors: ['当前订单状态不可确认收货'] })
  res.json({ order: await getOwnedOrder(uid, order.id) })
})
