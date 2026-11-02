import type { AdminOrder, OrderStatus } from '@weshop/shared'
import { Download, Eye, Search } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  cancelAdminOrder,
  downloadOrdersCsv,
  fetchAdminOrder,
  fetchAdminOrders,
  onServerRecover,
  shipOrder,
} from '@/lib/api'

const fmtPrice = (n: number) => `¥${n.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`
const fmtTime = (s: string | null) => (s ? s.slice(0, 16) : '-')

const PAGE_SIZE = 10

const STATUS_META: Record<OrderStatus, { label: string, badge: 'default' | 'secondary' | 'destructive' | 'outline', className?: string }> = {
  pending: { label: '待支付', badge: 'outline', className: 'border-amber-300 text-amber-600' },
  paid: { label: '待发货', badge: 'outline', className: 'border-blue-300 text-blue-600' },
  shipped: { label: '待收货', badge: 'outline', className: 'border-violet-300 text-violet-600' },
  completed: { label: '已完成', badge: 'outline', className: 'border-emerald-300 text-emerald-600' },
  cancelled: { label: '已取消', badge: 'secondary' },
}

const FILTER_TABS: Array<{ value: OrderStatus | 'all', label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'pending', label: '待支付' },
  { value: 'paid', label: '待发货' },
  { value: 'shipped', label: '待收货' },
  { value: 'completed', label: '已完成' },
  { value: 'cancelled', label: '已取消' },
]

function StatusBadge({ status }: { status: OrderStatus }) {
  const meta = STATUS_META[status]
  return <Badge variant={meta.badge} className={meta.className}>{meta.label}</Badge>
}

/** 订单件数合计（各明细 quantity 求和） */
function itemCount(o: AdminOrder): number {
  return o.items.reduce((s, i) => s + i.quantity, 0)
}

