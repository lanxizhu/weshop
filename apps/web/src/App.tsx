import { Outlet, useRouter } from '@tanstack/react-router'
import { Suspense, useEffect } from 'react'
import { Toaster } from '@/components/ui/sonner'
import { Spinner } from '@/components/ui/spinner'
import { AUTH_UNAUTHORIZED_EVENT } from '@/lib/auth'

function PageLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
      <Spinner className="size-5" aria-hidden="true" />
      <span>页面加载中…</span>
    </div>
  )
}

export default function App() {
  const router = useRouter()

  useEffect(() => {
    function handleUnauthorized() {
      const redirect = `${window.location.pathname}${window.location.search}${window.location.hash}`
      void router.navigate({ to: '/login', search: { redirect }, replace: true })
    }
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized)
    return () => window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized)
  }, [router])

  return (
    <>
      <Suspense fallback={<PageLoading />}>
        <Outlet />
      </Suspense>
      <Toaster position="top-center" richColors />
    </>
  )
}
