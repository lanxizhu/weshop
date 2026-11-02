import type { CartItem } from '@weshop/shared'
import { Image, ScrollView, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { MAX_CART_ITEM_QUANTITY } from '@weshop/shared'
import { useRef, useState } from 'react'
import { fmtPrice, goDetail } from '@/components/product-card'
import { assetUrl } from '@/services/api'
import { ensureLogin, getCachedUser } from '@/services/auth'
import { fetchCart, removeCartItem, syncCartBadge, updateCartQuantity } from '@/services/cart'
import { setTabSelected, TAB_INDEX } from '@/services/tabbar'
import './index.scss'

function toast(message: string) {
  Taro.showToast({ title: message, icon: 'none' })
}

export default function Cart() {
  const [items, setItems] = useState<CartItem[]>([])
  const [checked, setChecked] = useState<Set<number>>(() => new Set())
  const [loading, setLoading] = useState(true)
  const [loggedIn, setLoggedIn] = useState(() => !!getCachedUser())
  const initializedRef = useRef(false)

  useDidShow(() => {
    setTabSelected(TAB_INDEX.cart)
    load()
  })

  async function load() {
    setLoading(true)
    try {
      await ensureLogin()
      setLoggedIn(true)
      const res = await fetchCart()
      applyCart(res.items)
      syncCartBadge(res.total_quantity)
    }
    catch (err) {
      const message = err instanceof Error ? err.message : '加载失败'
      if (message === '请先登录') {
        setLoggedIn(false)
        setItems([])
        setChecked(new Set())
        syncCartBadge(0)
      }
      else {
        toast(message)
      }
    }
    finally {
      setLoading(false)
    }
  }

  /** 服务端数据回填：首次加载勾选所有非失效项，之后保留用户的勾选状态 */
  function applyCart(list: CartItem[]) {
    setItems(list)
    const first = !initializedRef.current
    initializedRef.current = true
    setChecked((prev) => {
      const next = new Set<number>()
      for (const item of list) {
        if (item.invalid)
          continue
        if (first || prev.has(item.id))
          next.add(item.id)
      }
      return next
    })
  }

  function toggleCheck(item: CartItem) {
    if (item.invalid)
      return
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(item.id))
        next.delete(item.id)
      else
        next.add(item.id)
      return next
    })
  }

  async function handleQuantity(item: CartItem, delta: 1 | -1) {
    const quantity = item.quantity + delta
    if (quantity < 1 || quantity > MAX_CART_ITEM_QUANTITY)
      return
    try {
      const res = await updateCartQuantity(item.id, quantity)
      applyCart(res.items)
      syncCartBadge(res.total_quantity)
    }
    catch (err) {
      toast(err instanceof Error ? err.message : '修改失败')
    }
  }

  function handleRemove(item: CartItem) {
    Taro.showModal({ title: '删除商品', content: `确定删除「${item.name}」吗？` }).then(async (res) => {
      if (!res.confirm)
        return
      try {
        await removeCartItem(item.id)
        Taro.showToast({ title: '已删除', icon: 'success' })
        load()
      }
      catch (err) {
        toast(err instanceof Error ? err.message : '删除失败')
      }
    })
  }

  async function handleLogin() {
    try {
      await ensureLogin()
      setLoggedIn(true)
      load()
    }
    catch (err) {
      toast(err instanceof Error ? err.message : '登录失败')
    }
  }

  const checkedItems = items.filter(item => checked.has(item.id) && !item.invalid)
  const checkedQuantity = checkedItems.reduce((sum, item) => sum + item.quantity, 0)
  const checkedAmount = checkedItems.reduce((sum, item) => sum + item.subtotal, 0)

  function goCheckout() {
    if (checkedItems.length === 0)
      return
    const ids = checkedItems.map(item => item.id).join(',')
    Taro.navigateTo({ url: `/pages/checkout/index?items=${ids}` })
  }

  if (!loggedIn && !loading) {
    return (
      <View className="cart-state">
        <Text className="cart-state__text">登录后才能查看购物车</Text>
        <View className="cart-state__btn" onClick={handleLogin}>去登录</View>
      </View>
    )
  }

  return (
    <View className="cart-page">
      <ScrollView className="cart-list" scrollY>
        {items.map(item => (
          <View key={item.id} className={`cart-item ${item.invalid ? 'is-invalid' : ''}`}>
            <View
              className={`cart-item__check ${checked.has(item.id) && !item.invalid ? 'is-checked' : ''} ${item.invalid ? 'is-disabled' : ''}`}
              onClick={() => toggleCheck(item)}
            >
              {checked.has(item.id) && !item.invalid ? '✓' : ''}
            </View>
            <View className="cart-item__cover-wrap" onClick={() => goDetail(item.product_id)}>
              {item.image
                ? (
                    <Image className="cart-item__cover" src={assetUrl(item.image)} mode="aspectFill" lazyLoad />
                  )
                : (
                    <View className="cart-item__cover image-placeholder">暂无图片</View>
                  )}
            </View>
            <View className="cart-item__main">
              <Text className="cart-item__name" onClick={() => goDetail(item.product_id)}>{item.name}</Text>
              {item.sku_name && (
                <Text className="cart-item__sku">{item.sku_name}</Text>
              )}
              {item.invalid && (
                <Text className="cart-item__invalid-tag">{item.status === 'off' ? '已下架' : '库存不足'}</Text>
              )}
              <View className="cart-item__row">
                <Text className="cart-item__price">{fmtPrice(item.price)}</Text>
                <View className="cart-item__stepper">
                  <View
                    className={`cart-item__step-btn ${item.quantity <= 1 || item.invalid ? 'is-disabled' : ''}`}
                    onClick={() => handleQuantity(item, -1)}
                  >
                    -
                  </View>
                  <Text className="cart-item__quantity">{item.quantity}</Text>
                  <View
                    className={`cart-item__step-btn ${item.quantity >= MAX_CART_ITEM_QUANTITY || item.invalid ? 'is-disabled' : ''}`}
                    onClick={() => handleQuantity(item, 1)}
                  >
                    +
                  </View>
                </View>
              </View>
            </View>
            <Text className="cart-item__remove" onClick={() => handleRemove(item)}>删除</Text>
          </View>
        ))}

        {!loading && items.length === 0 && (
          <View className="cart-page__empty">
            <Text>购物车还是空的</Text>
            <View className="cart-page__empty-btn" onClick={() => Taro.switchTab({ url: '/pages/index/index' })}>
              去逛逛
            </View>
          </View>
        )}
        {loading && <View className="cart-page__empty">加载中…</View>}
      </ScrollView>

      {items.length > 0 && (
        <View className="cart-page__footer">
          <View className="cart-page__total">
            合计：
            <Text className="cart-page__total-amount">{fmtPrice(checkedAmount)}</Text>
          </View>
          <View
            className={`cart-page__checkout-btn ${checkedItems.length === 0 ? 'is-disabled' : ''}`}
            onClick={goCheckout}
          >
            去结算（
            {checkedQuantity}
            ）
          </View>
        </View>
      )}
    </View>
  )
}
