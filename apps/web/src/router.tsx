import type { OrderStatus } from '@weshop/shared'
import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from '@tanstack/react-router'
import App from '@/App'
import { AppLayout } from '@/components/app-layout'
import { getToken } from '@/lib/auth'

interface LoginSearch {
  redirect?: string
}

interface OrdersSearch {
  status?: OrderStatus
}

const ORDER_STATUSES = new Set<string>([
  'pending',
  'paid',
  'shipped',
  'completed',
  'cancelled',
])

function isInternalPath(value: unknown): value is string {
  return typeof value === 'string'
    && value.startsWith('/')
    && !value.startsWith('//')
    && !value.includes('\\')
}

function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && ORDER_STATUSES.has(value)
}

const rootRoute = createRootRoute({ component: App })

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    redirect: isInternalPath(search.redirect) ? search.redirect : undefined,
  }),
  component: lazyRouteComponent(() => import('@/pages/Login')),
})

const authenticatedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'authenticated',
  beforeLoad: ({ location }) => {
    if (!getToken()) {
      throw redirect({
        to: '/login',
        search: { redirect: location.href },
        replace: true,
      })
    }
  },
  component: AppLayout,
})

const homeRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/',
  component: lazyRouteComponent(() => import('@/pages/Home')),
})

const categoriesRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/categories',
  component: lazyRouteComponent(() => import('@/pages/Categories')),
})

const usersRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/users',
  component: lazyRouteComponent(() => import('@/pages/Users')),
})

const ordersRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/orders',
  validateSearch: (search: Record<string, unknown>): OrdersSearch => ({
    status: isOrderStatus(search.status) ? search.status : undefined,
  }),
  component: lazyRouteComponent(() => import('@/pages/Orders')),
})

const dashboardRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/dashboard',
  component: lazyRouteComponent(() => import('@/pages/Dashboard')),
})

const changePasswordRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/change-password',
  component: lazyRouteComponent(() => import('@/pages/ChangePassword')),
})

const notFoundRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '$',
  component: lazyRouteComponent(() => import('@/pages/NotFound')),
})

const routeTree = rootRoute.addChildren([
  loginRoute,
  authenticatedRoute.addChildren([
    homeRoute,
    categoriesRoute,
    usersRoute,
    ordersRoute,
    dashboardRoute,
    changePasswordRoute,
    notFoundRoute,
  ]),
])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
