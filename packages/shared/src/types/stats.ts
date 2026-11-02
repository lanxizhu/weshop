/** 数据统计模块类型定义（管理端仪表盘，与 apps/api routes/stats.ts 对应） */

import type { OrderStatus } from "./order.js";

/**
 * 成交口径：status IN ('paid','shipped','completed') 的订单计入营收；
 * 趋势与「今日」均按订单创建日（created_at）归集。
 */
export interface DashboardOverview {
  /** 今日下单笔数 */
  todayOrders: number;
  /** 今日成交额（今日创建且已成交的订单） */
  todayRevenue: number;
  /** 待发货订单数（status = paid） */
  pendingShipment: number;
  /** 累计订单数（全部状态） */
  totalOrders: number;
  /** 累计成交额 */
  totalRevenue: number;
  /** 注册用户数 */
  totalUsers: number;
}

/** 单日销售数据（日期为 YYYY-MM-DD，本地时区） */
export interface DailySales {
  date: string;
  /** 当日下单笔数 */
  orders: number;
  /** 当日成交额（当日创建且已成交的订单） */
  revenue: number;
}

export interface OrderStatusStat {
  status: OrderStatus;
  count: number;
  /** 该状态订单金额合计 */
  amount: number;
}

/** 热销商品（按成交数量排序） */
export interface TopProduct {
  product_id: number;
  product_name: string;
  product_image: string;
  /** 成交件数 */
  quantity: number;
  /** 成交额 */
  revenue: number;
}

/** 分类销售（按成交额排序；商品已删除时归入「其他」） */
export interface CategorySales {
  category: string;
  quantity: number;
  revenue: number;
}

/** GET /api/admin/stats/dashboard?days=N 响应 */
export interface DashboardStats {
  /** 趋势区间天数 */
  days: number;
  overview: DashboardOverview;
  /** 近 N 天（含今天）逐日数据，按日期升序，无数据的日期补 0 */
  trend: DailySales[];
  /** 各状态订单分布（固定 5 项，按状态枚举顺序） */
  statusDistribution: OrderStatusStat[];
  /** 成交口径热销商品 Top 5 */
  topProducts: TopProduct[];
  /** 成交口径分类销售分布 */
  categorySales: CategorySales[];
}
