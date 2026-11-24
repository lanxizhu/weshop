import type { SystemSettings, SystemSettingsInput } from '@weshop/shared'
import type { ChangeEvent } from 'react'
import { BookmarkCheck, Globe2, History, Image as ImageIcon, RotateCcw, Save, Settings2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { uploadImage } from '@/lib/api'
import { useSystemSettings } from '@/lib/system-settings'

interface ImageFieldProps {
  id: string
  label: string
  description: string
  value: string
  disabled: boolean
  onChange: (value: string) => void
  onUploadingChange: (uploading: boolean) => void
}

function ImageField({ id, label, description, value, disabled, onChange, onUploadingChange }: ImageFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }

    setUploading(true)
    onUploadingChange(true)
    try {
      const url = await uploadImage(file)
      onChange(url)
      toast.success(`${label}已上传，保存设置后生效`)
    }
    catch (e) {
      toast.error(e instanceof Error ? e.message : '图片上传失败')
    }
    finally {
      setUploading(false)
      onUploadingChange(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-start gap-3">
        <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted text-muted-foreground">
          {value
            ? <img src={value} alt={`${label}预览`} className="h-full w-full object-contain" />
            : <ImageIcon className="size-6" aria-hidden="true" />}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <Label htmlFor={`${id}-url`}>{label}</Label>
          <p className="text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
      </div>
      <Input
        id={`${id}-url`}
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder="https://… 或 /uploads/…"
        maxLength={2048}
        disabled={disabled || uploading}
      />
      <div className="flex flex-wrap gap-2">
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
          aria-label={`上传${label}`}
          onChange={handleFile}
          disabled={disabled || uploading}
        />
        <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={disabled || uploading}>
          {uploading ? <Spinner aria-hidden="true" /> : <Upload aria-hidden="true" />}
          {uploading ? '上传中…' : '上传图片'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange('')} disabled={disabled || uploading || !value}>
          清除
        </Button>
      </div>
    </div>
  )
}

interface SystemSettingsContentProps {
  settings: SystemSettings
  loading: boolean
  loadError: string
  refresh: () => Promise<void>
  saveSettings: (input: SystemSettingsInput) => Promise<SystemSettings>
  saveSettingsAsDefaults: (input: SystemSettingsInput) => Promise<SystemSettings>
  restoreSettingsDefaults: () => Promise<SystemSettings>
}

type DefaultAction = 'save' | 'restore'

export default function SystemSettingsPage() {
  const context = useSystemSettings()
  return (
    <SystemSettingsContent
      key={JSON.stringify(context.settings)}
      settings={context.settings}
      loading={context.loading}
      loadError={context.error}
      refresh={context.refresh}
      saveSettings={context.saveSettings}
      saveSettingsAsDefaults={context.saveSettingsAsDefaults}
      restoreSettingsDefaults={context.restoreSettingsDefaults}
    />
  )
}

function SystemSettingsContent({
  settings,
  loading,
  loadError,
  refresh,
  saveSettings,
  saveSettingsAsDefaults,
  restoreSettingsDefaults,
}: SystemSettingsContentProps) {
  const [values, setValues] = useState<SystemSettingsInput>({ ...settings })
  const [saving, setSaving] = useState(false)
  const [pendingUploads, setPendingUploads] = useState(0)
  const [confirmAction, setConfirmAction] = useState<DefaultAction | null>(null)
  const [defaultActionPending, setDefaultActionPending] = useState(false)
  const [error, setError] = useState('')

  const dirty = (Object.keys(values) as Array<keyof SystemSettings>).some(key => values[key] !== settings[key])
  const disabled = saving || loading || defaultActionPending

  function update(key: keyof SystemSettings, value: string) {
    setValues(current => ({ ...current, [key]: value }))
    setError('')
  }

  function handleUploadingChange(uploading: boolean) {
    setPendingUploads(count => uploading ? count + 1 : Math.max(0, count - 1))
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const name = values.site_name.trim()
    if (!name) {
      setError('网站名称不能为空')
      return
    }

    const input: SystemSettingsInput = {
      site_name: name,
      site_description: values.site_description.trim(),
      site_logo_url: values.site_logo_url.trim(),
      site_favicon_url: values.site_favicon_url.trim(),
    }
    setSaving(true)
    setError('')
    try {
      const saved = await saveSettings(input)
      setValues(saved)
      toast.success('系统设置已保存并生效')
    }
    catch (e) {
      setError(e instanceof Error ? e.message : '保存失败，请重试')
    }
    finally {
      setSaving(false)
    }
  }

  async function handleDefaultAction() {
    const action = confirmAction
    if (!action) {
      return
    }

    setConfirmAction(null)
    setDefaultActionPending(true)
    setError('')
    try {
      if (action === 'save') {
        await saveSettingsAsDefaults(settings)
        toast.success('已将当前设置保存为默认配置')
      }
      else {
        const restored = await restoreSettingsDefaults()
        setValues(restored)
        toast.success('已恢复默认设置')
      }
    }
    catch (e) {
      setError(e instanceof Error ? e.message : '默认配置操作失败，请重试')
    }
    finally {
      setDefaultActionPending(false)
    }
  }

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-6 py-8">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Settings2 className="size-5" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">系统设置</h1>
          <p className="text-sm leading-6 text-muted-foreground">管理网站品牌信息，保存后立即更新登录页、后台顶部和浏览器标签页。</p>
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Spinner className="size-4" aria-hidden="true" />
          正在读取系统设置…
        </div>
      )}
      {loadError && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm" role="alert">
          <span>
            系统设置加载失败：
            {loadError}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>重新加载</Button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Globe2 className="size-4 text-primary" aria-hidden="true" />
              <CardTitle>基本信息</CardTitle>
            </div>
            <CardDescription>网站名称用于浏览器标题和后台品牌区，简介用于搜索引擎的页面描述。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="site-name">网站名称 *</Label>
              <Input
                id="site-name"
                value={values.site_name}
                onChange={event => update('site_name', event.target.value)}
                placeholder="例如：WeShop"
                maxLength={50}
                required
                disabled={disabled}
              />
              <p className="text-xs text-muted-foreground">
                浏览器标题将显示为“
                {values.site_name.trim() || '网站名称'}
                {' '}
                管理后台”。
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="site-description">网站简介</Label>
              <Textarea
                id="site-description"
                value={values.site_description}
                onChange={event => update('site_description', event.target.value)}
                placeholder="简要介绍网站定位与主营商品"
                maxLength={200}
                rows={3}
                disabled={disabled}
              />
              <p className="text-right text-xs text-muted-foreground">
                {values.site_description.length}
                /200
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ImageIcon className="size-4 text-primary" aria-hidden="true" />
              <CardTitle>品牌图标</CardTitle>
            </div>
            <CardDescription>支持本地上传或填写 http(s) 图片地址，单张图片不能超过 5MB。</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <ImageField
              id="site-logo"
              label="网站 Logo"
              description="显示在登录页和后台顶部，建议使用透明背景的正方形图片。"
              value={values.site_logo_url}
              onChange={value => update('site_logo_url', value)}
              onUploadingChange={handleUploadingChange}
              disabled={disabled}
            />
            <ImageField
              id="site-favicon"
              label="浏览器 favicon"
              description="显示在浏览器标签页和收藏夹中，建议使用正方形 PNG 图片。"
              value={values.site_favicon_url}
              onChange={value => update('site_favicon_url', value)}
              onUploadingChange={handleUploadingChange}
              disabled={disabled}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <BookmarkCheck className="size-4 text-primary" aria-hidden="true" />
              <CardTitle>默认配置</CardTitle>
            </div>
            <CardDescription>
              将已保存的当前设置存为默认快照，之后可一键恢复；未保存过快照时恢复内置 WeShop 配置。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmAction('save')}
              disabled={disabled || dirty || pendingUploads > 0}
              title={dirty ? '请先保存当前修改，再保存为默认配置' : undefined}
            >
              <BookmarkCheck aria-hidden="true" />
              将当前设置存为默认
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmAction('restore')}
              disabled={disabled || pendingUploads > 0}
            >
              <History aria-hidden="true" />
              恢复默认设置
            </Button>
            {dirty && <p className="w-full text-xs text-muted-foreground">当前有未保存修改；存为默认前请先点击“保存设置”。</p>}
            {defaultActionPending && (
              <p className="flex w-full items-center gap-2 text-xs text-muted-foreground" role="status">
                <Spinner className="size-3" aria-hidden="true" />
                正在处理默认配置…
              </p>
            )}
          </CardContent>
        </Card>

        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {pendingUploads > 0 && <span className="mr-auto text-sm text-muted-foreground">图片上传完成后即可保存</span>}
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setValues({ ...settings })
              setError('')
            }}
            disabled={!dirty || disabled || pendingUploads > 0}
          >
            <RotateCcw aria-hidden="true" />
            还原修改
          </Button>
          <Button type="submit" disabled={!dirty || disabled || pendingUploads > 0}>
            {saving ? <Spinner aria-hidden="true" /> : <Save aria-hidden="true" />}
            {saving ? '保存中…' : '保存设置'}
          </Button>
        </div>
      </form>

      <AlertDialog open={confirmAction !== null} onOpenChange={open => !open && setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction === 'save' ? '保存为默认配置？' : '恢复默认设置？'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction === 'save'
                ? '当前已保存的网站名称、简介和图标将替换上一份默认配置，当前线上设置保持不变。'
                : '最近保存的默认配置将覆盖当前网站设置，未保存的修改也会丢失。'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDefaultAction()}>
              {confirmAction === 'save' ? '确认保存' : '确认恢复'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  )
}
