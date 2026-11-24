import { Router } from 'express'
import type { RequestHandler } from 'express'
import { LOW_STOCK_THRESHOLD } from '@weshop/shared'
import type { Product, ProductSortField, ProductStats, SortOrder, StockLog } from '@weshop/shared'
import { optionalAdmin, requireAdmin } from '../auth.js'
import {
  db,
  getImages,
  getImagesForProducts,
  getProduct,
  getSkus,
  getSkusForProducts,
  inTransaction,
  productExists,
  replaceImages,
  replaceSkus,
  syncProductDerivedFields,
  writeStockLog,
} from '../db.js'
import { escapeCsvCell } from '../utils/csv.js'
import { deleteLocalUploads } from '../utils/file-cleanup.js'
import { validateProduct, validateStockDelta } from '../validate.js'

// 鉴权策略：GET 列表 / 详情对小程序公开但仅返回上架商品；有效管理员令牌可查看全部。
// export.csv、库存流水与全部写操作在路由上显式挂 requireAdmin。
// 注意：不要改回按路径字符串匹配的中间件——Express 5 路由忽略尾部斜杠且大小写不敏感，
// 字符串比对会被 /export.csv/、/EXPORT.CSV 之类的变形绕过。
export const productsRouter = Router()
productsRouter.use(optionalAdmin)

/** 排序字段白名单：防止 SQL 注入，仅允许映射内的列 */
const SORT_COLUMNS: Record<ProductSortField, string> = {
  price: 'price',
  stock: 'stock',
  updated_at: 'updated_at',
}

interface ListQuery {
  search?: string
  status?: string
  category?: string
  lowStock?: string
  page?: string
  pageSize?: string
  sort?: string
  order?: string
}

/** 组装列表过滤条件（WHERE 子句与参数），供列表与 CSV 导出复用；公开访问强制只查上架商品 */
function buildListFilter(query: ListQuery, isAdmin = false) {
  let where = isAdmin ? 'WHERE 1=1' : `WHERE status='on'`
  const params: string[] = []
  if (query.search) {
    where += ' AND (name LIKE ? OR description LIKE ?)'
    params.push(`%${query.search}%`, `%${query.search}%`)
  }
  if (isAdmin && (query.status === 'on' || query.status === 'off')) {
    where += ' AND status = ?'
    params.push(query.status)
  }
  if (query.category) {
    where += ' AND category = ?'
    params.push(query.category)
  }
  if (query.lowStock === '1') {
    where += ' AND stock < ?'
    params.push(String(LOW_STOCK_THRESHOLD))
  }
  return { where, params }
}

/** 商品列表：搜索 / 状态 / 分类 / 低库存过滤 + 排序 + 分页（带图片与规格） */
productsRouter.get('/', async (req, res) => {
  const query = req.query as ListQuery
  const { where, params } = buildListFilter(query, typeof res.locals.adminId === 'number')

  const sort: ProductSortField = query.sort && Object.hasOwn(SORT_COLUMNS, query.sort) ? query.sort as ProductSortField : 'updated_at'
  const order: SortOrder = query.order === 'asc' ? 'asc' : 'desc'
  const page = Math.max(1, Number.parseInt(query.page ?? '', 10) || 1)
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(query.pageSize ?? '', 10) || 10))

  const count = (await db.prepare(`SELECT COUNT(*) AS total FROM products ${where}`).get<{ total: number }>(...params))!
  const rows = await db.prepare(
    `SELECT * FROM products ${where}
     ORDER BY ${SORT_COLUMNS[sort]} ${order === 'asc' ? 'ASC' : 'DESC'}, id DESC
     LIMIT ? OFFSET ?`,
  ).all<Omit<Product, 'images' | 'skus'>>(...params, pageSize, (page - 1) * pageSize)

  const productIds = rows.map((product) => product.id)
  const imagesByProduct = await getImagesForProducts(productIds)
  const skusByProduct = await getSkusForProducts(productIds)
  const products: Product[] = rows.map((product) => ({
    ...product,
    images: imagesByProduct.get(product.id) ?? [],
    skus: skusByProduct.get(product.id) ?? [],
  }))
  res.json({ products, total: count.total, page, pageSize })
})

