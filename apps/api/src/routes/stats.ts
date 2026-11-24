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

/** 把 Date 格式化为本地 YYYY-MM-DD（与数据库本地时间对齐） */
function fmtDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 近 N 天（含今天）的日期序列，升序 */
function recentDays(days: number): string[] {
  const today = new Date()
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(today)
    date.setDate(date.getDate() - (days - 1 - index))
    return fmtDate(date)
  })
}

async function getOverview(): Promise<DashboardOverview> {
  const today = fmtDate(new Date())
  const row = (await db.prepare(
    `SELECT
       COUNT(*) AS totalOrders,
       COALESCE(ROUND(SUM(CASE WHEN status IN ${VALID_STATUSES} THEN total_amount END), 2), 0) AS totalRevenue,
       COALESCE(SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END), 0) AS pendingShipment,
       COALESCE(SUM(CASE WHEN date(created_at) = ? THEN 1 ELSE 0 END), 0) AS todayOrders,
       COALESCE(ROUND(SUM(CASE WHEN status IN ${VALID_STATUSES} AND date(created_at) = ? THEN total_amount END), 2), 0) AS todayRevenue
     FROM orders`,
  ).get<Omit<DashboardOverview, 'totalUsers'>>(today, today))!
  const count = (await db.prepare('SELECT COUNT(*) AS n FROM users').get<{ n: number }>())!
  return { ...row, totalUsers: count.n }
}

async function getTrend(days: number): Promise<DashboardStats['trend']> {
  const dates = recentDays(days)
  const rows = await db.prepare(
    `SELECT date(created_at) AS date,
            COUNT(*) AS orders,
            ROUND(SUM(CASE WHEN status IN ${VALID_STATUSES} THEN total_amount ELSE 0 END), 2) AS revenue
     FROM orders
     WHERE date(created_at) >= ?
     GROUP BY date(created_at)`,
  ).all<{ date: string, orders: number, revenue: number }>(dates[0]!)
  const byDate = new Map(rows.map((row) => [row.date, row]))
  // 补齐无订单的日期，保证趋势图连续
  return dates.map((date) => {
    const row = byDate.get(date)
    return { date, orders: row?.orders ?? 0, revenue: row?.revenue ?? 0 }
  })
}

const ORDER_STATUSES: OrderStatus[] = ['pending', 'paid', 'shipped', 'completed', 'cancelled']

async function getStatusDistribution(): Promise<OrderStatusStat[]> {
  const rows = await db.prepare(
    `SELECT status, COUNT(*) AS count, ROUND(COALESCE(SUM(total_amount), 0), 2) AS amount
     FROM orders GROUP BY status`,
  ).all<{ status: OrderStatus, count: number, amount: number }>()
  const byStatus = new Map(rows.map((row) => [row.status, row]))
  return ORDER_STATUSES.map((status) => {
    const row = byStatus.get(status)
    return { status, count: row?.count ?? 0, amount: row?.amount ?? 0 }
  })
}

async function getTopProducts(): Promise<TopProduct[]> {
  return db.prepare(
    `SELECT oi.product_id, oi.product_name, oi.product_image,
            SUM(oi.quantity) AS quantity,
            ROUND(SUM(oi.price * oi.quantity), 2) AS revenue
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE o.status IN ${VALID_STATUSES}
     GROUP BY oi.product_id, oi.product_name, oi.product_image
     ORDER BY quantity DESC, revenue DESC
     LIMIT 5`,
  ).all<TopProduct>()
}

async function getCategorySales(): Promise<CategorySales[]> {
  return db.prepare(
    `SELECT COALESCE(NULLIF(p.category, ''), '其他') AS category,
            SUM(oi.quantity) AS quantity,
            ROUND(SUM(oi.price * oi.quantity), 2) AS revenue
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     LEFT JOIN products p ON p.id = oi.product_id
     WHERE o.status IN ${VALID_STATUSES}
     GROUP BY category
     ORDER BY revenue DESC`,
  ).all<CategorySales>()
}

/** 经营数据仪表盘：概览 + 趋势 + 状态分布 + 热销榜 + 分类分布 */
statsRouter.get('/dashboard', async (req, res) => {
  const days = Math.min(90, Math.max(1, Number.parseInt(String(req.query.days ?? '7'), 10) || 7))
  const stats: DashboardStats = {
    days,
    overview: await getOverview(),
    trend: await getTrend(days),
    statusDistribution: await getStatusDistribution(),
    topProducts: await getTopProducts(),
    categorySales: await getCategorySales(),
  }
  res.json(stats)
})
