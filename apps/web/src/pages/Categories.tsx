import type { Category } from '@weshop/shared'
import { ChevronDown, ChevronUp, Pencil, Plus, Tags, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
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
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  createCategory,
  deleteCategory,
  fetchCategories,
  onServerRecover,
  reorderCategories,
  updateCategory,
} from '@/lib/api'

const fmtTime = (s: string) => s?.slice(0, 16) ?? '-'

export default function Categories() {
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Category | null>(null)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState<Category | null>(null)
  const [migrateTo, setMigrateTo] = useState('')
  const [reordering, setReordering] = useState(false)

  const load = useCallback(async () => {
    const { categories } = await fetchCategories()
    setCategories(categories)
    setLoading(false)
  }, [])

  useEffect(() => {
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

  function openForm(cat: Category | null) {
    setEditing(cat)
    setName(cat?.name ?? '')
    setError('')
    setFormOpen(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (editing) {
        await updateCategory(editing.id, { name: name.trim() })
        toast.success('分类已更新，关联商品已同步')
      }
      else {
        await createCategory({ name: name.trim() })
        toast.success('分类已创建')
      }
      setFormOpen(false)
      await load()
    }
    catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    }
    finally {
      setSaving(false)
    }
  }

  /** 上移 / 下移：与相邻项交换位置后整体提交新顺序 */
  async function handleMove(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= categories.length || reordering)
      return
    const ids = categories.map(c => c.id)
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    setReordering(true)
    try {
      const { categories: next } = await reorderCategories(ids)
      setCategories(next)
    }
    catch (e) {
      toast.error(e instanceof Error ? e.message : '排序失败')
    }
    finally {
      setReordering(false)
    }
  }

  function openDelete(cat: Category) {
    setDeleting(cat)
    setMigrateTo('')
  }

  async function handleDelete() {
    if (!deleting)
      return
    try {
      const needsMigrate = deleting.product_count > 0
      const { migrated } = await deleteCategory(deleting.id, needsMigrate ? migrateTo : undefined)
      toast.success(
        needsMigrate
          ? `已将 ${migrated} 个商品迁移到「${migrateTo}」，分类「${deleting.name}」已删除`
          : `分类「${deleting.name}」已删除`,
      )
      setDeleting(null)
      await load()
    }
    catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败')
    }
  }

  const totalProducts = categories.reduce((sum, c) => sum + c.product_count, 0)

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-6 py-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">分类总数</CardTitle>
            <Tags className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-8 w-20" /> : <div className="text-2xl font-bold">{categories.length}</div>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">已分类商品</CardTitle>
            <Tags className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-8 w-20" /> : <div className="text-2xl font-bold">{totalProducts}</div>}
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          重命名分类会同步更新该分类下所有商品；删除有商品的分类时可先把商品迁移到其他分类。
        </p>
        <Button onClick={() => openForm(null)}>
          <Plus className="mr-1 h-4 w-4" />
          新增分类
        </Button>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40%]">分类名称</TableHead>
              <TableHead>商品数量</TableHead>
              <TableHead>创建时间</TableHead>
              <TableHead>排序</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading
              ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 5 }).map((__, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-5 w-full max-w-[140px]" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )
              : categories.length === 0
                ? (
                    <TableRow>
                      <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                        暂无分类，点击右上角新增
                      </TableCell>
                    </TableRow>
                  )
                : (
                    categories.map((c, i) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">{c.name}</TableCell>
                        <TableCell>{c.product_count}</TableCell>
                        <TableCell className="text-muted-foreground">{fmtTime(c.created_at)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              title="上移"
                              disabled={i === 0 || reordering}
                              onClick={() => handleMove(i, -1)}
                            >
                              <ChevronUp className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              title="下移"
                              disabled={i === categories.length - 1 || reordering}
                              onClick={() => handleMove(i, 1)}
                            >
                              <ChevronDown className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" title="重命名" onClick={() => openForm(c)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              title="删除"
                              className="text-destructive hover:text-destructive"
                              onClick={() => openDelete(c)}
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
      </Card>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>{editing ? '重命名分类' : '新增分类'}</DialogTitle>
            <DialogDescription>
              {editing ? `将「${editing.name}」及其下商品同步改为新名称。` : '创建后可在商品表单中选用。'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="c-name">分类名称 *</Label>
              <Input
                id="c-name"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="例如：数码配件"
                maxLength={20}
                required
                autoFocus
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
                取消
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Spinner className="mr-2" />}
                {editing ? '保存' : '创建'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 空分类：直接确认删除 */}
      <AlertDialog
        open={!!deleting && deleting.product_count === 0}
        onOpenChange={o => !o && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除分类？</AlertDialogTitle>
            <AlertDialogDescription>
              将永久删除分类「
              {deleting?.name}
              」，此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 有商品的分类：迁移后删除 */}
      <Dialog
        open={!!deleting && deleting.product_count > 0}
        onOpenChange={o => !o && setDeleting(null)}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>迁移商品并删除分类</DialogTitle>
            <DialogDescription>
              分类「
              {deleting?.name}
              」下还有
              {' '}
              {deleting?.product_count}
              {' '}
              个商品，请先选择要迁移到的目标分类。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>迁移到</Label>
            <Select value={migrateTo} onValueChange={setMigrateTo}>
              <SelectTrigger>
                <SelectValue placeholder="选择目标分类" />
              </SelectTrigger>
              <SelectContent>
                {categories
                  .filter(c => c.id !== deleting?.id)
                  .map(c => (
                    <SelectItem key={c.id} value={c.name}>
                      {c.name}
                      （现有
                      {c.product_count}
                      {' '}
                      个商品）
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              取消
            </Button>
            <Button variant="destructive" disabled={!migrateTo} onClick={handleDelete}>
              迁移并删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
