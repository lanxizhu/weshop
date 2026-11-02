import type { Order, OrderStatus } from '@weshop/shared'
import { Image, ScrollView, Text, View } from '@tarojs/components'
import Taro, { usePullDownRefresh, useReachBottom, useRouter } from '@tarojs/taro'
import { useCallback, useEffect, useRef, useState } from 'react'
import { fmtPrice } from '@/components/product-card'
import { assetUrl } from '@/services/api'
import { fetchOrders, ORDER_STATUS_TEXT } from '@/services/order'
import { goCashier, goOrderDetail, handleCancelOrder, handleConfirmOrder } from '../helpers'
import './index.scss'

const PAGE_SIZE = 10

interface StatusTab {
  label: string
  status: OrderStatus | 'all'
}

const STATUS_TABS: StatusTab[] = [
  { label: '全部', status: 'all' },
  { label: '待付款', status: 'pending' },
  { label: '待发货', status: 'paid' },
  { label: '待收货', status: 'shipped' },
  { label: '已完成', status: 'completed' },
]

function toast(message: string) {
  Taro.showToast({ title: message, icon: 'none' })
}

function isStatus(value: string): value is OrderStatus | 'all' {
  return STATUS_TABS.some(tab => tab.status === value)
}

export default function OrderList() {
  const { params } = useRouter()
  const initialStatus = params.status && isStatus(params.status) ? params.status : 'all'
  const [status, setStatus] = useState<OrderStatus | 'all'>(initialStatus)
  const [orders, setOrders] = useState<Order[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const loadingRef = useRef(false)

  const load = useCallback(async (targetStatus: OrderStatus | 'all', targetPage: number, append: boolean) => {
    if (loadingRef.current)
      return
    loadingRef.current = true
    if (!append)
      setLoading(true)
    try {
      const res = await fetchOrders({ status: targetStatus, page: targetPage, pageSize: PAGE_SIZE })
      setOrders(prev => (append ? [...prev, ...res.orders] : res.orders))
      setTotal(res.total)
      setPage(res.page)
    }
    catch (err) {
      const message = err instanceof Error ? err.message : '加载失败'
      toast(message)
      if (message === '请先登录') {
        setOrders([])
        setTotal(0)
      }
    }
    finally {
      loadingRef.current = false
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(initialStatus, 1, false)
  }, [initialStatus, load])

  usePullDownRefresh(() => {
    load(status, 1, false).finally(() => Taro.stopPullDownRefresh())
  })

  useReachBottom(() => {
    if (orders.length < total)
      load(status, page + 1, true)
  })

  function switchTab(tab: StatusTab) {
    if (tab.status === status)
      return
    setStatus(tab.status)
    setOrders([])
    load(tab.status, 1, false)
  }

  const refresh = useCallback(() => {
    load(status, 1, false)
  }, [load, status])

  return (
    <View className="order-page">
      <View className="order-page__tabs">
        {STATUS_TABS.map(tab => (
          <View
            key={tab.status}
            className={`order-page__tab ${status === tab.status ? 'is-active' : ''}`}
            onClick={() => switchTab(tab)}
          >
            {tab.label}
          </View>
        ))}
      </View>

      <ScrollView className="order-list" scrollY>
        {orders.map(order => (
          <View key={order.id} className="order-card" onClick={() => goOrderDetail(order)}>
            <View className="order-card__head">
              <Text className="order-card__no">{order.order_no}</Text>
              <Text className={`order-card__status order-card__status--${order.status}`}>
                {ORDER_STATUS_TEXT[order.status]}
              </Text>
            </View>

            {order.items.map(item => (
              <View key={item.id} className="order-card__item">
                {item.product_image
                  ? (
                      <Image className="order-card__cover" src={assetUrl(item.product_image)} mode="aspectFill" lazyLoad />
                    )
                  : (
                      <View className="order-card__cover image-placeholder">暂无图片</View>
                    )}
                <View className="order-card__item-main">
                  <Text className="order-card__item-name">{item.product_name}</Text>
                  {item.sku_name && (
                    <Text className="order-card__item-sku">{item.sku_name}</Text>
                  )}
                  <View className="order-card__item-row">
                    <Text className="order-card__item-price">{fmtPrice(item.price)}</Text>
                    <Text className="order-card__item-quantity">
                      ×
                      {item.quantity}
                    </Text>
                  </View>
                </View>
              </View>
            ))}

            <View className="order-card__foot">
              <Text className="order-card__total">
                合计：
                {fmtPrice(order.total_amount)}
              </Text>
              <View className="order-card__actions">
                {order.status === 'pending' && (
                  <>
                    <View
                      className="order-card__btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleCancelOrder(order, refresh)
                      }}
                    >
                      取消订单
                    </View>
                    <View
                      className="order-card__btn order-card__btn--primary"
                      onClick={(e) => {
                        e.stopPropagation()
                        goCashier(order)
                      }}
                    >
                      去支付
                    </View>
                  </>
                )}
                {order.status === 'shipped' && (
                  <View
                    className="order-card__btn order-card__btn--primary"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleConfirmOrder(order, refresh)
                    }}
                  >
                    确认收货
                  </View>
                )}
              </View>
            </View>
          </View>
        ))}

        {!loading && orders.length === 0 && (
          <View className="order-page__empty">暂无相关订单</View>
        )}
        {loading && <View className="order-page__empty">加载中…</View>}
        {!loading && orders.length > 0 && orders.length >= total && (
          <View className="order-page__empty">没有更多了</View>
        )}
      </ScrollView>
    </View>
  )
}
