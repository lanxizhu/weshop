import type { Product, StockLog } from '@weshop/shared'
import { LOW_STOCK_THRESHOLD } from '@weshop/shared'
import { Copy, Minus, Package, Pencil, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
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
import { adjustSkuStock, fetchProduct, fetchStockLogs } from '@/lib/api'

const fmtPrice = (n: number) => `¥${n.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`
const fmtTime = (s: string) => s?.slice(0, 16) ?? '-'

const REASON_LABELS: Record<StockLog['reason'], string> = {
  init: '初始入库',
  order: '订单出库',
  cancel: '取消回补',
  adjust: '人工调整',
}

function StockBadge({ stock }: { stock: number }) {
  if (stock === 0)
    return <Badge variant="destructive">缺货</Badge>
  if (stock < LOW_STOCK_THRESHOLD) {
    return (
      <Badge variant="secondary" className="border-amber-300 text-amber-600">
        不足
      </Badge>
    )
  }
  return null
}

function Field({ label, children }: { label: string, children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2 text-right font-medium">{children}</span>
    </div>
  )
}

interface ProductDetailDrawerProps {
  /** 列表中选中的商品（渲染兜底），打开时会再拉一次最新详情 */
  product: Product | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onEdit: (p: Product) => void
  onDuplicate: (p: Product) => void
  onProductChange: (p: Product) => void
}

export function ProductDetailDrawer(props: ProductDetailDrawerProps) {
  if (!props.open || !props.product)
    return null
  return <ProductDetailContent key={props.product.id} {...props} />
}

function ProductDetailContent({
  product,
  open,
  onOpenChange,
  onEdit,
  onDuplicate,
  onProductChange,
}: ProductDetailDrawerProps) {
  const [fresh, setFresh] = useState<Product | null>(null)
  const [tab, setTab] = useState<'detail' | 'logs'>('detail')
  const [logs, setLogs] = useState<StockLog[] | null>(null)
  const [adjustingSkuId, setAdjustingSkuId] = useState<number | null>(null)

  // 列表数据可能陈旧，挂载抽屉时拉取最新详情；失败则静默回退到列表数据
  useEffect(() => {
    if (!open || !product)
      return
    let cancelled = false
    fetchProduct(product.id)
      .then(({ product: p }) => {
        if (!cancelled)
          setFresh(p)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [open, product])

  const p = fresh ?? product

  // 「库存流水」tab 首次激活时懒加载
  useEffect(() => {
    if (!open || tab !== 'logs' || logs !== null || !product)
      return
    let cancelled = false
    fetchStockLogs(product.id)
      .then(({ logs }) => {
        if (!cancelled)
          setLogs(logs)
      })
      .catch((e) => {
        if (!cancelled)
          toast.error(e instanceof Error ? e.message : '加载库存流水失败')
      })
    return () => {
      cancelled = true
    }
  }, [open, tab, logs, product])

  async function handleAdjustSku(skuId: number, delta: number) {
    if (!p)
      return
    setAdjustingSkuId(skuId)
    try {
      const { product } = await adjustSkuStock(p.id, skuId, delta)
      setFresh(product)
      onProductChange(product)
      setLogs(null) // 流水已变化，下次切到 tab 时重新加载
    }
    catch (e) {
      toast.error(e instanceof Error ? e.message : '库存调整失败')
    }
    finally {
      setAdjustingSkuId(null)
    }
  }

  return (
    <Drawer direction="right" open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="sm:max-w-md">
        {p && (
          <>
            <DrawerHeader>
              <div className="flex items-start justify-between gap-3">
                <DrawerTitle className="text-lg leading-snug">{p.name}</DrawerTitle>
                <Badge variant={p.status === 'on' ? 'default' : 'secondary'}>
                  {p.status === 'on' ? '在售中' : '已下架'}
                </Badge>
              </div>
              <DrawerDescription>
                商品 ID：
                {p.id}
                {' '}
                ·
                {' '}
                {p.category || '未分类'}
              </DrawerDescription>
            </DrawerHeader>

            <Tabs
              value={tab}
              onValueChange={v => setTab(v as 'detail' | 'logs')}
              className="flex min-h-0 flex-1 flex-col px-4"
            >
              <TabsList className="w-full">
                <TabsTrigger value="detail" className="flex-1">详情</TabsTrigger>
                <TabsTrigger value="logs" className="flex-1">库存流水</TabsTrigger>
              </TabsList>

              <TabsContent value="detail" className="min-h-0 flex-1 space-y-5 overflow-y-auto pb-4 data-[state=inactive]:hidden">
                {p.images.length > 0
                  ? (
                      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto">
                        {p.images.map((url, i) => (
                          <img
                            key={url}
                            src={url}
                            alt={`${p.name} 图片 ${i + 1}`}
                            className="aspect-square w-full shrink-0 snap-center rounded-lg border object-cover"
                          />
                        ))}
                      </div>
                    )
                  : (
                      <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-lg border bg-muted text-muted-foreground">
                        <Package className="h-10 w-10" />
                        <span className="text-xs">暂无图片</span>
                      </div>
                    )}

                <div className="rounded-lg border px-4 py-1">
                  <Field label="价格">
                    <span className="text-base font-semibold">{fmtPrice(p.price)}</span>
                  </Field>
                  <Separator />
                  <Field label="库存">
                    {p.stock}
                    <StockBadge stock={p.stock} />
                  </Field>
                  <Separator />
                  <Field label="创建时间">{fmtTime(p.created_at)}</Field>
                  <Separator />
                  <Field label="更新时间">{fmtTime(p.updated_at)}</Field>
                </div>

                <div>
                  <p className="mb-1.5 text-sm text-muted-foreground">
                    规格（
                    {p.skus.length}
                    ）
                  </p>
                  <div className="space-y-2">
                    {p.skus.map(s => (
                      <div key={s.id} className="flex items-center gap-3 rounded-lg border px-3 py-2">
                        {(s.image || p.images[0])
                          ? (
                              <img
                                src={s.image || p.images[0]}
                                alt={s.name}
                                className="h-9 w-9 shrink-0 rounded-md border object-cover"
                              />
                            )
                          : (
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
                                <Package className="h-4 w-4" />
                              </div>
                            )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{s.name}</p>
                          <p className="text-xs text-muted-foreground">{fmtPrice(s.price)}</p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-6 w-6"
                            title="出库 1"
                            disabled={s.stock === 0 || adjustingSkuId === s.id}
                            onClick={() => handleAdjustSku(s.id, -1)}
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                          <span className="min-w-8 text-center text-sm">{s.stock}</span>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-6 w-6"
                            title="入库 1"
                            disabled={adjustingSkuId === s.id}
                            onClick={() => handleAdjustSku(s.id, 1)}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="mb-1.5 text-sm text-muted-foreground">商品描述</p>
                  <p className="text-sm leading-6 whitespace-pre-wrap">
                    {p.description || '（无描述）'}
                  </p>
                </div>
              </TabsContent>

              <TabsContent value="logs" className="min-h-0 flex-1 overflow-y-auto pb-4 data-[state=inactive]:hidden">
                {logs === null
                  ? (
                      <div className="space-y-2 py-2">
                        {Array.from({ length: 5 }, (_, i) => `log-skeleton-${i}`).map(key => (
                          <Skeleton key={key} className="h-12 w-full" />
                        ))}
                      </div>
                    )
                  : logs.length === 0
                    ? (
                        <p className="py-10 text-center text-sm text-muted-foreground">暂无库存流水</p>
                      )
                    : (
                        <div className="space-y-2 py-1">
                          {logs.map(log => (
                            <div key={log.id} className="flex items-center gap-3 rounded-lg border px-3 py-2 text-sm">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="truncate font-medium">{log.sku_name || '（已删除规格）'}</span>
                                  <span className="shrink-0 text-xs text-muted-foreground">
                                    {REASON_LABELS[log.reason] ?? log.reason}
                                  </span>
                                </div>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  {fmtTime(log.created_at)}
                                  {log.ref ? ` · 单号 ${log.ref}` : ''}
                                  {' · 变动后库存 '}
                                  {log.stock_after}
                                </p>
                              </div>
                              <span className={`shrink-0 font-semibold ${log.delta > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                {log.delta > 0 ? `+${log.delta}` : log.delta}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
              </TabsContent>
            </Tabs>

            <DrawerFooter className="flex-row gap-2">
              <Button className="flex-1" onClick={() => onEdit(p)}>
                <Pencil className="mr-1 h-4 w-4" />
                编辑
              </Button>
              <Button variant="outline" className="flex-1" onClick={() => onDuplicate(p)}>
                <Copy className="mr-1 h-4 w-4" />
                复制
              </Button>
              <DrawerClose asChild>
                <Button variant="ghost">关闭</Button>
              </DrawerClose>
            </DrawerFooter>
          </>
        )}
      </DrawerContent>
    </Drawer>
  )
}
