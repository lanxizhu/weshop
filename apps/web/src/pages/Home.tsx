import type {
  Category,
  Product,
  ProductInput,
  ProductSortField,
  ProductStats,
  SortOrder,
} from '@weshop/shared'
import { LOW_STOCK_THRESHOLD } from '@weshop/shared'
import {
  Archive,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Copy,
  Download,
  Eye,
  ImageOff,
  Minus,
  Package,
  Pencil,
  Plus,
  Search,
  Store,
  Trash2,
  TriangleAlert,
  Wallet,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ProductDetailDrawer } from '@/components/product-detail-drawer'
import { ProductFormDialog } from '@/components/product-form-dialog'
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useLatestRequest } from '@/hooks/use-latest-request'
import {
  adjustStock,
  batchDeleteProducts,
  batchSetProductStatus,
  cleanupUploads,
  createProduct,
  deleteProduct,
  downloadProductsCsv,
  duplicateProduct,
  fetchCategories,
  fetchProducts,
  fetchStats,
  onServerRecover,
  setProductStatus,
  updateProduct,
} from '@/lib/api'

const fmtPrice = (n: number) => `¥${n.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`
const fmtTime = (s: string) => s?.slice(0, 16) ?? '-'

const PAGE_SIZE = 10

const SORT_LABELS: Record<ProductSortField, string> = {
  price: '价格',
  stock: '库存',
  updated_at: '更新时间',
}