/** 概览统计（挂在 /api/stats，见 app.ts） */
export const statsHandler: RequestHandler = async (_req, res) => {
  const row = (await db.prepare(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN status='on' THEN 1 ELSE 0 END), 0) AS onShelf,
            COALESCE(SUM(CASE WHEN status='off' THEN 1 ELSE 0 END), 0) AS offShelf,
            COALESCE(ROUND(SUM(price * stock), 2), 0) AS totalValue,
            COALESCE(SUM(CASE WHEN stock < ? THEN 1 ELSE 0 END), 0) AS lowStock
     FROM products`,
  ).get<ProductStats>(String(LOW_STOCK_THRESHOLD)))!
  res.json(row)
}

/** 导出当前过滤条件下的商品为 CSV（带 BOM，Excel 打开不乱码）；须注册在 /:id 之前 */
productsRouter.get('/export.csv', requireAdmin, async (req, res) => {
  const { where, params } = buildListFilter(req.query as ListQuery, true)
  const rows = await db.prepare(
    `SELECT * FROM products ${where} ORDER BY updated_at DESC, id DESC LIMIT 5000`,
  ).all<Omit<Product, 'images' | 'skus'>>(...params)

  const escape = escapeCsvCell
  const productIds = rows.map((product) => product.id)
  const imagesByProduct = await getImagesForProducts(productIds)
  const skusByProduct = await getSkusForProducts(productIds)
  const header = 'ID,名称,分类,价格,库存,状态,描述,图片数,规格数,创建时间,更新时间'
  const lines = rows.map((product) =>
    [
      product.id,
      escape(product.name),
      escape(product.category),
      product.price,
      product.stock,
      product.status === 'on' ? '在售' : '已下架',
      escape(product.description),
      imagesByProduct.get(product.id)?.length ?? 0,
      skusByProduct.get(product.id)?.length ?? 0,
      escape(product.created_at),
      escape(product.updated_at),
    ].join(','),
  )
  const csv = `\uFEFF${header}\n${lines.join('\n')}\n`

  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', 'attachment; filename="products.csv"')
  res.send(csv)
})

/** 商品详情：公开访问不暴露下架商品，避免通过已知 id 绕过列表过滤 */
productsRouter.get('/:id', async (req, res) => {
  const product = await getProduct(req.params.id)
  const isAdmin = typeof res.locals.adminId === 'number'
  if (!product || (!isAdmin && product.status !== 'on')) return res.status(404).json({ errors: ['商品不存在'] })
  res.json({ product })
})

/** 库存流水（最新在前，最多 100 条），仅管理端可见 */
productsRouter.get('/:id/stock-logs', requireAdmin, async (req, res) => {
  if (!await productExists(req.params.id)) return res.status(404).json({ errors: ['商品不存在'] })
  const logs = await db.prepare(
    'SELECT * FROM stock_logs WHERE product_id=? ORDER BY id DESC LIMIT 100',
  ).all<StockLog>(req.params.id)
  res.json({ logs })
})

/** 批量上/下架 */
productsRouter.post('/batch-status', requireAdmin, async (req, res) => {
  const { ids, status } = req.body as { ids?: unknown, status?: unknown }
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => Number.isInteger(Number(id)))) {
    return res.status(400).json({ errors: ['ids 必须是非空整数数组'] })
  }
  if (!['on', 'off'].includes(String(status))) return res.status(400).json({ errors: ['状态不合法'] })
  const updated = await inTransaction(async () => {
    const statement = db.prepare(`UPDATE products SET status=?, updated_at=NOW() WHERE id=?`)
    let count = 0
    for (const id of ids) count += (await statement.run(String(status), Number(id))).changes
    return count
  })
  res.json({ updated })
})

/** 收集商品占用的本地上传 URL（商品图 + 规格图），供删除后清理文件 */
async function collectProductUploads(id: number | string): Promise<string[]> {
  return [...await getImages(id), ...(await getSkus(id)).map((sku) => sku.image)].filter((url) => url.startsWith('/uploads/'))
}

/** 批量删除（product_images / product_skus 由外键级联清理，事务提交后删除无人引用的图片文件） */
productsRouter.post('/batch-delete', requireAdmin, async (req, res) => {
  const { ids } = req.body as { ids?: unknown }
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => Number.isInteger(Number(id)))) {
    return res.status(400).json({ errors: ['ids 必须是非空整数数组'] })
  }
  const imageUrls: string[] = []
  for (const id of ids) imageUrls.push(...await collectProductUploads(Number(id)))
  const deleted = await inTransaction(async () => {
    const statement = db.prepare('DELETE FROM products WHERE id=?')
    let count = 0
    for (const id of ids) count += (await statement.run(Number(id))).changes
    return count
  })
  await deleteLocalUploads(imageUrls)
  res.json({ deleted })
})

/** 新建商品（规格全量写入，初始库存 > 0 的规格记 init 流水） */
productsRouter.post('/', requireAdmin, async (req, res) => {
  const { errors, value } = validateProduct(req.body)
  if (errors) return res.status(400).json({ errors })
  const result = await inTransaction(async () => {
    const inserted = await db.prepare(
      `INSERT INTO products (name, category, price, stock, description, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(value.name, value.category, value.price, value.stock, value.description, value.status)
    const productId = inserted.lastInsertRowid
    await replaceImages(productId, value.images)
    await replaceSkus(productId, value.skus)
    for (const sku of await getSkus(productId)) {
      if (sku.stock > 0) {
        await writeStockLog({
          product_id: productId,
          sku_id: sku.id,
          sku_name: sku.name,
          delta: sku.stock,
          stock_after: sku.stock,
          reason: 'init',
          operator: `admin:${res.locals.adminId}`,
        })
      }
    }
    await syncProductDerivedFields(productId)
    return productId
  })
  res.status(201).json({ product: await getProduct(result) })
})

