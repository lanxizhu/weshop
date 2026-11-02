import { Router } from 'express'
import type { Category } from '@weshop/shared'
import { requireAdmin } from '../auth.js'
import { db, inTransaction } from '../db.js'

type CategoryRow = Omit<Category, 'product_count'>

export const categoriesRouter = Router()

// 管理端写操作需要管理员鉴权；GET 列表对小程序公开
categoriesRouter.use((req, res, next) => {
  if (req.method === 'GET') return next()
  return requireAdmin(req, res, next)
})

function withProductCount(c: CategoryRow): Category {
  const { product_count } = db
    .prepare('SELECT COUNT(*) AS product_count FROM products WHERE category=?')
    .get(c.name) as { product_count: number }
  return { ...c, product_count }
}

/** 分类列表（按 sort_order 排序，附带每个分类下的商品数量） */
categoriesRouter.get('/', (_req, res) => {
  const categories = db
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category = c.name) AS product_count
       FROM categories c ORDER BY c.sort_order, c.id`
    )
    .all() as unknown as Category[]
  res.json({ categories })
})

/** 新建分类（排在最后） */
categoriesRouter.post('/', (req, res) => {
  const name = String((req.body as { name?: unknown }).name ?? '').trim()
  if (!name) return res.status(400).json({ errors: ['分类名称不能为空'] })
  if (name.length > 20) return res.status(400).json({ errors: ['分类名称不能超过 20 字'] })
  if (db.prepare('SELECT 1 FROM categories WHERE name=?').get(name))
    return res.status(400).json({ errors: ['分类已存在'] })
  const r = db
    .prepare('INSERT INTO categories (name, sort_order) VALUES (?, COALESCE((SELECT MAX(sort_order) FROM categories), 0) + 1)')
    .run(name)
  const category = db.prepare('SELECT * FROM categories WHERE id=?').get(r.lastInsertRowid) as CategoryRow
  res.status(201).json({ category: { ...category, product_count: 0 } })
})

/** 调整展示顺序：ids 按期望顺序传入全部现有分类 id（须注册在 /:id 之前） */
categoriesRouter.put('/reorder', (req, res) => {
  const { ids } = req.body as { ids?: unknown }
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => Number.isInteger(Number(id)))) {
    return res.status(400).json({ errors: ['ids 必须是非空整数数组'] })
  }
  const existing = db.prepare('SELECT id FROM categories').all().map((r) => (r as { id: number }).id)
  if (ids.length !== existing.length || !existing.every((id) => ids.map(Number).includes(id))) {
    return res.status(400).json({ errors: ['ids 与现有分类不匹配'] })
  }
  inTransaction(() => {
    const stmt = db.prepare('UPDATE categories SET sort_order=? WHERE id=?')
    ids.forEach((id, i) => stmt.run(i, Number(id)))
  })
  const categories = db
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category = c.name) AS product_count
       FROM categories c ORDER BY c.sort_order, c.id`
    )
    .all() as unknown as Category[]
  res.json({ categories })
})

/** 重命名分类（同步更新该分类下所有商品） */
categoriesRouter.put('/:id', (req, res) => {
  const name = String((req.body as { name?: unknown }).name ?? '').trim()
  if (!name) return res.status(400).json({ errors: ['分类名称不能为空'] })
  if (name.length > 20) return res.status(400).json({ errors: ['分类名称不能超过 20 字'] })
  const existing = db.prepare('SELECT * FROM categories WHERE id=?').get(req.params.id) as CategoryRow | undefined
  if (!existing) return res.status(404).json({ errors: ['分类不存在'] })
  if (db.prepare('SELECT 1 FROM categories WHERE name=? AND id!=?').get(name, req.params.id))
    return res.status(400).json({ errors: ['分类已存在'] })
  inTransaction(() => {
    db.prepare('UPDATE categories SET name=? WHERE id=?').run(name, req.params.id)
    db.prepare(`UPDATE products SET category=?, updated_at=datetime('now','localtime') WHERE category=?`).run(name, existing.name)
  })
  const category = db.prepare('SELECT * FROM categories WHERE id=?').get(req.params.id) as CategoryRow
  res.json({ category: withProductCount(category) })
})

/** 删除分类：无商品直接删；有商品需带 ?migrateTo=<目标分类名> 迁移后删除 */
categoriesRouter.delete('/:id', (req, res) => {
  const cat = db.prepare('SELECT * FROM categories WHERE id=?').get(req.params.id) as CategoryRow | undefined
  if (!cat) return res.status(404).json({ errors: ['分类不存在'] })
  const used = db.prepare('SELECT COUNT(*) AS n FROM products WHERE category=?').get(cat.name) as { n: number }

  if (used.n === 0) {
    db.prepare('DELETE FROM categories WHERE id=?').run(req.params.id)
    return res.json({ ok: true, migrated: 0 })
  }

  const migrateTo = String((req.query as { migrateTo?: unknown }).migrateTo ?? '').trim()
  if (!migrateTo) {
    return res.status(400).json({ errors: [`该分类下还有 ${used.n} 个商品，请迁移后删除`] })
  }
  if (migrateTo === cat.name) return res.status(400).json({ errors: ['目标分类不能与待删除分类相同'] })
  if (!db.prepare('SELECT 1 FROM categories WHERE name=?').get(migrateTo)) {
    return res.status(400).json({ errors: ['目标分类不存在'] })
  }
  const migrated = inTransaction(() => {
    const r = db
      .prepare(`UPDATE products SET category=?, updated_at=datetime('now','localtime') WHERE category=?`)
      .run(migrateTo, cat.name)
    db.prepare('DELETE FROM categories WHERE id=?').run(req.params.id)
    return Number(r.changes)
  })
  res.json({ ok: true, migrated })
})
