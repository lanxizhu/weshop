import type { Address, Order, OrderStatus, UserDetail, UserListItem } from '@weshop/shared'
import { User as UserIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { fetchUserDetail, fetchUserOrders } from '@/lib/api'

const fmtPrice = (n: number) => `¥${n.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`
const fmtTime = (s: string | null) => (s ? s.slice(0, 16) : '-')

const ORDER_PAGE_SIZE = 5

const STATUS_META: Record<OrderStatus, { label: string, badge: 'default' | 'secondary' | 'destructive' | 'outline', className?: string }> = {
  pending: { label: '待支付', badge: 'outline', className: 'border-amber-300 text-amber-600' },
  paid: { label: '待发货', badge: 'outline', className: 'border-blue-300 text-blue-600' },
  shipped: { label: '待收货', badge: 'outline', className: 'border-violet-300 text-violet-600' },
  completed: { label: '已完成', badge: 'outline', className: 'border-emerald-300 text-emerald-600' },
  cancelled: { label: '已取消', badge: 'secondary' },
}

function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const meta = STATUS_META[status]
  return <Badge variant={meta.badge} className={meta.className}>{meta.label}</Badge>
}

type Detail = UserDetail & { addresses: Address[] }

interface UserDetailDrawerProps {
  /** 列表中选中的用户（渲染兜底），打开时会再拉一次最新详情 */
  user: UserListItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function UserDetailDrawer({ user, open, onOpenChange }: UserDetailDrawerProps) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [tab, setTab] = useState<'addresses' | 'orders'>('addresses')
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [ordersTotal, setOrdersTotal] = useState(0)
  const [ordersPage, setOrdersPage] = useState(1)