/** 复制商品：名称加「副本」，初始状态为下架，图片与规格一并复制（不写库存流水） */
productsRouter.post('/:id/duplicate', requireAdmin, async (req, res) => {
  const source = await getProduct(req.params.id)
  if (!source) return res.status(404).json({ errors: ['商品不存在'] })
  const id = await inTransaction(async () => {
    const inserted = await db.prepare(
      `INSERT INTO products (name, category, price, stock, description, status)
       VALUES (?, ?, ?, ?, ?, 'off')`,
    ).run(
      `${String(source.name).slice(0, 44)} 副本`,
      String(source.category ?? ''),
      Number(source.price) || 0,
      Number(source.stock) || 0,
      String(source.description ?? ''),
    )
    const productId = inserted.lastInsertRowid
    await replaceImages(productId, await getImages(req.params.id))
    for (const sku of await getSkus(req.params.id)) {
      await db.prepare(
        'INSERT INTO product_skus (product_id, name, price, stock, image, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(productId, sku.name, sku.price, sku.stock, sku.image, sku.sort_order)
    }
    await syncProductDerivedFields(productId)
    return productId
  })
  res.status(201).json({ product: await getProduct(id) })
})

/** 更新商品（图片与规格全量替换；事务提交后清理不再被引用的图片文件） */
productsRouter.put('/:id', requireAdmin, async (req, res) => {
  const { errors, value } = validateProduct(req.body)
  if (errors) return res.status(400).json({ errors })
  if (!await productExists(req.params.id)) return res.status(404).json({ errors: ['商品不存在'] })

  // 校验传入的规格 id 必须属于该商品，防止越权改到别的商品规格
  const existingSkus = await getSkus(req.params.id)
  const ownedSkuIds = new Set(existingSkus.map((sku) => sku.id))
  if (value.skus.some((sku) => sku.id !== undefined && !ownedSkuIds.has(Number(sku.id)))) {
    return res.status(400).json({ errors: ['规格不属于该商品'] })
  }

  const keepIds = new Set(value.skus.filter((sku) => sku.id !== undefined).map((sku) => Number(sku.id)))
  const removedSkus = existingSkus.filter((sku) => !keepIds.has(sku.id))
  if (removedSkus.length > 0) {
    const placeholders = removedSkus.map(() => '?').join(',')
    const activeOrder = await db.prepare(
      `SELECT o.order_no FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE oi.sku_id IN (${placeholders}) AND o.status IN ('pending','paid') LIMIT 1`,
    ).get<{ order_no: string }>(...removedSkus.map((sku) => sku.id))
    if (activeOrder) {
      return res.status(400).json({ errors: [`规格仍被待处理订单 ${activeOrder.order_no} 引用，请先处理该订单后再删除`] })
    }
  }

  const oldImages = await getImages(req.params.id)
  const removedSkuImages = await inTransaction(async () => {
    await db.prepare(
      `UPDATE products SET name=?, category=?, price=?, stock=?, description=?, status=?,
       updated_at=NOW() WHERE id=?`,
    ).run(value.name, value.category, value.price, value.stock, value.description, value.status, req.params.id)
    await replaceImages(req.params.id, value.images)
    const removed = await replaceSkus(req.params.id, value.skus)
    const updatedSkus = await getSkus(req.params.id)
    const previousById = new Map(existingSkus.map((sku) => [sku.id, sku.stock]))
    for (const sku of updatedSkus) {
      const delta = sku.stock - (previousById.get(sku.id) ?? 0)
      if (delta !== 0) {
        await writeStockLog({
          product_id: req.params.id,
          sku_id: sku.id,
          sku_name: sku.name,
          delta,
          stock_after: sku.stock,
          reason: 'adjust',
          ref: '商品编辑',
          operator: `admin:${res.locals.adminId}`,
        })
      }
    }
    for (const sku of removedSkus) {
      if (sku.stock > 0) {
        await writeStockLog({
          product_id: req.params.id,
          sku_id: sku.id,
          sku_name: sku.name,
          delta: -sku.stock,
          stock_after: 0,
          reason: 'adjust',
          ref: '商品编辑：规格已删除',
          operator: `admin:${res.locals.adminId}`,
        })
      }
    }
    await syncProductDerivedFields(req.params.id)
    return removed
  })
  const removedImages = oldImages.filter((url) => !value.images.includes(url))
  await deleteLocalUploads([...removedImages, ...removedSkuImages])
  res.json({ product: await getProduct(req.params.id) })
})

/** 上/下架 */
productsRouter.patch('/:id/status', requireAdmin, async (req, res) => {
  const status = (req.body as { status?: unknown }).status
  if (!['on', 'off'].includes(String(status))) return res.status(400).json({ errors: ['状态不合法'] })
  const result = await db.prepare(
    `UPDATE products SET status=?, updated_at=NOW() WHERE id=?`,
  ).run(String(status), req.params.id)
  if (result.changes === 0) return res.status(404).json({ errors: ['商品不存在'] })
  res.json({ product: await getProduct(req.params.id) })
})

/** 按规格原子增减库存并写 adjust 流水，返回变动后的 SKU 库存；库存不足返回 null，规格不存在返回 undefined */
async function adjustSkuStock(productId: number | string, skuId: number | string, delta: number, operator: string) {
  return inTransaction(async () => {
    const result = await db.prepare(
      `UPDATE product_skus SET stock = stock + ?, updated_at=NOW()
       WHERE id=? AND product_id=? AND stock + ? >= 0`,
    ).run(delta, skuId, productId, delta)
    if (result.changes === 0) {
      const sku = await db.prepare('SELECT id FROM product_skus WHERE id=? AND product_id=?').get(skuId, productId)
      return sku ? null : undefined
    }
    const sku = (await db.prepare('SELECT name, stock FROM product_skus WHERE id=?').get<{
      name: string, stock: number
    }>(skuId))!
    await writeStockLog({
      product_id: productId,
      sku_id: Number(skuId),
      sku_name: sku.name,
      delta,
      stock_after: sku.stock,
      reason: 'adjust',
      operator,
    })
    await syncProductDerivedFields(productId)
    return sku.stock
  })
}

/** 库存增减：仅单规格商品允许（代理到该规格）；多规格请用 PATCH /:id/skus/:skuId/stock */
productsRouter.patch('/:id/stock', requireAdmin, async (req, res) => {
  const { errors, value } = validateStockDelta(req.body)
  if (errors) return res.status(400).json({ errors })
  if (!await productExists(req.params.id)) return res.status(404).json({ errors: ['商品不存在'] })
  const skus = await getSkus(req.params.id)
  if (skus.length > 1) return res.status(400).json({ errors: ['该商品有多个规格，请按规格调整库存'] })
  const single = skus[0]
  if (!single) return res.status(400).json({ errors: ['该商品没有规格，请先保存规格'] })

  const result = await adjustSkuStock(req.params.id, single.id, value.delta, `admin:${res.locals.adminId}`)
  if (result === null) return res.status(400).json({ errors: ['库存不足，无法出库'] })
  res.json({ product: await getProduct(req.params.id) })
})

/** 按规格调整库存：原子操作，库存不足时拒绝 */
productsRouter.patch('/:id/skus/:skuId/stock', requireAdmin, async (req, res) => {
  const { errors, value } = validateStockDelta(req.body)
  if (errors) return res.status(400).json({ errors })
  if (!await productExists(req.params.id)) return res.status(404).json({ errors: ['商品不存在'] })

  const result = await adjustSkuStock(req.params.id, req.params.skuId, value.delta, `admin:${res.locals.adminId}`)
  if (result === undefined) return res.status(404).json({ errors: ['规格不存在'] })
  if (result === null) return res.status(400).json({ errors: ['库存不足，无法出库'] })
  res.json({ product: await getProduct(req.params.id) })
})

/** 删除商品（图片/规格由外键级联清理，事务后删除无人引用的图片文件） */
productsRouter.delete('/:id', requireAdmin, async (req, res) => {
  const imageUrls = await collectProductUploads(req.params.id)
  const result = await db.prepare('DELETE FROM products WHERE id=?').run(req.params.id)
  if (result.changes === 0) return res.status(404).json({ errors: ['商品不存在'] })
  await deleteLocalUploads(imageUrls)
  res.json({ ok: true })
})
