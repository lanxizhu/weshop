import type { DashboardStats, OrderStatus } from '@weshop/shared'
import type { ChartConfig } from '@/components/ui/chart'
import { Link } from '@tanstack/react-router'
import {
  ClipboardList,
  PackageOpen,
  Receipt,
  TrendingUp,
  Users as UsersIcon,
  Wallet,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from 'recharts'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useLatestRequest } from '@/hooks/use-latest-request'
import { fetchDashboard, onServerRecover } from '@/lib/api'

const fmtPrice = (n: number) => `¥${n.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`
const fmtDate = (s: string) => s.slice(5) // YYYY-MM-DD → MM-DD

const STATUS_META: Record<OrderStatus, { label: string, color: string }> = {
  pending: { label: '待支付', color: 'hsl(38 92% 50%)' },
  paid: { label: '待发货', color: 'hsl(217 91% 60%)' },
  shipped: { label: '待收货', color: 'hsl(262 83% 65%)' },
  completed: { label: '已完成', color: 'hsl(160 84% 39%)' },
  cancelled: { label: '已取消', color: 'hsl(240 5% 65%)' },
}

const trendConfig = {
  orders: { label: '订单量', color: 'hsl(217 91% 60%)' },
  revenue: { label: '成交额', color: 'hsl(160 84% 39%)' },
} satisfies ChartConfig

const statusConfig = Object.fromEntries(
  Object.entries(STATUS_META).map(([k, v]) => [k, { label: v.label, color: v.color }]),
) as ChartConfig

const TOP_SKELETONS = Array.from({ length: 5 }, (_, i) => `top-${i}`)
const CATEGORY_SKELETONS = Array.from({ length: 4 }, (_, i) => `category-${i}`)

