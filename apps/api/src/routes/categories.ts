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

async function withProductCount(category: CategoryRow): Promise<Category> {
  const row = await db.prepare('SELECT COUNT(*) AS product_count FROM products WHERE category=?').get<{ product_count: number }>(category.name)
  return { ...category, product_count: row!.product_count }
}

async function listCategories(): Promise<Category[]> {
  return db.prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category = c.name) AS product_count
     FROM categories c ORDER BY c.sort_order, c.id`,
  ).all<Category>()
}

/** 分类列表（按 sort_order 排序，附带每个分类下的商品数量） */
categoriesRouter.get('/', async (_req, res) => {
  res.json({ categories: await listCategories() })
})

/** 新建分类（排在最后） */
categoriesRouter.post('/', async (req, res) => {
  const name = String((req.body as { name?: unknown }).name ?? '').trim()
  if (!name) return res.status(400).json({ errors: ['分类名称不能为空'] })
  if (name.length > 20) return res.status(400).json({ errors: ['分类名称不能超过 20 字'] })
  if (await db.prepare('SELECT 1 FROM categories WHERE name=?').get(name)) {
    return res.status(400).json({ errors: ['分类已存在'] })
  }
  const category = await inTransaction(async () => {
    const sortRow = (await db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM categories').get<{ m: number }>())!
    const inserted = await db.prepare('INSERT INTO categories (name, sort_order) VALUES (?, ?)').run(name, sortRow.m + 1)
    return (await db.prepare('SELECT * FROM categories WHERE id=?').get<CategoryRow>(inserted.lastInsertRowid))!
  })
  res.status(201).json({ category: { ...category, product_count: 0 } })
})

/** 调整展示顺序：ids 按期望顺序传入全部现有分类 id（须注册在 /:id 之前） */
categoriesRouter.put('/reorder', async (req, res) => {
  const { ids } = req.body as { ids?: unknown }
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => Number.isInteger(Number(id)))) {
    return res.status(400).json({ errors: ['ids 必须是非空整数数组'] })
  }
  const rows = await db.prepare('SELECT id FROM categories').all<{ id: number }>()
  const existing = rows.map((row) => row.id)
  if (ids.length !== existing.length || !existing.every((id) => ids.map(Number).includes(id))) {
    return res.status(400).json({ errors: ['ids 与现有分类不匹配'] })
  }
  await inTransaction(async () => {
    const statement = db.prepare('UPDATE categories SET sort_order=? WHERE id=?')
    for (const [index, id] of ids.entries()) await statement.run(index, Number(id))
  })
  res.json({ categories: await listCategories() })
})

/** 重命名分类（同步更新该分类下所有商品） */
categoriesRouter.put('/:id', async (req, res) => {
  const name = String((req.body as { name?: unknown }).name ?? '').trim()
  if (!name) return res.status(400).json({ errors: ['分类名称不能为空'] })
  if (name.length > 20) return res.status(400).json({ errors: ['分类名称不能超过 20 字'] })
  const existing = await db.prepare('SELECT * FROM categories WHERE id=?').get<CategoryRow>(req.params.id)
  if (!existing) return res.status(404).json({ errors: ['分类不存在'] })
  if (await db.prepare('SELECT 1 FROM categories WHERE name=? AND id!=?').get(name, req.params.id)) {
    return res.status(400).json({ errors: ['分类已存在'] })
  }
  await inTransaction(async () => {
    await db.prepare('UPDATE categories SET name=? WHERE id=?').run(name, req.params.id)
    await db.prepare(`UPDATE products SET category=?, updated_at=NOW() WHERE category=?`).run(name, existing.name)
  })
  const category = (await db.prepare('SELECT * FROM categories WHERE id=?').get<CategoryRow>(req.params.id))!
  res.json({ category: await withProductCount(category) })
})

/** 删除分类：无商品直接删；有商品需带 ?migrateTo=<目标分类名> 迁移后删除 */
categoriesRouter.delete('/:id', async (req, res) => {
  const category = await db.prepare('SELECT * FROM categories WHERE id=?').get<CategoryRow>(req.params.id)
  if (!category) return res.status(404).json({ errors: ['分类不存在'] })
  const used = (await db.prepare('SELECT COUNT(*) AS n FROM products WHERE category=?').get<{ n: number }>(category.name))!

  if (used.n === 0) {
    await db.prepare('DELETE FROM categories WHERE id=?').run(req.params.id)
    return res.json({ ok: true, migrated: 0 })
  }

  const migrateTo = String((req.query as { migrateTo?: unknown }).migrateTo ?? '').trim()
  if (!migrateTo) {
    return res.status(400).json({ errors: [`该分类下还有 ${used.n} 个商品，请迁移后删除`] })
  }
  if (migrateTo === category.name) return res.status(400).json({ errors: ['目标分类不能与待删除分类相同'] })
  if (!await db.prepare('SELECT 1 FROM categories WHERE name=?').get(migrateTo)) {
    return res.status(400).json({ errors: ['目标分类不存在'] })
  }
  const migrated = await inTransaction(async () => {
    const result = await db.prepare(
      `UPDATE products SET category=?, updated_at=NOW() WHERE category=?`,
    ).run(migrateTo, category.name)
    await db.prepare('DELETE FROM categories WHERE id=?').run(req.params.id)
    return result.changes
  })
  res.json({ ok: true, migrated })
})
