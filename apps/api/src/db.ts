import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import type { Admin, Sku, SkuInput, StockLog, User } from '@weshop/shared'
import { ADMIN_PASSWORD, ADMIN_USERNAME, DB_PATH, UPLOAD_DIR } from './config.js'
import { logger } from './logger.js'
import { hashPassword } from './password.js'

fs.mkdirSync(UPLOAD_DIR, { recursive: true })

export const db = new DatabaseSync(DB_PATH)

// WAL 允许读写并发；外键约束保证 ON DELETE CASCADE 生效；多实例写入冲突时短暂等待
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')
db.exec('PRAGMA busy_timeout = 5000')

db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '',
    price REAL NOT NULL DEFAULT 0 CHECK(price >= 0),
    stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0),
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'on' CHECK(status IN ('on','off')),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS product_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id);

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    openid TEXT NOT NULL UNIQUE,
    nick_name TEXT NOT NULL DEFAULT '微信用户',
    avatar_url TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'normal',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    -- 令牌版本号：签发 token 时写入 payload，改密时 +1 使旧 token 全部失效
    token_version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS system_setting_defaults (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS addresses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver TEXT NOT NULL,
    phone TEXT NOT NULL,
    province TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    district TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_addresses_user ON addresses(user_id);

  CREATE TABLE IF NOT EXISTS cart_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    sku_id INTEGER NOT NULL REFERENCES product_skus(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(user_id, sku_id)
  );
  CREATE INDEX IF NOT EXISTS idx_cart_items_user ON cart_items(user_id);

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','shipped','completed','cancelled')),
    total_amount REAL NOT NULL DEFAULT 0 CHECK(total_amount >= 0),
    receiver TEXT NOT NULL,
    phone TEXT NOT NULL,
    province TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    district TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL,
    remark TEXT NOT NULL DEFAULT '',
    paid_at TEXT,
    shipped_at TEXT,
    completed_at TEXT,
    cancelled_at TEXT,
    cancel_reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL,
    sku_id INTEGER NOT NULL DEFAULT 0,
    sku_name TEXT NOT NULL DEFAULT '',
    product_name TEXT NOT NULL,
    product_image TEXT NOT NULL DEFAULT '',
    price REAL NOT NULL CHECK(price >= 0),
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

  CREATE TABLE IF NOT EXISTS product_skus (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    price REAL NOT NULL DEFAULT 0 CHECK(price >= 0),
    stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0),
    image TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_product_skus_product ON product_skus(product_id);

  CREATE TABLE IF NOT EXISTS stock_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    sku_id INTEGER NOT NULL DEFAULT 0,
    sku_name TEXT NOT NULL DEFAULT '',
    delta INTEGER NOT NULL,
    stock_after INTEGER NOT NULL,
    reason TEXT NOT NULL CHECK(reason IN ('init','order','cancel','adjust')),
    ref TEXT NOT NULL DEFAULT '',
    operator TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_stock_logs_product ON stock_logs(product_id);
`)

// 高频筛选 / 排序及上传文件引用统计索引（IF NOT EXISTS 可平滑迁移存量数据库）
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_products_status_updated ON products(status, updated_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS idx_products_updated_at ON products(updated_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
  CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status, created_at);
  CREATE INDEX IF NOT EXISTS idx_product_images_url ON product_images(url);
  CREATE INDEX IF NOT EXISTS idx_product_skus_image ON product_skus(image);
  CREATE INDEX IF NOT EXISTS idx_users_avatar_url ON users(avatar_url);
  CREATE INDEX IF NOT EXISTS idx_order_items_product_image ON order_items(product_image);
`)

// ---------- 轻量迁移：categories.sort_order（兼容已有 data.db） ----------

const categoryCols = db.prepare(`PRAGMA table_info(categories)`).all() as Array<{ name: string }>
if (!categoryCols.some((c) => c.name === 'sort_order')) {
  db.exec(`ALTER TABLE categories ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`)
  db.exec(`UPDATE categories SET sort_order = id`)
}

