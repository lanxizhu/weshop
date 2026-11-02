import type { PropsWithChildren } from 'react'
import Taro, { useLaunch } from '@tarojs/taro'
import { fetchCart, syncCartBadge } from '@/services/cart'
import { TOKEN_KEY } from '@/services/request'
import './app.scss'

function App({ children }: PropsWithChildren) {
  // 冷启动时若已有登录态，先拉一次购物车数量，保证 tab 角标及时显示
  useLaunch(() => {
    if (!Taro.getStorageSync(TOKEN_KEY))
      return
    fetchCart()
      .then(res => syncCartBadge(res.total_quantity))
      .catch(() => {})
  })

  return children
}

export default App