export default function Home() {
  const [products, setProducts] = useState<Product[]>([])
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState<ProductStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [lowStockOnly, setLowStockOnly] = useState(false)
  const [sort, setSort] = useState<ProductSortField>('updated_at')
  const [order, setOrder] = useState<SortOrder>('desc')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set())
  const [categories, setCategories] = useState<Category[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [deleting, setDeleting] = useState<Product | null>(null)
  const [batchDeleting, setBatchDeleting] = useState(false)
  const [adjustingId, setAdjustingId] = useState<number | null>(null)
  const [viewingId, setViewingId] = useState<number | null>(null)
  const [cleanupConfirming, setCleanupConfirming] = useState(false)
  const [cleaningUp, setCleaningUp] = useState(false)

  // 详情抽屉展示数据直接取自当前列表，库存调整等操作可实时同步
  const viewing = viewingId == null ? null : (products.find(p => p.id === viewingId) ?? null)

  const listParams = useMemo(
    () => ({
      search,
      status: statusFilter as Product['status'] | 'all',
      category: categoryFilter === 'all' ? undefined : categoryFilter,
      lowStock: lowStockOnly ? (1 as const) : undefined,
      sort,
      order,
      page,
      pageSize: PAGE_SIZE,
    }),
    [search, statusFilter, categoryFilter, lowStockOnly, sort, order, page],
  )

  const runLatest = useLatestRequest()
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const latest = await runLatest(() => Promise.all([fetchProducts(listParams), fetchStats()]))
      if (!latest)
        return
      const [result, s] = latest
      // 删除等操作导致当前页超出范围时回退一页
      if (result.products.length === 0 && result.total > 0 && page > 1) {
        setPage(p => Math.max(1, p - 1))
        setSelected(new Set())
        return
      }
      setProducts(result.products)
      setTotal(result.total)
      setStats(s)
      setLoading(false)
    }
    catch (error) {
      setLoading(false)
      throw error
    }
  }, [listParams, page, runLatest])

  useEffect(() => {
    const t = setTimeout(() => load().catch(e => toast.error(e.message)), 250)
    return () => clearTimeout(t)
  }, [load])

  useEffect(() => {
    fetchCategories()
      .then(({ categories }) => setCategories(categories))
      .catch(() => setCategories([]))
  }, [])

  // 服务从故障中恢复后，自动刷新数据
  useEffect(() => {
    return onServerRecover(() => {
      toast.success('服务已恢复，正在同步最新数据')
      load().catch(e => toast.error(e.message))
    })
  }, [load])

  function toggleSort(field: ProductSortField) {
    if (sort === field) {
      setOrder(order === 'asc' ? 'desc' : 'asc')
    }
    else {
      setSort(field)
      setOrder(field === 'updated_at' ? 'desc' : 'asc')
    }
    setPage(1)
    setSelected(new Set())
  }

  async function handleCreate(input: ProductInput) {
    await createProduct(input)
    toast.success('商品已创建')
    await load()
  }

  async function handleUpdate(input: ProductInput) {
    if (!editing)
      return
    await updateProduct(editing.id, input)
    toast.success('商品信息已更新')
    await load()
  }

  async function handleToggle(p: Product, checked: boolean) {
    try {
      await setProductStatus(p.id, checked ? 'on' : 'off')
      toast.success(checked ? `「${p.name}」已上架` : `「${p.name}」已下架`)
      await load()
    }
    catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败')
    }
  }

  function handleProductChange(product: Product) {
    setProducts(prev => prev.map(x => (x.id === product.id ? product : x)))
    fetchStats().then(setStats).catch(() => undefined)
  }

  async function handleAdjust(p: Product, delta: number) {
    setAdjustingId(p.id)
    try {
      const { product } = await adjustStock(p.id, delta)
      handleProductChange(product)
    }
    catch (e) {
      toast.error(e instanceof Error ? e.message : '库存调整失败')
    }
    finally {
      setAdjustingId(null)
    }
  }

  async function handleDuplicate(p: Product) {
    try {
      const { product } = await duplicateProduct(p.id)
      toast.success(`已复制为「${product.name}」（默认下架，编辑后上架）`)
      await load()
    }
    catch (e) {
      toast.error(e instanceof Error ? e.message : '复制失败')
    }
  }

  async function handleDelete() {
    if (!deleting)
      return
    try {
      await deleteProduct(deleting.id)
      toast.success(`「${deleting.name}」已删除`)
      setDeleting(null)
      await load()
    }
    catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败')
    }
  }

  async function handleBatchStatus(status: Product['status']) {
    try {
      const { updated } = await batchSetProductStatus([...selected], status)
      toast.success(`已${status === 'on' ? '上架' : '下架'} ${updated} 个商品`)
      setSelected(new Set())
      await load()
    }
    catch (e) {
      toast.error(e instanceof Error ? e.message : '批量操作失败')
    }
  }

  async function handleBatchDelete() {
    try {
      const { deleted } = await batchDeleteProducts([...selected])
      toast.success(`已删除 ${deleted} 个商品`)
      setBatchDeleting(false)
      setSelected(new Set())
      await load()
    }
    catch (e) {
      toast.error(e instanceof Error ? e.message : '批量删除失败')
    }
  }

  async function handleCleanupUploads() {
    setCleaningUp(true)
    try {
      const { deleted, freedBytes } = await cleanupUploads()
      const mb = (freedBytes / 1024 / 1024).toFixed(2)
      toast.success(`清理完成：删除 ${deleted} 个文件，释放 ${mb} MB`)
      setCleanupConfirming(false)
    }
    catch (e) {
      toast.error(e instanceof Error ? e.message : '清理失败')
    }
    finally {
      setCleaningUp(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const allPageSelected = products.length > 0 && products.every(p => selected.has(p.id))

  function toggleSelectAll() {
    setSelected(allPageSelected ? new Set() : new Set(products.map(p => p.id)))
  }

  function toggleSelect(id: number) {
    const next = new Set(selected)
    if (next.has(id))
      next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  const statCards = [
    { title: '商品总数', value: stats?.total, icon: Package },
    { title: '在售中', value: stats?.onShelf, icon: Store },
    { title: '已下架', value: stats?.offShelf, icon: Archive },
    { title: '低库存', value: stats?.lowStock, icon: TriangleAlert },
    { title: '库存总价值', value: stats ? fmtPrice(stats.totalValue) : undefined, icon: Wallet },
  ]

  function sortIcon(field: ProductSortField) {
    if (sort !== field)
      return <ArrowUpDown className="ml-1 h-3.5 w-3.5 text-muted-foreground" />
    return order === 'asc'
      ? (
          <ArrowUp className="ml-1 h-3.5 w-3.5" />
        )
      : (
          <ArrowDown className="ml-1 h-3.5 w-3.5" />
        )
  }

  return (
    <>
      <main className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {statCards.map(c => (
            <Card
              key={c.title}
              className={c.title === '低库存' ? 'cursor-pointer transition-colors hover:border-primary/50' : undefined}
              onClick={c.title === '低库存'
                ? () => {
                    setLowStockOnly(v => !v)
                    setPage(1)
                    setSelected(new Set())
                  }
                : undefined}
            >
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{c.title}</CardTitle>
                <c.icon
                  className={`h-4 w-4 ${c.title === '低库存' && (stats?.lowStock ?? 0) > 0 ? 'text-amber-500' : 'text-muted-foreground'}`}
                />
              </CardHeader>
              <CardContent>
                {c.value === undefined
                  ? (
                      <Skeleton className="h-8 w-20" />
                    )
                  : (
                      <div className="text-2xl font-bold">{c.value}</div>
                    )}
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="搜索名称或描述…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(1)
                  setSelected(new Set())
                }}
              />
            </div>
            <Select
              value={categoryFilter}
              onValueChange={(value) => {
                setCategoryFilter(value)
                setPage(1)
                setSelected(new Set())
              }}
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部分类</SelectItem>
                {categories.map(c => (
                  <SelectItem key={c.id} value={c.name}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={statusFilter}
              onValueChange={(value) => {
                setStatusFilter(value)
                setPage(1)
                setSelected(new Set())
              }}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="on">在售中</SelectItem>
                <SelectItem value="off">已下架</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Switch
                id="low-stock"
                checked={lowStockOnly}
                onCheckedChange={(checked) => {
                  setLowStockOnly(checked)
                  setPage(1)
                  setSelected(new Set())
                }}
              />
              <Label htmlFor="low-stock" className="cursor-pointer text-sm text-muted-foreground">
                仅看低库存
              </Label>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() =>
                downloadProductsCsv({ ...listParams, page: undefined, pageSize: undefined }).catch((e: unknown) =>
                  toast.error(e instanceof Error ? e.message : '导出失败'),
                )}
            >
              <Download className="mr-1 h-4 w-4" />
              导出 CSV
            </Button>
            <Button variant="outline" size="sm" className="h-9" onClick={() => setCleanupConfirming(true)}>
              <ImageOff className="mr-1 h-4 w-4" />
              清理图片
            </Button>
            <Button
              onClick={() => {
                setEditing(null)
                setFormOpen(true)
              }}
            >
              <Plus className="mr-1 h-4 w-4" />
              新增商品
            </Button>
          </div>
        </div>

        {selected.size > 0 && (
          <div className="flex items-center justify-between rounded-lg border bg-muted/50 px-4 py-2">
            <span className="text-sm">
              已选
              {selected.size}
              {' '}
              项
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => handleBatchStatus('on')}>
                批量上架
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleBatchStatus('off')}>
                批量下架
              </Button>
              <Button variant="destructive" size="sm" onClick={() => setBatchDeleting(true)}>
                批量删除
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                清除选择
              </Button>
            </div>
          </div>
        )}

        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allPageSelected}
                    onCheckedChange={toggleSelectAll}
                    aria-label="全选本页"
                  />
                </TableHead>
                <TableHead className="w-[30%]">商品</TableHead>
                <TableHead>分类</TableHead>
                <TableHead>
                  <button type="button" className="flex items-center font-medium" onClick={() => toggleSort('price')}>
                    {SORT_LABELS.price}
                    {sortIcon('price')}
                  </button>
                </TableHead>
                <TableHead>
                  <button type="button" className="flex items-center font-medium" onClick={() => toggleSort('stock')}>
                    {SORT_LABELS.stock}
                    {sortIcon('stock')}
                  </button>
                </TableHead>
                <TableHead>上架状态</TableHead>
                <TableHead>
                  <button type="button" className="flex items-center font-medium" onClick={() => toggleSort('updated_at')}>
                    {SORT_LABELS.updated_at}
                    {sortIcon('updated_at')}
                  </button>
                </TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading
                ? (
                    Array.from({ length: 5 }, (_, i) => `product-row-${i}`).map(row => (
                      <TableRow key={row}>
                        {Array.from({ length: 8 }, (_, i) => `product-cell-${i}`).map(cell => (
                          <TableCell key={cell}>
                            <Skeleton className="h-5 w-full max-w-[140px]" />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  )
                : products.length === 0
                  ? (
                      <TableRow>
                        <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                          没有找到匹配的商品
                        </TableCell>
                      </TableRow>
                    )
                  : (
                      products.map(p => (
                        <TableRow key={p.id} data-state={selected.has(p.id) ? 'selected' : undefined}>
                          <TableCell>
                            <Checkbox
                              checked={selected.has(p.id)}
                              onCheckedChange={() => toggleSelect(p.id)}
                              aria-label={`选择 ${p.name}`}
                            />
                          </TableCell>
                          <TableCell>
                            <div
                              className="flex cursor-pointer items-center gap-3"
                              title="查看详情"
                              onClick={() => setViewingId(p.id)}
                            >
                              {p.images?.[0]
                                ? (
                                    <img
                                      src={p.images[0]}
                                      alt={p.name}
                                      className="h-10 w-10 shrink-0 rounded-md border object-cover"
                                    />
                                  )
                                : (
                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
                                      <Package className="h-5 w-5" />
                                    </div>
                                  )}
                              <div className="min-w-0">
                                <p className="truncate font-medium hover:underline">{p.name}</p>
                                <p className="max-w-[280px] truncate text-xs text-muted-foreground">
                                  {p.description || '（无描述）'}
                                  {p.images && p.images.length > 1 ? ` · ${p.images.length} 张图` : ''}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">{p.category || '未分类'}</Badge>
                          </TableCell>
                          <TableCell className="font-medium">
                            {p.skus.length > 1 && Math.min(...p.skus.map(s => s.price)) !== Math.max(...p.skus.map(s => s.price))
                              ? `${fmtPrice(p.price)} 起`
                              : fmtPrice(p.price)}
                          </TableCell>
                          <TableCell>
                            {p.skus.length > 1
                              ? (
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      className="text-sm text-primary underline-offset-4 hover:underline"
                                      title="查看并按规格调整库存"
                                      onClick={() => setViewingId(p.id)}
                                    >
                                      {p.skus.length}
                                      {' '}
                                      个规格
                                    </button>
                                    <span className="text-muted-foreground">·</span>
                                    <span className="min-w-8 text-center">{p.stock}</span>
                                    {p.stock === 0
                                      ? (
                                          <Badge variant="destructive" className="ml-1">缺货</Badge>
                                        )
                                      : p.stock < LOW_STOCK_THRESHOLD
                                        ? (
                                            <Badge variant="secondary" className="ml-1 border-amber-300 text-amber-600">不足</Badge>
                                          )
                                        : null}
                                  </div>
                                )
                              : (
                                  <div className="flex items-center gap-1.5">
                                    <Button
                                      variant="outline"
                                      size="icon"
                                      className="h-6 w-6"
                                      title="出库 1"
                                      disabled={p.stock === 0 || adjustingId === p.id}
                                      onClick={() => handleAdjust(p, -1)}
                                    >
                                      <Minus className="h-3 w-3" />
                                    </Button>
                                    <span className="min-w-8 text-center">{p.stock}</span>
                                    <Button
                                      variant="outline"
                                      size="icon"
                                      className="h-6 w-6"
                                      title="入库 1"
                                      disabled={adjustingId === p.id}
                                      onClick={() => handleAdjust(p, 1)}
                                    >
                                      <Plus className="h-3 w-3" />
                                    </Button>
                                    {p.stock === 0
                                      ? (
                                          <Badge variant="destructive" className="ml-1">缺货</Badge>
                                        )
                                      : p.stock < LOW_STOCK_THRESHOLD
                                        ? (
                                            <Badge variant="secondary" className="ml-1 border-amber-300 text-amber-600">不足</Badge>
                                          )
                                        : null}
                                  </div>
                                )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={p.status === 'on'}
                                onCheckedChange={v => handleToggle(p, v)}
                              />
                              <span className="text-sm text-muted-foreground">
                                {p.status === 'on' ? '在售' : '已下架'}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground">{fmtTime(p.updated_at)}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                title="查看详情"
                                onClick={() => setViewingId(p.id)}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" title="复制商品" onClick={() => handleDuplicate(p)}>
                                <Copy className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                title="编辑"
                                onClick={() => {
                                  setEditing(p)
                                  setFormOpen(true)
                                }}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                title="删除"
                                className="text-destructive hover:text-destructive"
                                onClick={() => setDeleting(p)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
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
                onClick={() => {
                  setPage(p => Math.max(1, p - 1))
                  setSelected(new Set())
                }}
              >
                上一页
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages || loading}
                onClick={() => {
                  setPage(p => p + 1)
                  setSelected(new Set())
                }}
              >
                下一页
              </Button>
            </div>
          </div>
        </Card>
      </main>

      <ProductFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        initial={editing}
        onSubmit={editing ? handleUpdate : handleCreate}
      />

      <ProductDetailDrawer
        product={viewing}
        open={viewingId !== null}
        onOpenChange={o => !o && setViewingId(null)}
        onEdit={(p) => {
          setViewingId(null)
          setEditing(p)
          setFormOpen(true)
        }}
        onDuplicate={(p) => {
          setViewingId(null)
          void handleDuplicate(p)
        }}
        onProductChange={handleProductChange}
      />

      <AlertDialog open={!!deleting} onOpenChange={o => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除商品？</AlertDialogTitle>
            <AlertDialogDescription>
              将永久删除「
              {deleting?.name}
              」，此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={batchDeleting} onOpenChange={setBatchDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认批量删除？</AlertDialogTitle>
            <AlertDialogDescription>
              将永久删除选中的
              {' '}
              {selected.size}
              {' '}
              个商品，此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleBatchDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={cleanupConfirming} onOpenChange={setCleanupConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>清理未使用的图片？</AlertDialogTitle>
            <AlertDialogDescription>
              将扫描上传目录，删除所有未被商品、规格或用户头像引用的图片文件，此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cleaningUp}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleCleanupUploads} disabled={cleaningUp}>
              {cleaningUp ? '清理中…' : '开始清理'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
