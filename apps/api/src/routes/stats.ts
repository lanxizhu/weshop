import { Router } from 'express'
import type {
  CategorySales,
  DashboardOverview,
  DashboardStats,
  OrderStatus,
  OrderStatusStat,
  TopProduct,
} from '@weshop/shared'
import { db } from '../db.js'

// 鉴权由 app.ts 挂载点的 requireAdmin 统一处理
export const statsRouter = Router()

/** 成交口径：已支付及之后的订单计入营收 */
const VALID_STATUSES = `('paid','shipped','completed')`

/** 把 Date 格式化为本地 YYYY-MM-DD（与 SQLite datetime('now','localtime') 对齐） */
function fmtDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 近 N 天（含今天）的日期序列，升序 */
function recentDays(days: number): string[] {
  const today = new Date()
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(today)
    d.setDate(d.getDate() - (days - 1 - i))
    return fmtDate(d)
  })
}

function getOverview(): DashboardOverview {
  const row = db
    .prepare(
      `SELECT
         COUNT(*) AS totalOrders,
         COALESCE(ROUND(SUM(CASE WHEN status IN ${VALID_STATUSES} THEN total_amount END), 2), 0) AS totalRevenue,
         SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) AS pendingShipment,
         SUM(CASE WHEN date(created_at) = date('now','localtime') THEN 1 ELSE 0 END) AS todayOrders,
         COALESCE(ROUND(SUM(CASE WHEN status IN ${VALID_STATUSES} AND date(created_at) = date('now','localtime') THEN total_amount END), 2), 0) AS todayRevenue
       FROM orders`
    )
    .get() as unknown as Omit<DashboardOverview, 'totalUsers'>
  const { n: totalUsers } = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }
  return { ...row, totalUsers }
}

function getTrend(days: number): DashboardStats['trend'] {
  const rows = db
    .prepare(
      `SELECT date(created_at) AS date,
              COUNT(*) AS orders,
              ROUND(SUM(CASE WHEN status IN ${VALID_STATUSES} THEN total_amount ELSE 0 END), 2) AS revenue
       FROM orders
       WHERE date(created_at) >= date('now','localtime', ?)
       GROUP BY date(created_at)`
    )
    .all(`-${days - 1} days`) as unknown as Array<{ date: string, orders: number, revenue: number }>
  const byDate = new Map(rows.map((r) => [r.date, r]))
  // 补齐无订单的日期，保证趋势图连续
  return recentDays(days).map((date) => {
    const r = byDate.get(date)
    return { date, orders: r?.orders ?? 0, revenue: r?.revenue ?? 0 }
  })
}

const ORDER_STATUSES: OrderStatus[] = ['pending', 'paid', 'shipped', 'completed', 'cancelled']

function getStatusDistribution(): OrderStatusStat[] {
  const rows = db
    .prepare(
      `SELECT status, COUNT(*) AS count, ROUND(COALESCE(SUM(total_amount), 0), 2) AS amount
       FROM orders GROUP BY status`
    )
    .all() as unknown as Array<{ status: OrderStatus, count: number, amount: number }>
  const byStatus = new Map(rows.map((r) => [r.status, r]))
  return ORDER_STATUSES.map((status) => {
    const r = byStatus.get(status)
    return { status, count: r?.count ?? 0, amount: r?.amount ?? 0 }
  })
}

function getTopProducts(): TopProduct[] {
  return db
    .prepare(
      `SELECT oi.product_id, oi.product_name, oi.product_image,
              SUM(oi.quantity) AS quantity,
              ROUND(SUM(oi.price * oi.quantity), 2) AS revenue
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.status IN ${VALID_STATUSES}
       GROUP BY oi.product_id
       ORDER BY quantity DESC, revenue DESC
       LIMIT 5`
    )
    .all() as unknown as TopProduct[]
}

function getCategorySales(): CategorySales[] {
  const rows = db
    .prepare(
      `SELECT COALESCE(NULLIF(p.category, ''), '其他') AS category,
              SUM(oi.quantity) AS quantity,
              ROUND(SUM(oi.price * oi.quantity), 2) AS revenue
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       LEFT JOIN products p ON p.id = oi.product_id
       WHERE o.status IN ${VALID_STATUSES}
       GROUP BY category
       ORDER BY revenue DESC`
    )
    .all() as unknown as CategorySales[]
  return rows
}

/** 经营数据仪表盘：概览 + 趋势 + 状态分布 + 热销榜 + 分类分布 */
statsRouter.get('/dashboard', (req, res) => {
  const days = Math.min(90, Math.max(1, Number.parseInt(String(req.query.days ?? '7'), 10) || 7))
  const stats: DashboardStats = {
    days,
    overview: getOverview(),
    trend: getTrend(days),
    statusDistribution: getStatusDistribution(),
    topProducts: getTopProducts(),
    categorySales: getCategorySales(),
  }
  res.json(stats)
})