export default function Dashboard() {
  const [days, setDays] = useState<7 | 30>(7)
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)

  const runLatest = useLatestRequest()
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await runLatest(() => fetchDashboard(days))
      if (!data)
        return
      setStats(data)
      setLoading(false)
    }
    catch (error) {
      setLoading(false)
      throw error
    }
  }, [days, runLatest])

  useEffect(() => {
    load().catch(e => toast.error(e instanceof Error ? e.message : '加载失败'))
  }, [load])

  // 服务从故障中恢复后，自动刷新数据
  useEffect(() => {
    return onServerRecover(() => {
      toast.success('服务已恢复，正在同步最新数据')
      load().catch(e => toast.error(e instanceof Error ? e.message : '加载失败'))
    })
  }, [load])

  const overview = stats?.overview
  const topQuantity = stats?.topProducts[0]?.quantity ?? 0
  const categoryTotal = stats?.categorySales.reduce((s, c) => s + c.revenue, 0) ?? 0
  const statusTotal = stats?.statusDistribution.reduce((s, x) => s + x.count, 0) ?? 0

  const cards = [
    { title: '今日成交额', value: overview ? fmtPrice(overview.todayRevenue) : '-', icon: TrendingUp },
    { title: '今日订单', value: overview?.todayOrders ?? '-', icon: Receipt },
    { title: '累计成交额', value: overview ? fmtPrice(overview.totalRevenue) : '-', icon: Wallet },
    { title: '累计订单', value: overview?.totalOrders ?? '-', icon: ClipboardList },
    { title: '注册用户', value: overview?.totalUsers ?? '-', icon: UsersIcon },
  ]

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-6 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">数据统计</h1>
          <p className="text-sm text-muted-foreground">成交口径：已支付、待收货与已完成订单计入营收</p>
        </div>
        <Tabs value={String(days)} onValueChange={v => setDays(Number(v) as 7 | 30)}>
          <TabsList>
            <TabsTrigger value="7">近 7 天</TabsTrigger>
            <TabsTrigger value="30">近 30 天</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(c => (
          <Card key={c.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{c.title}</CardTitle>
              <c.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {loading ? <Skeleton className="h-8 w-24" /> : <div className="text-2xl font-bold">{c.value}</div>}
            </CardContent>
          </Card>
        ))}
        {/* 待发货是运营动作入口：点击直达订单管理待发货列表，形成「看数据 → 去处理」闭环 */}
        <Link to="/orders" search={{ status: 'paid' }} className="block transition-transform hover:-translate-y-0.5">
          <Card className="h-full border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/30">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-blue-700 dark:text-blue-400">
                待发货订单 → 去处理
              </CardTitle>
              <PackageOpen className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </CardHeader>
            <CardContent>
              {loading
                ? <Skeleton className="h-8 w-24" />
                : <div className="text-2xl font-bold text-blue-700 dark:text-blue-400">{overview?.pendingShipment ?? '-'}</div>}
            </CardContent>
          </Card>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">销售趋势</CardTitle>
        </CardHeader>
        <CardContent>
          {loading || !stats
            ? <Skeleton className="h-[300px] w-full" />
            : (
                <ChartContainer config={trendConfig} className="h-[300px] w-full">
                  <ComposedChart data={stats.trend} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickFormatter={fmtDate} tickLine={false} axisLine={false} />
                    <YAxis yAxisId="orders" allowDecimals={false} tickLine={false} axisLine={false} width={32} />
                    <YAxis
                      yAxisId="revenue"
                      orientation="right"
                      tickLine={false}
                      axisLine={false}
                      width={56}
                      tickFormatter={v => `¥${Number(v).toLocaleString('zh-CN')}`}
                    />
                    <ChartTooltip
                      content={(
                        <ChartTooltipContent
                          labelFormatter={v => String(v)}
                          formatter={(value, name) => (
                            <span className="flex w-full items-center justify-between gap-4">
                              <span className="text-muted-foreground">{trendConfig[name as keyof typeof trendConfig]?.label ?? name}</span>
                              <span className="font-mono font-medium">
                                {name === 'revenue' ? fmtPrice(Number(value)) : value}
                              </span>
                            </span>
                          )}
                        />
                      )}
                    />
                    <Bar yAxisId="orders" dataKey="orders" fill="var(--color-orders)" radius={[4, 4, 0, 0]} maxBarSize={32} />
                    <Line
                      yAxisId="revenue"
                      type="monotone"
                      dataKey="revenue"
                      stroke="var(--color-revenue)"
                      strokeWidth={2}
                      dot={false}
                    />
                  </ComposedChart>
                </ChartContainer>
              )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">订单状态分布</CardTitle>
          </CardHeader>
          <CardContent>
            {loading || !stats
              ? <Skeleton className="h-[220px] w-full" />
              : statusTotal === 0
                ? <p className="py-16 text-center text-sm text-muted-foreground">暂无订单数据</p>
                : (
                    <>
                      <ChartContainer config={statusConfig} className="mx-auto h-[180px] w-full max-w-[260px]">
                        <PieChart>
                          <ChartTooltip
                            content={(
                              <ChartTooltipContent
                                hideLabel
                                formatter={(value, name) => (
                                  <span className="flex w-full items-center justify-between gap-4">
                                    <span className="text-muted-foreground">
                                      {STATUS_META[name as OrderStatus]?.label ?? name}
                                    </span>
                                    <span className="font-mono font-medium">
                                      {value}
                                      {' '}
                                      单
                                    </span>
                                  </span>
                                )}
                              />
                            )}
                          />
                          <Pie
                            data={stats.statusDistribution}
                            dataKey="count"
                            nameKey="status"
                            innerRadius={52}
                            outerRadius={80}
                            strokeWidth={2}
                          >
                            {stats.statusDistribution.map(s => (
                              <Cell key={s.status} fill={STATUS_META[s.status].color} />
                            ))}
                          </Pie>
                        </PieChart>
                      </ChartContainer>
                      <ul className="mt-2 space-y-1.5 text-sm">
                        {stats.statusDistribution.map(s => (
                          <li key={s.status} className="flex items-center justify-between">
                            <span className="flex items-center gap-2">
                              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: STATUS_META[s.status].color }} />
                              {STATUS_META[s.status].label}
                            </span>
                            <span className="text-muted-foreground">
                              {s.count}
                              {' '}
                              单 ·
                              {fmtPrice(s.amount)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">热销商品 Top 5</CardTitle>
          </CardHeader>
          <CardContent>
            {loading || !stats
              ? (
                  <div className="space-y-3">
                    {TOP_SKELETONS.map(key => <Skeleton key={key} className="h-10 w-full" />)}
                  </div>
                )
              : stats.topProducts.length === 0
                ? <p className="py-16 text-center text-sm text-muted-foreground">暂无成交商品</p>
                : (
                    <ul className="space-y-3">
                      {stats.topProducts.map((p, i) => (
                        <li key={p.product_id} className="space-y-1">
                          <div className="flex items-center gap-2.5">
                            <span
                              className={
                                `w-5 shrink-0 text-center text-sm font-bold ${i < 3 ? 'text-primary' : 'text-muted-foreground'}`
                              }
                            >
                              {i + 1}
                            </span>
                            {p.product_image
                              ? <img src={p.product_image} alt={p.product_name} className="h-9 w-9 shrink-0 rounded-md border object-cover" />
                              : <div className="h-9 w-9 shrink-0 rounded-md border bg-muted" />}
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">{p.product_name}</p>
                              <p className="text-xs text-muted-foreground">
                                成交
                                {p.quantity}
                                {' '}
                                件
                              </p>
                            </div>
                            <span className="shrink-0 text-sm font-medium">{fmtPrice(p.revenue)}</span>
                          </div>
                          <div className="ml-[30px] h-1.5 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-primary/70"
                              style={{ width: `${topQuantity > 0 ? Math.max(4, (p.quantity / topQuantity) * 100) : 0}%` }}
                            />
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">分类销售分布</CardTitle>
          </CardHeader>
          <CardContent>
            {loading || !stats
              ? (
                  <div className="space-y-3">
                    {CATEGORY_SKELETONS.map(key => <Skeleton key={key} className="h-8 w-full" />)}
                  </div>
                )
              : stats.categorySales.length === 0
                ? <p className="py-16 text-center text-sm text-muted-foreground">暂无成交数据</p>
                : (
                    <ul className="space-y-3">
                      {stats.categorySales.map((c) => {
                        const pct = categoryTotal > 0 ? (c.revenue / categoryTotal) * 100 : 0
                        return (
                          <li key={c.category} className="space-y-1">
                            <div className="flex items-center justify-between text-sm">
                              <span className="font-medium">{c.category}</span>
                              <span className="text-muted-foreground">
                                {fmtPrice(c.revenue)}
                                {' '}
                                ·
                                {pct.toFixed(1)}
                                %
                              </span>
                            </div>
                            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                              <div className="h-full rounded-full bg-emerald-500/80" style={{ width: `${pct}%` }} />
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  )}
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
