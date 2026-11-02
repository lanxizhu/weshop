import { Image, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useSyncExternalStore } from 'react'
import { getTabbarState, subscribeTabbar, TAB_INDEX } from '@/services/tabbar'
import cartActiveIcon from './icons/cart-active.png'
import cartIcon from './icons/cart.png'
import categoryActiveIcon from './icons/category-active.png'
import categoryIcon from './icons/category.png'
import homeActiveIcon from './icons/home-active.png'
import homeIcon from './icons/home.png'
import mineActiveIcon from './icons/mine-active.png'
import mineIcon from './icons/mine.png'
import './index.scss'

const TABS = [
  { pagePath: '/pages/index/index', text: '首页', icon: homeIcon, activeIcon: homeActiveIcon },
  { pagePath: '/pages/category/index', text: '分类', icon: categoryIcon, activeIcon: categoryActiveIcon },
  { pagePath: '/pages/cart/index', text: '购物车', icon: cartIcon, activeIcon: cartActiveIcon },
  { pagePath: '/pages/mine/index', text: '我的', icon: mineIcon, activeIcon: mineActiveIcon },
] as const

export default function CustomTabBar() {
  const { selected, cartCount } = useSyncExternalStore(subscribeTabbar, getTabbarState)

  return (
    <View className="custom-tabbar">
      {TABS.map((tab, index) => {
        const active = index === selected
        return (
          <View
            key={tab.pagePath}
            className={`custom-tabbar__item ${active ? 'is-active' : ''}`}
            onClick={() => {
              if (!active)
                Taro.switchTab({ url: tab.pagePath })
            }}
          >
            <View className="custom-tabbar__icon-wrap">
              <Image className="custom-tabbar__icon" src={active ? tab.activeIcon : tab.icon} mode="aspectFit" />
              {index === TAB_INDEX.cart && cartCount > 0 && (
                <View className="custom-tabbar__badge">{cartCount > 99 ? '99+' : cartCount}</View>
              )}
            </View>
            <Text className="custom-tabbar__text">{tab.text}</Text>
          </View>
        )
      })}
    </View>
  )
}
