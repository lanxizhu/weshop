import type { PropsWithChildren } from 'react'
import { useLaunch } from '@tarojs/taro'
import { initializeCartBadge } from '@/services/cart'
import './app.scss'

function App({ children }: PropsWithChildren) {
  // 冷启动时若已有登录态，先拉一次购物车数量，保证 tab 角标及时显示
  useLaunch(initializeCartBadge)

  return children
}

export default App