// ---------- 轻量迁移：admins.token_version（令牌吊销用，兼容已有 data.db） ----------

const adminCols = db.prepare(`PRAGMA table_info(admins)`).all() as Array<{ name: string }>
if (!adminCols.some((c) => c.name === 'token_version')) {
  db.exec(`ALTER TABLE admins ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0`)
}

// ---------- 轻量迁移：SKU 体系 / 库存流水 / 用户状态（兼容已有 data.db，幂等） ----------

db.exec('BEGIN')
try {
  // users.status（SQLite 的 ALTER ADD COLUMN 不支持 CHECK，状态合法性由路由层校验）
  const userCols = db.prepare(`PRAGMA table_info(users)`).all() as Array<{ name: string }>
  if (!userCols.some((c) => c.name === 'status')) {
    db.exec(`ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'normal'`)
  }

  // order_items 快照字段：sku_id 纯快照不加外键
  const orderItemCols = db.prepare(`PRAGMA table_info(order_items)`).all() as Array<{ name: string }>
  if (!orderItemCols.some((c) => c.name === 'sku_id')) {
    db.exec(`ALTER TABLE order_items ADD COLUMN sku_id INTEGER NOT NULL DEFAULT 0`)
  }
  if (!orderItemCols.some((c) => c.name === 'sku_name')) {
    db.exec(`ALTER TABLE order_items ADD COLUMN sku_name TEXT NOT NULL DEFAULT ''`)
  }

  // 为没有任何规格的存量商品补默认 SKU（价格/库存取商品现值，图片取首图）
  const orphanProducts = db
    .prepare(
      `SELECT p.id, p.price, p.stock FROM products p
       WHERE NOT EXISTS (SELECT 1 FROM product_skus s WHERE s.product_id = p.id)`
    )
    .all() as unknown as Array<{ id: number; price: number; stock: number }>
  const insertDefaultSku = db.prepare(
    `INSERT INTO product_skus (product_id, name, price, stock, image) VALUES (?, '默认规格', ?, ?, ?)`
  )
  for (const p of orphanProducts) {
    const firstImage = (
      db.prepare('SELECT url FROM product_images WHERE product_id=? ORDER BY sort_order, id LIMIT 1').get(p.id) as
        | { url: string }
        | undefined
    )?.url ?? ''
    insertDefaultSku.run(p.id, p.price, p.stock, firstImage)
  }
  if (orphanProducts.length) logger.info(`迁移：为 ${orphanProducts.length} 个存量商品补齐默认规格`)

  // cart_items 需要 sku_id 且 UNIQUE 改为 (user_id, sku_id)：SQLite 改不了约束，重建表
  const cartCols = db.prepare(`PRAGMA table_info(cart_items)`).all() as Array<{ name: string }>
  if (!cartCols.some((c) => c.name === 'sku_id')) {
    db.exec(`
      CREATE TABLE cart_items_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        sku_id INTEGER NOT NULL REFERENCES product_skus(id) ON DELETE CASCADE,
        quantity INTEGER NOT NULL CHECK(quantity > 0),
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        UNIQUE(user_id, sku_id)
      );
      -- 回填为该商品的默认 SKU（按 sort_order, id 的第一条）；无规格的脏行直接丢弃
      INSERT INTO cart_items_new (id, user_id, product_id, sku_id, quantity, created_at, updated_at)
      SELECT c.id, c.user_id, c.product_id,
             (SELECT s.id FROM product_skus s WHERE s.product_id = c.product_id ORDER BY s.sort_order, s.id LIMIT 1),
             c.quantity, c.created_at, c.updated_at
      FROM cart_items c
      WHERE EXISTS (SELECT 1 FROM product_skus s WHERE s.product_id = c.product_id);
      DROP TABLE cart_items;
      ALTER TABLE cart_items_new RENAME TO cart_items;
      CREATE INDEX IF NOT EXISTS idx_cart_items_user ON cart_items(user_id);
    `)
    logger.info('迁移：cart_items 已重建（sku_id + UNIQUE(user_id, sku_id)）')
  }

  db.exec('COMMIT')
} catch (e) {
  db.exec('ROLLBACK')
  throw e
}

