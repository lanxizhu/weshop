import fs from 'node:fs'
import type { Admin, Sku, SkuInput, StockLog, User } from '@weshop/shared'
import { ADMIN_PASSWORD, ADMIN_USERNAME, UPLOAD_DIR } from './config.js'
import { createDatabaseAdapter } from './database.js'
import { logger } from './logger.js'
import { hashPassword } from './password.js'
import { initializeSchema } from './schema.js'

fs.mkdirSync(UPLOAD_DIR, { recursive: true })

export const db = createDatabaseAdapter()
await initializeSchema(db)
logger.info('MySQL 数据库已初始化')

type EntityId = number | string | bigint

export async function getImages(productId: EntityId): Promise<string[]> {
  const rows = await db.prepare(
    'SELECT url FROM product_images WHERE product_id=? ORDER BY sort_order, id',
  ).all<{ url: string }>(productId)
  return rows.map((row) => row.url)
}

/** 批量读取商品图片并保持组内 sort_order / id 顺序，避免列表逐项查询 */
export async function getImagesForProducts(productIds: EntityId[]): Promise<Map<number, string[]>> {
  const grouped = new Map<number, string[]>()
  if (productIds.length === 0) return grouped
  const placeholders = productIds.map(() => '?').join(',')
  const rows = await db.prepare(
    `SELECT product_id, url FROM product_images WHERE product_id IN (${placeholders})
     ORDER BY product_id, sort_order, id`,
  ).all<{ product_id: number, url: string }>(...productIds)
  for (const row of rows) {
    const id = Number(row.product_id)
    grouped.set(id, [...(grouped.get(id) ?? []), row.url])
  }
  return grouped
}

export async function replaceImages(productId: EntityId, images: string[]): Promise<void> {
  await db.prepare('DELETE FROM product_images WHERE product_id=?').run(productId)
  const insert = db.prepare('INSERT INTO product_images (product_id, url, sort_order) VALUES (?, ?, ?)')
  for (const [index, url] of images.entries()) await insert.run(productId, url, index)
}

export async function getProduct(id: EntityId): Promise<Record<string, unknown> | undefined> {
  const product = await db.prepare('SELECT * FROM products WHERE id = ?').get<Record<string, unknown>>(id)
  if (product) {
    product.images = await getImages(id)
    product.skus = await getSkus(id)
  }
  return product
}

/** 商品规格列表（按 sort_order, id 排序） */
export async function getSkus(productId: EntityId): Promise<Sku[]> {
  return db.prepare('SELECT * FROM product_skus WHERE product_id=? ORDER BY sort_order, id').all<Sku>(productId)
}

/** 批量读取商品规格并保持组内排序，空 id 列表不生成 IN () */
export async function getSkusForProducts(productIds: EntityId[]): Promise<Map<number, Sku[]>> {
  const grouped = new Map<number, Sku[]>()
  if (productIds.length === 0) return grouped
  const placeholders = productIds.map(() => '?').join(',')
  const rows = await db.prepare(
    `SELECT * FROM product_skus WHERE product_id IN (${placeholders})
     ORDER BY product_id, sort_order, id`,
  ).all<Sku>(...productIds)
  for (const row of rows) {
    const id = Number(row.product_id)
    grouped.set(id, [...(grouped.get(id) ?? []), row])
  }
  return grouped
}

/**
 * 全量替换商品规格：有 id 更新、无 id 新建、缺失 id 删除（被删规格的购物车项由外键级联清掉）。
 * 返回被删除规格的图片地址，供事务提交后做文件清理。
 */
export async function replaceSkus(productId: EntityId, skus: SkuInput[]): Promise<string[]> {
  const existing = await getSkus(productId)
  const keepIds = new Set(skus.filter((s) => s.id !== undefined).map((s) => Number(s.id)))
  const removed = existing.filter((s) => !keepIds.has(s.id))
  const del = db.prepare('DELETE FROM product_skus WHERE id=? AND product_id=?')
  for (const sku of removed) await del.run(sku.id, productId)

  const update = db.prepare(
    `UPDATE product_skus SET name=?, price=?, stock=?, image=?, sort_order=?,
     updated_at=NOW() WHERE id=? AND product_id=?`,
  )
  const insert = db.prepare(
    'INSERT INTO product_skus (product_id, name, price, stock, image, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
  )
  for (const [index, sku] of skus.entries()) {
    const image = sku.image ?? ''
    if (sku.id !== undefined) await update.run(sku.name, sku.price, sku.stock, image, index, sku.id, productId)
    else await insert.run(productId, sku.name, sku.price, sku.stock, image, index)
  }
  return removed.map((sku) => sku.image).filter(Boolean)
}

