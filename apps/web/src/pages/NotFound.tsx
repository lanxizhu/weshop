import { Link } from '@tanstack/react-router'
import { ArrowLeft, FileQuestion } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <main className="mx-auto grid max-w-6xl gap-8 px-6 py-12 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:py-20">
      <div className="max-w-xl">
        <div className="mb-4 flex size-11 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <FileQuestion className="size-6" aria-hidden="true" />
        </div>
        <p className="mb-2 text-sm font-medium text-muted-foreground">导航错误</p>
        <h1 className="text-2xl font-semibold tracking-tight">页面不存在</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          当前链接可能已失效，或者页面已被移动。你可以返回商品管理继续操作。
        </p>
        <Button asChild className="mt-6">
          <Link to="/">
            <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
            返回商品管理
          </Link>
        </Button>
      </div>
      <div aria-hidden="true" className="select-none text-7xl font-semibold tracking-tighter text-muted-foreground/25 md:text-8xl lg:text-9xl">
        404
      </div>
    </main>
  )
}
