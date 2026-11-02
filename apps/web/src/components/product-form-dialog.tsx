import type { Category, Product, ProductInput, SkuInput } from '@weshop/shared'
import { ImagePlus, Link2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { SkuEditor } from '@/components/sku-editor'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { fetchCategories, uploadImage } from '@/lib/api'

const FALLBACK_CATEGORIES = ['数码配件', '家用电器', '智能穿戴', '生活日用', '运动户外', '食品饮料', '其他']

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 传入则为编辑，不传为新增 */
  initial: Product | null
  onSubmit: (input: ProductInput) => Promise<void>
}

export function ProductFormDialog({ open, onOpenChange, initial, onSubmit }: Props) {
  const [form, setForm] = useState<ProductInput>(emptyForm())
  const [categories, setCategories] = useState<Category[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [skus, setSkus] = useState<SkuInput[]>([emptySku()])
  const [urlInput, setUrlInput] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setError('')
      setUrlInput('')
      setImages(initial?.images ?? [])
      // Sku → SkuInput：剥离 sort_order / 时间戳等只读字段；新建时给一行空规格
      setSkus(
        initial?.skus?.map(s => ({ id: s.id, name: s.name, price: s.price, stock: s.stock, image: s.image }))
        ?? [emptySku()],
      )
      setForm(
        initial
          ? {
              name: initial.name,
              category: initial.category,
              price: initial.price,
              stock: initial.stock,
              description: initial.description,
              status: initial.status,
              images: initial.images,
              skus: initial.skus,
            }
          : emptyForm(),
      )
      fetchCategories()
        .then(({ categories }) => setCategories(categories))
        .catch(() => setCategories([]))
    }
  }, [open, initial])

  // 现有分类 + 兜底默认项，保证历史商品的分类总能选到
  const categoryOptions = [
    ...categories.map(c => c.name),
    ...FALLBACK_CATEGORIES.filter(c => !categories.some(x => x.name === c)),
  ]

  function addUrl() {
    const url = urlInput.trim()
    if (!url)
      return
    if (images.length >= 10) {
      toast.error('图片最多 10 张')
      return
    }
    setImages([...images, url])
    setUrlInput('')
  }

  async function handleFile(file: File) {
    setUploading(true)
    try {
      const url = await uploadImage(file)
      setImages(prev => [...prev, url])
      toast.success('图片已上传')
    }
    catch (err) {
      toast.error(err instanceof Error ? err.message : '上传失败')
    }
    finally {
      setUploading(false)
      if (fileInputRef.current)
        fileInputRef.current.value = ''
    }
  }

  // 价格/库存由规格派生：最低价与库存总和（仅展示，提交时随 skus 一并发送）
  const derivedPrice = skus.length > 0 ? Math.min(...skus.map(s => (Number.isFinite(s.price) ? s.price : 0))) : 0
  const derivedStock = skus.reduce((sum, s) => sum + (Number.isInteger(s.stock) ? s.stock : 0), 0)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    // 前端预校验规格，错误直接展示在表单内（后端会再校验一遍）
    for (let i = 0; i < skus.length; i++) {
      const s = skus[i]
      const label = skus.length > 1 ? `规格 ${i + 1} ` : ''
      if (!s.name.trim()) {
        setError(`${label}名称不能为空`)
        return
      }
      if (!Number.isFinite(s.price) || s.price < 0) {
        setError(`${label}价格必须是不小于 0 的数字`)
        return
      }
      if (!Number.isInteger(s.stock) || s.stock < 0) {
        setError(`${label}库存必须是不小于 0 的整数`)
        return
      }
    }
    setSaving(true)
    setError('')
    try {
      await onSubmit({
        ...form,
        price: derivedPrice,
        stock: derivedStock,
        images,
        skus: skus.map(s => ({ ...s, name: s.name.trim() })),
      })
      onOpenChange(false)
    }
    catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    }
    finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle>{initial ? '编辑商品' : '新增商品'}</DialogTitle>
          <DialogDescription>
            {initial ? `修改「${initial.name}」的信息、规格与上下架状态。` : '填写商品信息并上架。'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="max-h-[85vh] space-y-4 overflow-y-auto pr-1">
          <div className="space-y-2">
            <Label htmlFor="p-name">商品名称 *</Label>
            <Input
              id="p-name"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="例如：无线降噪耳机 Pro"
              maxLength={50}
              required
            />
          </div>
          <div className="space-y-2">
            <Label>规格 *</Label>
            <SkuEditor value={skus} onChange={setSkus} />
            <p className="text-xs text-muted-foreground">
              价格 ¥
              {derivedPrice.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
              {' '}
              起 · 总库存
              {' '}
              {derivedStock}
              {' '}
              （由规格自动汇总）
            </p>
          </div>
          <div className="space-y-2">
            <Label>分类</Label>
            <Select
              value={form.category}
              onValueChange={v => setForm({ ...form, category: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="选择分类" />
              </SelectTrigger>
              <SelectContent>
                {categoryOptions.map(c => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>
              商品图片（
              {images.length}
              /10）
            </Label>
            {images.length > 0 && (
              <div className="grid grid-cols-5 gap-2">
                {images.map((url, i) => (
                  <div key={`${url}-${i}`} className="group relative aspect-square overflow-hidden rounded-md border bg-muted">
                    <img
                      src={url}
                      alt={`商品图 ${i + 1}`}
                      className="h-full w-full object-cover"
                      onError={(e) => {
                        ;(e.target as HTMLImageElement).style.opacity = '0.15'
                      }}
                    />
                    <button
                      type="button"
                      title="移除"
                      className="absolute right-1 top-1 hidden rounded-full bg-black/60 p-1 text-white group-hover:block"
                      onClick={() => setImages(images.filter((_, j) => j !== i))}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Link2 className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="粘贴图片地址后回车，如 https://… 或 /uploads/…"
                  value={urlInput}
                  onChange={e => setUrlInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addUrl()
                    }
                  }}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={uploading || images.length >= 10}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? <Spinner className="mr-1 h-4 w-4" /> : <ImagePlus className="mr-1 h-4 w-4" />}
                上传
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f)
                    handleFile(f)
                }}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="p-desc">商品描述</Label>
            <Textarea
              id="p-desc"
              value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
              placeholder="卖点、规格、注意事项……"
              maxLength={500}
              rows={3}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">上架状态</p>
              <p className="text-xs text-muted-foreground">关闭后商品在前台隐藏</p>
            </div>
            <Switch
              checked={form.status === 'on'}
              onCheckedChange={v => setForm({ ...form, status: v ? 'on' : 'off' })}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Spinner className="mr-2" />}
              {initial ? '保存修改' : '创建并上架'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function emptyForm(): ProductInput {
  return { name: '', category: '其他', price: 0, stock: 0, description: '', status: 'on', images: [], skus: [] }
}

function emptySku(): SkuInput {
  return { name: '', price: 0, stock: 0, image: '' }
}