/** 把 SKU 的最低价 / 库存总和写回 products 派生字段（列表排序、低库存过滤、统计都依赖它们） */
export async function syncProductDerivedFields(productId: EntityId): Promise<void> {
  await db.prepare(
    `UPDATE products SET
       price = COALESCE((SELECT MIN(price) FROM product_skus WHERE product_id=?), price),
       stock = COALESCE((SELECT SUM(stock) FROM product_skus WHERE product_id=?), stock),
       updated_at=NOW()
     WHERE id=?`,
  ).run(productId, productId, productId)
}

export interface StockLogEntry {
  product_id: number | string | bigint
  sku_id: number
  sku_name: string
  /** 变动量：正数入库、负数出库 */
  delta: number
  /** 变动后该 SKU 的库存 */
  stock_after: number
  reason: StockLog['reason']
  /** 订单号或说明 */
  ref?: string
  /** 操作者，形如 admin:<aid> / user:<uid> */
  operator?: string
}

export async function writeStockLog(entry: StockLogEntry): Promise<void> {
  await db.prepare(
    `INSERT INTO stock_logs (product_id, sku_id, sku_name, delta, stock_after, reason, ref, operator)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.product_id,
    entry.sku_id,
    entry.sku_name,
    entry.delta,
    entry.stock_after,
    entry.reason,
    entry.ref ?? '',
    entry.operator ?? '',
  )
}

export async function productExists(id: EntityId): Promise<boolean> {
  return Boolean(await db.prepare('SELECT 1 FROM products WHERE id=?').get(id))
}

/** 在事务中执行 fn，出错自动回滚，事务内所有查询绑定同一 MySQL 连接 */
export function inTransaction<T>(fn: () => Promise<T>): Promise<T> {
  return db.transaction(fn)
}

export async function getUserById(id: number): Promise<User | undefined> {
  return db.prepare('SELECT * FROM users WHERE id=?').get<User>(id)
}

/** 按 openid 查找或创建用户；资料字段非空时同步更新 */
export async function upsertUserByOpenid(
  openid: string,
  profile: { nick_name?: string, avatar_url?: string },
): Promise<User> {
  const nick = profile.nick_name?.trim()
  const avatar = profile.avatar_url?.trim()
  const existing = await db.prepare('SELECT * FROM users WHERE openid=?').get<User>(openid)
  if (existing) {
    if (nick || avatar) {
      await db.prepare(
        `UPDATE users SET nick_name=COALESCE(?, nick_name), avatar_url=COALESCE(?, avatar_url),
         updated_at=NOW() WHERE id=?`,
      ).run(nick || null, avatar || null, existing.id)
      return (await getUserById(existing.id))!
    }
    return existing
  }
  const result = await db.prepare(
    'INSERT INTO users (openid, nick_name, avatar_url) VALUES (?, ?, ?)',
  ).run(openid, nick || '微信用户', avatar || '')
  return (await getUserById(result.lastInsertRowid))!
}

export async function getAdminById(id: number): Promise<Admin | undefined> {
  return db.prepare('SELECT id, username, created_at, updated_at FROM admins WHERE id=?').get<Admin>(id)
}

/** 按用户名查管理员（含密码哈希，仅用于登录校验） */
export async function getAdminAuthByUsername(
  username: string,
): Promise<(Admin & { password_hash: string }) | undefined> {
  return db.prepare('SELECT * FROM admins WHERE username=?').get<Admin & { password_hash: string }>(username)
}

/** 按 id 查管理员（含密码哈希与令牌版本，仅用于鉴权与改密校验，不要直接返回给前端） */
export async function getAdminAuthById(
  id: number,
): Promise<(Admin & { password_hash: string, token_version: number }) | undefined> {
  return db.prepare('SELECT * FROM admins WHERE id=?').get<Admin & { password_hash: string, token_version: number }>(id)
}

/** 修改管理员密码：更新哈希并递增 token_version，使该管理员既有令牌全部立即失效 */
export async function updateAdminPassword(id: number, passwordHash: string): Promise<void> {
  await db.prepare(
    `UPDATE admins SET password_hash=?, token_version=token_version+1,
     updated_at=NOW() WHERE id=?`,
  ).run(passwordHash, id)
}

export async function createAdmin(username: string, passwordHash: string): Promise<Admin> {
  const result = await db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(username, passwordHash)
  return (await getAdminById(result.lastInsertRowid))!
}

const adminCount = await db.prepare('SELECT COUNT(*) AS n FROM admins').get<{ n: number }>()
if (adminCount!.n === 0) {
  await createAdmin(ADMIN_USERNAME, await hashPassword(ADMIN_PASSWORD))
  logger.warn(
    `已创建初始管理员账号（username=${ADMIN_USERNAME}）；生产环境请务必通过 API_ADMIN_USERNAME/API_ADMIN_PASSWORD 覆盖默认口令`,
  )
}

export async function closeDatabase(): Promise<void> {
  await db.close()
}