  // 打开抽屉时拉取用户详情；失败则静默回退到列表数据
  useEffect(() => {
    setDetail(null)
    setTab('addresses')
    setOrders(null)
    setOrdersTotal(0)
    setOrdersPage(1)
    if (!open || !user)
      return
    let cancelled = false
    fetchUserDetail(user.id)
      .then(({ user: u }) => {
        if (!cancelled)
          setDetail(u)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [open, user])

  // 「订单」tab 首次激活及翻页时加载
  useEffect(() => {
    if (!open || tab !== 'orders' || !user)
      return
    let cancelled = false
    setOrders(null)
    fetchUserOrders(user.id, { page: ordersPage, pageSize: ORDER_PAGE_SIZE })
      .then((result) => {
        if (cancelled)
          return
        setOrders(result.orders)
        setOrdersTotal(result.total)
      })
      .catch((e) => {
        if (!cancelled)
          toast.error(e instanceof Error ? e.message : '加载订单失败')
      })
    return () => {
      cancelled = true
    }
  }, [open, tab, user, ordersPage])

  const u = detail ?? user
  const ordersTotalPages = Math.max(1, Math.ceil(ordersTotal / ORDER_PAGE_SIZE))

  return (
    <Drawer direction="right" open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="sm:max-w-md">
        {u && (
          <>
            <DrawerHeader>
              <div className="flex items-center gap-3">
                <Avatar className="h-12 w-12">
                  <AvatarImage src={u.avatar_url} alt={u.nick_name} />
                  <AvatarFallback>
                    <UserIcon className="h-6 w-6" />
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <DrawerTitle className="truncate text-lg leading-snug">{u.nick_name}</DrawerTitle>
                    {u.status === 'disabled'
                      ? <Badge variant="destructive">已禁用</Badge>
                      : <Badge variant="outline">正常</Badge>}
                  </div>
                  <DrawerDescription>
                    用户 ID：
                    {u.id}
                  </DrawerDescription>
                </div>
              </div>
            </DrawerHeader>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-4">
              <div className="rounded-lg border px-4 py-1 text-sm">
                <div className="flex items-center justify-between gap-4 py-2">
                  <span className="shrink-0 text-muted-foreground">openid</span>
                  <span className="truncate font-mono text-xs">{u.openid}</span>
                </div>
                <Separator />
                <div className="flex items-center justify-between gap-4 py-2">
                  <span className="shrink-0 text-muted-foreground">注册时间</span>
                  <span className="font-medium">{fmtTime(u.created_at)}</span>
                </div>
                <Separator />
                <div className="flex items-center justify-between gap-4 py-2">
                  <span className="shrink-0 text-muted-foreground">最近下单</span>
                  <span className="font-medium">{detail ? fmtTime(detail.last_order_at) : '-'}</span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg border py-3">
                  <p className="text-lg font-semibold">{detail ? detail.order_count : '-'}</p>
                  <p className="text-xs text-muted-foreground">订单数</p>
                </div>
                <div className="rounded-lg border py-3">
                  <p className="text-lg font-semibold">{detail ? fmtPrice(detail.total_spent) : '-'}</p>
                  <p className="text-xs text-muted-foreground">消费额</p>
                </div>
                <div className="rounded-lg border py-3">
                  <p className="text-lg font-semibold">{u.address_count}</p>
                  <p className="text-xs text-muted-foreground">地址数</p>
                </div>
              </div>

              <Tabs value={tab} onValueChange={v => setTab(v as 'addresses' | 'orders')}>
                <TabsList className="w-full">
                  <TabsTrigger value="addresses" className="flex-1">收货地址</TabsTrigger>
                  <TabsTrigger value="orders" className="flex-1">订单</TabsTrigger>
                </TabsList>

                <TabsContent value="addresses">
                  {detail === null
                    ? (
                        <div className="space-y-2 py-2">
                          {Array.from({ length: 2 }).map((_, i) => (
                            <Skeleton key={i} className="h-16 w-full" />
                          ))}
                        </div>
                      )
                    : detail.addresses.length === 0
                      ? (
                          <p className="py-10 text-center text-sm text-muted-foreground">暂无收货地址</p>
                        )
                      : (
                          <div className="space-y-2 py-1">
                            {detail.addresses.map(a => (
                              <div key={a.id} className="rounded-lg border px-3 py-2 text-sm">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">{a.receiver}</span>
                                  <span className="text-muted-foreground">{a.phone}</span>
                                  {a.is_default === 1 && <Badge variant="secondary">默认</Badge>}
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {a.province}
                                  {a.city}
                                  {a.district}
                                  {a.detail}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                </TabsContent>

                <TabsContent value="orders">
                  {orders === null
                    ? (
                        <div className="space-y-2 py-2">
                          {Array.from({ length: 3 }).map((_, i) => (
                            <Skeleton key={i} className="h-14 w-full" />
                          ))}
                        </div>
                      )
                    : orders.length === 0
                      ? (
                          <p className="py-10 text-center text-sm text-muted-foreground">暂无订单</p>
                        )
                      : (
                          <div className="space-y-2 py-1">
                            {orders.map(o => (
                              <div key={o.id} className="rounded-lg border px-3 py-2 text-sm">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="truncate font-mono text-xs">{o.order_no}</span>
                                  <OrderStatusBadge status={o.status} />
                                </div>
                                <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                                  <span>{fmtTime(o.created_at)}</span>
                                  <span>
                                    {o.items.reduce((s, i) => s + i.quantity, 0)}
                                    {' '}
                                    件 ·
                                    {' '}
                                    <span className="font-semibold text-foreground">{fmtPrice(o.total_amount)}</span>
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                  {ordersTotal > ORDER_PAGE_SIZE && (
                    <div className="flex items-center justify-between border-t pt-3">
                      <span className="text-xs text-muted-foreground">
                        第
                        {' '}
                        {ordersPage}
                        /
                        {ordersTotalPages}
                        {' '}
                        页
                      </span>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={ordersPage <= 1 || orders === null}
                          onClick={() => setOrdersPage(p => Math.max(1, p - 1))}
                        >
                          上一页
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={ordersPage >= ordersTotalPages || orders === null}
                          onClick={() => setOrdersPage(p => p + 1)}
                        >
                          下一页
                        </Button>
                      </div>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </div>

            <DrawerFooter className="flex-row gap-2">
              <DrawerClose asChild>
                <Button variant="ghost" className="flex-1">关闭</Button>
              </DrawerClose>
            </DrawerFooter>
          </>
        )}
      </DrawerContent>
    </Drawer>
  )
}
