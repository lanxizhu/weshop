import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useSyncExternalStore } from 'react'
import { Icon } from '@/components/icon'
import { getTabbarState, subscribeTabbar, TAB_INDEX } from '@/services/tabbar'
import './index.scss'

const TABS = [
  { pagePath: '/pages/index/index', text: '首页', icon: 'house' },
  { pagePath: '/pages/category/index', text: '分类', icon: 'layout-grid' },
  { pagePath: '/pages/cart/index', text: '购物车', icon: 'shopping-cart' },
  { pagePath: '/pages/mine/index', text: '我的', icon: 'user-round' },
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
              <Icon
                className="custom-tabbar__icon"
                name={tab.icon}
                size={24}
                color={active ? '#18181b' : '#71717a'}
              />
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
