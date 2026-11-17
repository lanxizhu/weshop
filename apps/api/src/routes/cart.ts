import { Router } from 'express'
import type { CartItem, CartListResult } from '@weshop/shared'
import { MAX_CART_ITEM_QUANTITY } from '@weshop/shared'
import { requireAuth } from '../auth.js'
import { db } from '../db.js'
import { validateCartAdd, validateCartQuantity } from '../validate.js'

export const cartRouter = Router()

// 购物车全部接口都需要登录，uid 取自令牌而非请求参数
cartRouter.use(requireAuth)

interface CartRow {
  id: number
  user_id: number
  product_id: number
  sku_id: number
  quantity: number
  created_at: string
  updated_at: string
  name: string
  status: 'on' | 'off'
  sku_name: string
  sku_price: number
  sku_stock: number
  image: string
}

/** 购物车行 → 响应项：价格/库存/小计/失效标记全部按 SKU 计算，图片由 SQL 回退到商品首图 */
function toCartItem(row: CartRow): CartItem {
  const subtotal = Math.round(row.sku_price * row.quantity * 100) / 100
  return {
    id: row.id,
    user_id: row.user_id,
    product_id: row.product_id,
    sku_id: row.sku_id,
    quantity: row.quantity,
    created_at: row.created_at,
    updated_at: row.updated_at,
    name: row.name,
    sku_name: row.sku_name,
    price: row.sku_price,
    stock: row.sku_stock,
    status: row.status,
    image: row.image,
    subtotal,
    invalid: row.status !== 'on' || row.sku_stock < row.quantity,
  }
}

function listCart(uid: number): CartListResult {
  const rows = db
    .prepare(
      `SELECT c.*, p.name, p.status, s.name AS sku_name, s.price AS sku_price, s.stock AS sku_stock,
              COALESCE(NULLIF(s.image, ''), (
                SELECT i.url FROM product_images i WHERE i.product_id=c.product_id ORDER BY i.sort_order, i.id LIMIT 1
              )) AS image
       FROM cart_items c
       JOIN product_skus s ON s.id = c.sku_id
       JOIN products p ON p.id = c.product_id
       WHERE c.user_id=? ORDER BY c.id DESC`
    )
    .all(uid) as unknown as CartRow[]
  const items = rows.map(toCartItem)
  const valid = items.filter((i) => !i.invalid)
  return {
    items,
    total_quantity: valid.reduce((s, i) => s + i.quantity, 0),
    total_amount: Math.round(valid.reduce((s, i) => s + i.subtotal, 0) * 100) / 100,
  }
}

/** 仅按「归属当前用户」查询购物车项，防止越权读写 */
function getOwnedItem(uid: number, id: number | string) {
  return db.prepare('SELECT * FROM cart_items WHERE id=? AND user_id=?').get(id, uid) as
    | { id: number; product_id: number; sku_id: number; quantity: number }
    | undefined
}

/** 查询规格及其所属商品（用于校验规格属于该商品且商品在售） */
function getSkuWithProduct(productId: number, skuId: number) {
  return db
    .prepare(
      `SELECT s.id AS sku_id, s.name AS sku_name, s.stock, p.name AS product_name, p.status
       FROM product_skus s JOIN products p ON p.id = s.product_id
       WHERE s.id=? AND p.id=?`
    )
    .get(skuId, productId) as
    | { sku_id: number; sku_name: string; stock: number; product_name: string; status: string }
    | undefined
}

/** 购物车列表 */
cartRouter.get('/', (_req, res) => {
  res.json(listCart(res.locals.uid as number))
})

/** 加购：同规格已存在则累加数量（封顶 99 且不超过 SKU 库存） */
cartRouter.post('/', (req, res) => {
  const uid = res.locals.uid as number
  const result = validateCartAdd(req.body)
  if (result.errors) return res.status(400).json({ errors: result.errors })

  const { product_id, sku_id, quantity } = result.value
  const sku = getSkuWithProduct(product_id, sku_id)
  if (!sku) return res.status(404).json({ errors: ['规格不存在'] })
  if (sku.status !== 'on') return res.status(400).json({ errors: [`商品已下架：${sku.product_name}`] })

  const existing = db.prepare('SELECT id, quantity FROM cart_items WHERE user_id=? AND sku_id=?').get(uid, sku_id) as
    | { id: number; quantity: number }
    | undefined
  const next = Math.min((existing?.quantity ?? 0) + quantity, MAX_CART_ITEM_QUANTITY)
  if (next > sku.stock) return res.status(400).json({ errors: [`库存不足：${sku.product_name}（${sku.sku_name}）仅剩 ${sku.stock} 件`] })

  if (existing) {
    db.prepare(`UPDATE cart_items SET quantity=?, updated_at=datetime('now','localtime') WHERE id=?`).run(next, existing.id)
  } else {
    db.prepare('INSERT INTO cart_items (user_id, product_id, sku_id, quantity) VALUES (?, ?, ?, ?)').run(uid, product_id, sku_id, next)
  }
  res.status(201).json(listCart(uid))
})

/** 修改数量（仅本人记录，不超过 SKU 库存） */
cartRouter.put('/:id', (req, res) => {
  const uid = res.locals.uid as number
  const existing = getOwnedItem(uid, req.params.id)
  if (!existing) return res.status(404).json({ errors: ['购物车记录不存在'] })

  const result = validateCartQuantity(req.body)
  if (result.errors) return res.status(400).json({ errors: result.errors })

  const sku = getSkuWithProduct(existing.product_id, existing.sku_id)
  if (sku && result.value.quantity > sku.stock) {
    return res.status(400).json({ errors: [`库存不足：${sku.product_name}（${sku.sku_name}）仅剩 ${sku.stock} 件`] })
  }

  db.prepare(`UPDATE cart_items SET quantity=?, updated_at=datetime('now','localtime') WHERE id=?`).run(
    result.value.quantity,
    existing.id
  )
  res.json(listCart(uid))
})

/** 删除购物车项（仅本人记录） */
cartRouter.delete('/:id', (req, res) => {
  const uid = res.locals.uid as number
  const existing = getOwnedItem(uid, req.params.id)
  if (!existing) return res.status(404).json({ errors: ['购物车记录不存在'] })

  db.prepare('DELETE FROM cart_items WHERE id=?').run(existing.id)
  res.json({ ok: true })
})