export default function Orders() {
  const [orders, setOrders] = useState<AdminOrder[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  // 状态筛选同步到 URL（?status=paid），支持从数据统计页等入口直达筛选结果
  const [searchParams, setSearchParams] = useSearchParams()
  const statusParam = searchParams.get('status') ?? 'all'
  const statusFilter = (FILTER_TABS.some(t => t.value === statusParam) ? statusParam : 'all') as OrderStatus | 'all'
  const setStatusFilter = (v: OrderStatus | 'all') => {
    setSearchParams(v === 'all' ? {} : { status: v }, { replace: true })
  }
  const [keyword, setKeyword] = useState('')
  const [appliedKeyword, setAppliedKeyword] = useState('')
  const [page, setPage] = useState(1)

  const [viewingId, setViewingId] = useState<number | null>(null)
  const [detail, setDetail] = useState<AdminOrder | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [confirmingShip, setConfirmingShip] = useState(false)
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [acting, setActing] = useState(false)
  const [exporting, setExporting] = useState(false)

  // 筛选 / 搜索变化时回到第 1 页
  useEffect(() => {
    setPage(1)
  }, [statusFilter, appliedKeyword])

  const load = useCallback(async () => {
    const result = await fetchAdminOrders({
      status: statusFilter,
      keyword: appliedKeyword || undefined,
      page,
      pageSize: PAGE_SIZE,
    })
    // 操作导致当前页超出范围时回退一页
    if (result.orders.length === 0 && result.total > 0 && page > 1) {
      setPage(p => Math.max(1, p - 1))
      return
    }
    setOrders(result.orders)
    setTotal(result.total)
    setLoading(false)
  }, [statusFilter, appliedKeyword, page])

  useEffect(() => {
    setLoading(true)
    load().catch((e) => {
      setLoading(false)
      toast.error(e instanceof Error ? e.message : '加载失败')
    })
  }, [load])

  // 服务从故障中恢复后，自动刷新数据
  useEffect(() => {
    return onServerRecover(() => {
      toast.success('服务已恢复，正在同步最新数据')
      load().catch(e => toast.error(e instanceof Error ? e.message : '加载失败'))
    })
  }, [load])

  // 打开详情时拉取最新订单数据（列表数据可能已过期）
  useEffect(() => {
    if (viewingId == null)
      return
    setDetail(null)
    setDetailLoading(true)
    fetchAdminOrder(viewingId)
      .then(({ order }) => setDetail(order))
      .catch(e => toast.error(e instanceof Error ? e.message : '加载订单详情失败'))
      .finally(() => setDetailLoading(false))
  }, [viewingId])

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    setAppliedKeyword(keyword.trim())
  }

  async function handleExport() {
    setExporting(true)
    try {
      await downloadOrdersCsv({ status: statusFilter, keyword: appliedKeyword || undefined })
      toast.success('订单 CSV 已导出')
    }
    catch (e) {
      toast.error(e instanceof Error ? e.message : '导出失败')
    }
    finally {
      setExporting(false)
    }
  }

  async function handleShip() {
    if (!detail)
      return
    setActing(true)
    try {
      const { order } = await shipOrder(detail.id)
      toast.success(`订单 ${order.order_no} 已发货`)
      setDetail(order)
      setConfirmingShip(false)
      await load()
    }
    catch (e) {
      toast.error(e instanceof Error ? e.message : '发货失败')
    }
    finally {
      setActing(false)
    }
  }

  async function handleCancel() {
    if (!detail)
      return
    setActing(true)
    try {
      const { order } = await cancelAdminOrder(detail.id, cancelReason.trim() || undefined)
      toast.success(`订单 ${order.order_no} 已取消`)
      setDetail(order)
      setConfirmingCancel(false)
      setCancelReason('')
      await load()
    }
    catch (e) {
      toast.error(e instanceof Error ? e.message : '取消订单失败')
    }
    finally {
      setActing(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const timeline = detail
    ? [
        { label: '创建订单', time: detail.created_at },
        { label: '支付完成', time: detail.paid_at },
        { label: '商家发货', time: detail.shipped_at },
        { label: '确认收货', time: detail.completed_at },
        { label: '取消订单', time: detail.cancelled_at },
      ].filter(t => t.time != null)
    : []

  return (
    <>
      <main className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs value={statusFilter} onValueChange={v => setStatusFilter(v as OrderStatus | 'all')}>
            <TabsList>
              {FILTER_TABS.map(t => (
                <TabsTrigger key={t.value} value={t.value}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <form className="flex items-center gap-2" onSubmit={handleSearch}>
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="搜索订单号或收货人…"
                value={keyword}
                onChange={e => setKeyword(e.target.value)}
              />
            </div>
            <Button type="submit" variant="outline">
              搜索
            </Button>
            <Button type="button" variant="outline" disabled={exporting} onClick={handleExport}>
              <Download className="mr-1 h-4 w-4" />
              {exporting ? '导出中…' : '导出 CSV'}
            </Button>
          </form>
        </div>

        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[25%]">订单号</TableHead>
                <TableHead>买家</TableHead>
                <TableHead>收货人</TableHead>
                <TableHead>金额</TableHead>
                <TableHead>商品数</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>下单时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading
                ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 8 }).map((__, j) => (
                          <TableCell key={j}>
                            <Skeleton className="h-5 w-full max-w-[140px]" />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  )
                : orders.length === 0
                  ? (
                      <TableRow>
                        <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                          没有找到匹配的订单
                        </TableCell>
                      </TableRow>
                    )
                  : (
                      orders.map(o => (
                        <TableRow key={o.id}>
                          <TableCell className="font-mono text-xs">{o.order_no}</TableCell>
                          <TableCell className="font-medium">{o.nick_name}</TableCell>
                          <TableCell>{o.receiver}</TableCell>
                          <TableCell className="font-medium">{fmtPrice(o.total_amount)}</TableCell>
                          <TableCell>{itemCount(o)}</TableCell>
                          <TableCell>
                            <StatusBadge status={o.status} />
                          </TableCell>
                          <TableCell className="text-muted-foreground">{fmtTime(o.created_at)}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              title="查看详情"
                              onClick={() => setViewingId(o.id)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between border-t px-4 py-3">
            <span className="text-sm text-muted-foreground">
              共
              {' '}
              {total}
              {' '}
              条 · 第
              {' '}
              {page}
              /
              {totalPages}
              {' '}
              页
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || loading}
                onClick={() => setPage(p => Math.max(1, p - 1))}
              >
                上一页
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages || loading}
                onClick={() => setPage(p => p + 1)}
              >
                下一页
              </Button>
            </div>
          </div>
        </Card>
      </main>

      <Dialog open={viewingId !== null} onOpenChange={o => !o && setViewingId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              订单详情
              {detail && <StatusBadge status={detail.status} />}
            </DialogTitle>
            <DialogDescription className="font-mono text-xs">
              {detail?.order_no ?? '加载中…'}
            </DialogDescription>
          </DialogHeader>

          {detailLoading || !detail
            ? (
                <div className="space-y-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-5 w-full" />
                  ))}
                </div>
              )
            : (
                <div className="max-h-[60vh] space-y-5 overflow-y-auto pr-1">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">买家：</span>
                      {detail.nick_name}
                    </div>
                    <div>
                      <span className="text-muted-foreground">下单时间：</span>
                      {fmtTime(detail.created_at)}
                    </div>
                    <div className="col-span-2">
                      <span className="text-muted-foreground">收货地址：</span>
                      {detail.receiver}
                      {' '}
                      {detail.phone}
                      {' · '}
                      {detail.province}
                      {detail.city}
                      {detail.district}
                      {detail.detail}
                    </div>
                    {detail.remark && (
                      <div className="col-span-2">
                        <span className="text-muted-foreground">买家备注：</span>
                        {detail.remark}
                      </div>
                    )}
                  </div>

                  <div>
                    <h3 className="mb-2 text-sm font-medium">商品明细</h3>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>商品</TableHead>
                          <TableHead>单价</TableHead>
                          <TableHead>数量</TableHead>
                          <TableHead className="text-right">小计</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detail.items.map(item => (
                          <TableRow key={item.id}>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                {item.product_image
                                  ? (
                                      <img
                                        src={item.product_image}
                                        alt={item.product_name}
                                        className="h-9 w-9 shrink-0 rounded-md border object-cover"
                                      />
                                    )
                                  : null}
                                <span className="font-medium">{item.product_name}</span>
                              </div>
                            </TableCell>
                            <TableCell>{fmtPrice(item.price)}</TableCell>
                            <TableCell>
                              ×
                              {item.quantity}
                            </TableCell>
                            <TableCell className="text-right">{fmtPrice(item.price * item.quantity)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <div className="mt-2 text-right text-sm">
                      合计：
                      <span className="text-base font-bold">{fmtPrice(detail.total_amount)}</span>
                    </div>
                  </div>

                  <div>
                    <h3 className="mb-2 text-sm font-medium">时间线</h3>
                    <ul className="space-y-1 text-sm">
                      {timeline.map(t => (
                        <li key={t.label} className="flex justify-between">
                          <span className="text-muted-foreground">{t.label}</span>
                          <span>{fmtTime(t.time)}</span>
                        </li>
                      ))}
                      {detail.cancel_reason && (
                        <li className="flex justify-between">
                          <span className="text-muted-foreground">取消原因</span>
                          <span>{detail.cancel_reason}</span>
                        </li>
                      )}
                    </ul>
                  </div>
                </div>
              )}

          <DialogFooter>
            {detail?.status === 'paid' && (
              <Button onClick={() => setConfirmingShip(true)} disabled={acting}>
                发货
              </Button>
            )}
            {detail && (detail.status === 'pending' || detail.status === 'paid') && (
              <Button variant="destructive" onClick={() => setConfirmingCancel(true)} disabled={acting}>
                取消订单
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmingShip} onOpenChange={setConfirmingShip}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认发货？</AlertDialogTitle>
            <AlertDialogDescription>
              订单
              {' '}
              {detail?.order_no}
              {' '}
              将标记为「待收货」。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={acting}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleShip} disabled={acting}>
              确认发货
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmingCancel} onOpenChange={setConfirmingCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认取消订单？</AlertDialogTitle>
            <AlertDialogDescription>
              订单
              {' '}
              {detail?.order_no}
              {' '}
              将被取消，已扣减的库存会自动回补。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            placeholder="取消原因（选填，默认为「商家取消」）"
            value={cancelReason}
            onChange={e => setCancelReason(e.target.value)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={acting}>返回</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancel}
              disabled={acting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              确认取消
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