// ---------- 商品图片辅助 ----------

export function getImages(productId: number | string | bigint): string[] {
  return db
    .prepare('SELECT url FROM product_images WHERE product_id=? ORDER BY sort_order, id')
    .all(productId)
    .map((r) => (r as { url: string }).url)
}

/** 批量读取商品图片并保持组内 sort_order / id 顺序，避免列表逐项查询 */
export function getImagesForProducts(productIds: Array<number | string | bigint>): Map<number, string[]> {
  const grouped = new Map<number, string[]>()
  if (productIds.length === 0) return grouped
  const placeholders = productIds.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT product_id, url FROM product_images WHERE product_id IN (${placeholders})
       ORDER BY product_id, sort_order, id`
    )
    .all(...productIds) as unknown as Array<{ product_id: number, url: string }>
  for (const row of rows) {
    const id = Number(row.product_id)
    grouped.set(id, [...(grouped.get(id) ?? []), row.url])
  }
  return grouped
}

export function replaceImages(productId: number | string | bigint, images: string[]): void {
  db.prepare('DELETE FROM product_images WHERE product_id=?').run(productId)
  const insert = db.prepare('INSERT INTO product_images (product_id, url, sort_order) VALUES (?, ?, ?)')
  images.forEach((url, i) => insert.run(productId, url, i))
}

export function getProduct(id: number | string | bigint) {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (product) {
    product.images = getImages(id)
    product.skus = getSkus(id)
  }
  return product
}

// ---------- 商品规格（SKU）辅助 ----------

/** 商品规格列表（按 sort_order, id 排序） */
export function getSkus(productId: number | string | bigint): Sku[] {
  return db
    .prepare('SELECT * FROM product_skus WHERE product_id=? ORDER BY sort_order, id')
    .all(productId) as unknown as Sku[]
}

/** 批量读取商品规格并保持组内排序，空 id 列表不生成 IN () */
export function getSkusForProducts(productIds: Array<number | string | bigint>): Map<number, Sku[]> {
  const grouped = new Map<number, Sku[]>()
  if (productIds.length === 0) return grouped
  const placeholders = productIds.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT * FROM product_skus WHERE product_id IN (${placeholders})
       ORDER BY product_id, sort_order, id`
    )
    .all(...productIds) as unknown as Sku[]
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
export function replaceSkus(productId: number | string | bigint, skus: SkuInput[]): string[] {
  const existing = getSkus(productId)
  const keepIds = new Set(skus.filter((s) => s.id !== undefined).map((s) => Number(s.id)))
  const removed = existing.filter((s) => !keepIds.has(s.id))
  const del = db.prepare('DELETE FROM product_skus WHERE id=? AND product_id=?')
  for (const s of removed) del.run(s.id, productId)

  const update = db.prepare(
    `UPDATE product_skus SET name=?, price=?, stock=?, image=?, sort_order=?,
     updated_at=datetime('now','localtime') WHERE id=? AND product_id=?`
  )
  const insert = db.prepare(
    'INSERT INTO product_skus (product_id, name, price, stock, image, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
  )
  skus.forEach((s, i) => {
    const image = s.image ?? ''
    if (s.id !== undefined) update.run(s.name, s.price, s.stock, image, i, s.id, productId)
    else insert.run(productId, s.name, s.price, s.stock, image, i)
  })
  return removed.map((s) => s.image).filter(Boolean)
}

/** 把 SKU 的最低价 / 库存总和写回 products 派生字段（列表排序、低库存过滤、统计都依赖它们） */
export function syncProductDerivedFields(productId: number | string | bigint): void {
  db.prepare(
    `UPDATE products SET
       price = COALESCE((SELECT MIN(price) FROM product_skus WHERE product_id=?), price),
       stock = COALESCE((SELECT SUM(stock) FROM product_skus WHERE product_id=?), stock),
       updated_at=datetime('now','localtime')
     WHERE id=?`
  ).run(productId, productId, productId)
}

