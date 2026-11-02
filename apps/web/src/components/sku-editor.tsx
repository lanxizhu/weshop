import type { SkuInput } from '@weshop/shared'
import { ArrowDown, ArrowUp, ImagePlus, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { uploadImage } from '@/lib/api'

/** 规格图 URL 白名单：本地 /uploads/ 路径或 http(s) 地址 */
const SKU_IMAGE_PATTERN = /^(?:https?:\/\/|\/uploads\/)/

interface SkuEditorProps {
  value: SkuInput[]
  onChange: (skus: SkuInput[]) => void
}

/** 商品规格编辑器：名称 / 价格 / 库存 / 单图，支持排序与增删行 */
export function SkuEditor({ value, onChange }: SkuEditorProps) {
  function update(index: number, patch: Partial<SkuInput>) {
    onChange(value.map((s, i) => (i === index ? { ...s, ...patch } : s)))
  }

  function move(index: number, dir: -1 | 1) {
    const target = index + dir
    if (target < 0 || target >= value.length)
      return
    const next = [...value]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }

  function remove(index: number) {
    if (value.length <= 1)
      return
    onChange(value.filter((_, i) => i !== index))
  }

  function addRow() {
    onChange([...value, { name: '', price: 0, stock: 0, image: '' }])
  }

  return (
    <div className="space-y-3">
      {value.map((sku, index) => (
        <SkuRow
          key={sku.id ?? `new-${index}`}
          sku={sku}
          index={index}
          isFirst={index === 0}
          isLast={index === value.length - 1}
          canDelete={value.length > 1}
          onUpdate={patch => update(index, patch)}
          onMove={dir => move(index, dir)}
          onDelete={() => remove(index)}
        />
      ))}
      <Button type="button" variant="outline" size="sm" onClick={addRow}>
        添加规格
      </Button>
    </div>
  )
}

interface SkuRowProps {
  sku: SkuInput
  index: number
  isFirst: boolean
  isLast: boolean
  canDelete: boolean
  onUpdate: (patch: Partial<SkuInput>) => void
  onMove: (dir: -1 | 1) => void
  onDelete: () => void
}

function SkuRow({ sku, index, isFirst, isLast, canDelete, onUpdate, onMove, onDelete }: SkuRowProps) {
  const [urlInput, setUrlInput] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    setUploading(true)
    try {
      const url = await uploadImage(file)
      onUpdate({ image: url })
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

  function applyUrl() {
    const url = urlInput.trim()
    if (!url)
      return
    if (!SKU_IMAGE_PATTERN.test(url)) {
      toast.error('图片地址需以 http(s):// 或 /uploads/ 开头')
      return
    }
    onUpdate({ image: url })
    setUrlInput('')
  }

  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <span className="w-6 shrink-0 text-center text-xs text-muted-foreground">{index + 1}</span>
        <Input
          className="flex-1"
          placeholder="规格名称 *"
          value={sku.name}
          maxLength={30}
          onChange={e => onUpdate({ name: e.target.value })}
        />
        <Input
          className="w-28"
          type="number"
          min="0"
          step="0.01"
          placeholder="价格"
          title="价格（¥）"
          value={sku.price}
          onChange={e => onUpdate({ price: Number(e.target.value) })}
        />
        <Input
          className="w-24"
          type="number"
          min="0"
          step="1"
          placeholder="库存"
          title="库存"
          value={sku.stock}
          onChange={e => onUpdate({ stock: Number(e.target.value) })}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          title="上移"
          disabled={isFirst}
          onClick={() => onMove(-1)}
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          title="下移"
          disabled={isLast}
          onClick={() => onMove(1)}
        >
          <ArrowDown className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
          title="删除规格（保存时生效）"
          disabled={!canDelete}
          onClick={onDelete}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <div className="mt-2 flex items-center gap-2 pl-8">
        {sku.image
          ? (
              <img
                src={sku.image}
                alt={sku.name || `规格 ${index + 1}`}
                className="h-9 w-9 shrink-0 rounded-md border object-cover"
                onError={(e) => {
                  ;(e.target as HTMLImageElement).style.opacity = '0.15'
                }}
              />
            )
          : (
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
                <ImagePlus className="h-4 w-4" />
              </div>
            )}
        <Input
          className="flex-1"
          placeholder="粘贴规格图地址，如 https://… 或 /uploads/…"
          value={urlInput}
          onChange={e => setUrlInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              applyUrl()
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={uploading}
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
  )
}
