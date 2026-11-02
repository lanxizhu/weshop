import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { getToken } from '@/lib/auth'

/** 管理端路由守卫：无令牌跳登录页，并记录来源路径用于登录后回跳 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const location = useLocation()
  if (!getToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return children
}