// ---------- 库存流水辅助 ----------

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

export function writeStockLog(entry: StockLogEntry): void {
  db.prepare(
    `INSERT INTO stock_logs (product_id, sku_id, sku_name, delta, stock_after, reason, ref, operator)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    entry.product_id,
    entry.sku_id,
    entry.sku_name,
    entry.delta,
    entry.stock_after,
    entry.reason,
    entry.ref ?? '',
    entry.operator ?? ''
  )
}

export function productExists(id: number | string | bigint): boolean {
  return !!db.prepare('SELECT 1 FROM products WHERE id=?').get(id)
}

/** 在事务中执行 fn，出错自动回滚 */
export function inTransaction<T>(fn: () => T): T {
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

// ---------- 用户辅助 ----------

export function getUserById(id: number): User | undefined {
  return db.prepare('SELECT * FROM users WHERE id=?').get(id) as User | undefined
}

/** 按 openid 查找或创建用户；资料字段非空时同步更新 */
export function upsertUserByOpenid(
  openid: string,
  profile: { nick_name?: string; avatar_url?: string }
): User {
  const nick = profile.nick_name?.trim()
  const avatar = profile.avatar_url?.trim()
  const existing = db.prepare('SELECT * FROM users WHERE openid=?').get(openid) as User | undefined
  if (existing) {
    if (nick || avatar) {
      db.prepare(
        `UPDATE users SET nick_name=COALESCE(?, nick_name), avatar_url=COALESCE(?, avatar_url),
         updated_at=datetime('now','localtime') WHERE id=?`
      ).run(nick || null, avatar || null, existing.id)
      return getUserById(existing.id)!
    }
    return existing
  }
  const r = db
    .prepare('INSERT INTO users (openid, nick_name, avatar_url) VALUES (?, ?, ?)')
    .run(openid, nick || '微信用户', avatar || '')
  return getUserById(Number(r.lastInsertRowid))!
}

// ---------- 管理员辅助 ----------

export function getAdminById(id: number): Admin | undefined {
  return db
    .prepare('SELECT id, username, created_at, updated_at FROM admins WHERE id=?')
    .get(id) as Admin | undefined
}

/** 按用户名查管理员（含密码哈希，仅用于登录校验） */
export function getAdminAuthByUsername(username: string): (Admin & { password_hash: string }) | undefined {
  return db.prepare('SELECT * FROM admins WHERE username=?').get(username) as
    | (Admin & { password_hash: string })
    | undefined
}

/** 按 id 查管理员（含密码哈希与令牌版本，仅用于鉴权与改密校验，不要直接返回给前端） */
export function getAdminAuthById(id: number): (Admin & { password_hash: string; token_version: number }) | undefined {
  return db.prepare('SELECT * FROM admins WHERE id=?').get(id) as
    | (Admin & { password_hash: string; token_version: number })
    | undefined
}

/** 修改管理员密码：更新哈希并递增 token_version，使该管理员既有令牌全部立即失效 */
export function updateAdminPassword(id: number, passwordHash: string): void {
  db.prepare(
    `UPDATE admins SET password_hash=?, token_version=token_version+1,
     updated_at=datetime('now','localtime') WHERE id=?`
  ).run(passwordHash, id)
}

export function createAdmin(username: string, passwordHash: string): Admin {
  const r = db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(username, passwordHash)
  return getAdminById(Number(r.lastInsertRowid))!
}

// ---------- 初始管理员种子（仅 admins 为空时创建） ----------

const adminCount = db.prepare('SELECT COUNT(*) AS n FROM admins').get() as { n: number }
if (adminCount.n === 0) {
  createAdmin(ADMIN_USERNAME, await hashPassword(ADMIN_PASSWORD))
  logger.warn(
    `已创建初始管理员账号（username=${ADMIN_USERNAME}）；生产环境请务必通过 API_ADMIN_USERNAME/API_ADMIN_PASSWORD 覆盖默认口令`
  )
}
