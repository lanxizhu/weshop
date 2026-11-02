import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router'
import { AppLayout } from '@/components/app-layout'
import { RequireAdmin } from '@/components/require-admin'
import { Toaster } from '@/components/ui/sonner'
import { Spinner } from '@/components/ui/spinner'

const Categories = lazy(() => import('./pages/Categories'))
const ChangePassword = lazy(() => import('./pages/ChangePassword'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Home = lazy(() => import('./pages/Home'))
const Login = lazy(() => import('./pages/Login'))
const Orders = lazy(() => import('./pages/Orders'))
const Users = lazy(() => import('./pages/Users'))

function PageLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
      <Spinner className="size-5" aria-hidden="true" />
      <span>页面加载中…</span>
    </div>
  )
}

export default function App() {
  return (
    <>
      <Suspense fallback={<PageLoading />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            element={(
              <RequireAdmin>
                <AppLayout />
              </RequireAdmin>
            )}
          >
            <Route path="/" element={<Home />} />
            <Route path="/categories" element={<Categories />} />
            <Route path="/users" element={<Users />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/change-password" element={<ChangePassword />} />
          </Route>
        </Routes>
      </Suspense>
      <Toaster position="top-center" richColors />
    </>
  )
}
