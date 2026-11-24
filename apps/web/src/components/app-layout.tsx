import { Link, Outlet, useNavigate } from '@tanstack/react-router'
import { KeyRound, LogOut, Package } from 'lucide-react'
import { ThemeToggle } from '@/components/theme-toggle'
import { Button } from '@/components/ui/button'
import { clearToken } from '@/lib/auth'
import { useSystemSettings } from '@/lib/system-settings'

const NAV_ITEMS = [
  { to: '/dashboard', label: '数据统计', exact: false },
  { to: '/', label: '商品管理', exact: true },
  { to: '/categories', label: '分类管理', exact: false },
  { to: '/users', label: '用户管理', exact: false },
  { to: '/orders', label: '订单管理', exact: false },
  { to: '/settings', label: '系统设置', exact: false },
] as const

export function AppLayout() {
  const navigate = useNavigate()
  const { settings } = useSystemSettings()

  function logout() {
    clearToken()
    navigate({ to: '/login', replace: true })
  }

  return (
    <div className="min-h-screen bg-muted/40">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:h-14 lg:flex-nowrap lg:gap-6 lg:py-0">
          <div className="order-1 flex shrink-0 items-center gap-2 whitespace-nowrap font-semibold">
            {settings.site_logo_url
              ? <img src={settings.site_logo_url} alt="" className="size-7 rounded object-contain" />
              : <Package className="h-5 w-5 text-primary" aria-hidden="true" />}
            {settings.site_name}
            {' '}
            管理后台
          </div>
          <nav className="order-3 flex w-full flex-wrap items-center gap-1 lg:order-2 lg:w-auto">
            {NAV_ITEMS.map(item => (
              <Link
                key={item.to}
                to={item.to}
                activeOptions={{ exact: item.exact }}
                className="whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors"
                activeProps={{ className: 'bg-primary/10 font-medium text-primary' }}
                inactiveProps={{ className: 'text-muted-foreground hover:bg-muted hover:text-foreground' }}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="order-2 ml-auto flex shrink-0 items-center gap-2 lg:order-3 lg:ml-0">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/change-password" aria-label="修改密码" title="修改密码">
                <KeyRound className="mr-1 h-4 w-4 lg:mr-0" />
                <span className="hidden lg:inline">修改密码</span>
              </Link>
            </Button>
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={logout}>
              <LogOut className="mr-1 h-4 w-4" />
              退出登录
            </Button>
          </div>
        </div>
      </header>
      <Outlet />
    </div>
  )
}
