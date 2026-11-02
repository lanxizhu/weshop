import type { Order, OrderStatus } from '@weshop/shared'
import { Image, ScrollView, Text, View } from '@tarojs/components'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import { useCallback, useState } from 'react'
import { fmtPrice } from '@/components/product-card'
import { assetUrl } from '@/services/api'
import { fetchOrder, ORDER_STATUS_TEXT } from '@/services/order'
import { goCashier, handleCancelOrder, handleConfirmOrder } from '../helpers'
import './index.scss'

const STATUS_DESC: Record<OrderStatus, string> = {
  pending: '请尽快完成支付',
  paid: '商家正在备货，请耐心等待',
  shipped: '商品已发出，请注意查收',
  completed: '交易已完成，感谢购买',
  cancelled: '订单已取消',
}

/** 把时间字符串格式化为 YYYY-MM-DD HH:mm（非法输入原样返回） */
function fmtTime(value: string | null): string {
  if (!value)
    return ''
  const d = new Date(value.includes('T') ? value : value.replace(' ', 'T'))
  if (Number.isNaN(d.getTime()))
    return value
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function OrderDetail() {
  const { params } = useRouter()
  const id = Number(params.id)
  const [order, setOrder] = useState<Order | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    if (!Number.isInteger(id) || id <= 0) {
      setError('订单不存在')
      setLoading(false)
      return
    }
    fetchOrder(id)
      .then((res) => {
        setOrder(res.order)
        setError('')
      })
      .catch(err => setError(err instanceof Error ? err.message : '加载失败'))
      .finally(() => setLoading(false))
  }, [id])

  useDidShow(() => {
    setLoading(true)
    load()
  })

  if (loading && !order)
    return <View className="order-detail-state">加载中…</View>
  if (error && !order)
    return <View className="order-detail-state">{error}</View>
  if (!order)
    return <View className="order-detail-state">订单不存在</View>

  const timeRows: Array<[string, string]> = [
    ['创建时间', fmtTime(order.created_at)],
    ['支付时间', fmtTime(order.paid_at)],
    ['发货时间', fmtTime(order.shipped_at)],
    ['完成时间', fmtTime(order.completed_at)],
    ['取消时间', fmtTime(order.cancelled_at)],
  ].filter((row): row is [string, string] => row[1] !== '')

  return (
    <View className="order-detail">
      <ScrollView className="order-detail__body" scrollY>
        <View className={`order-detail__status order-detail__status--${order.status}`}>
          <Text className="order-detail__status-text">{ORDER_STATUS_TEXT[order.status]}</Text>
          <Text className="order-detail__status-desc">{STATUS_DESC[order.status]}</Text>
        </View>

        <View className="order-detail__section">
          <Text className="order-detail__section-title">收货地址</Text>
          <View className="order-detail__addr">
            <View className="order-detail__addr-head">
              <Text className="order-detail__addr-receiver">{order.receiver}</Text>
              <Text className="order-detail__addr-phone">{order.phone}</Text>
            </View>
            <Text className="order-detail__addr-detail">
              {order.province}
              {' '}
              {order.city}
              {' '}
              {order.district}
              {' '}
              {order.detail}
            </Text>
          </View>
        </View>

        <View className="order-detail__section">
          <Text className="order-detail__section-title">商品明细</Text>
          {order.items.map(item => (
            <View key={item.id} className="order-detail__item" onClick={() => Taro.navigateTo({ url: `/pages/detail/index?id=${item.product_id}` })}>
              {item.product_image
                ? (
                    <Image className="order-detail__cover" src={assetUrl(item.product_image)} mode="aspectFill" lazyLoad />
                  )
                : (
                    <View className="order-detail__cover image-placeholder">暂无图片</View>
                  )}
              <View className="order-detail__item-main">
                <Text className="order-detail__item-name">{item.product_name}</Text>
                {item.sku_name && (
                  <Text className="order-detail__item-sku">{item.sku_name}</Text>
                )}
                <View className="order-detail__item-row">
                  <Text className="order-detail__item-price">{fmtPrice(item.price)}</Text>
                  <Text className="order-detail__item-quantity">
                    ×
                    {item.quantity}
                  </Text>
                </View>
              </View>
            </View>
          ))}
          <View className="order-detail__amount">
            <Text>合计</Text>
            <Text className="order-detail__amount-value">{fmtPrice(order.total_amount)}</Text>
          </View>
        </View>

        <View className="order-detail__section">
          <Text className="order-detail__section-title">订单信息</Text>
          <View className="order-detail__info-row">
            <Text className="order-detail__info-label">订单号</Text>
            <Text className="order-detail__info-value">{order.order_no}</Text>
          </View>
          {order.remark && (
            <View className="order-detail__info-row">
              <Text className="order-detail__info-label">订单备注</Text>
              <Text className="order-detail__info-value">{order.remark}</Text>
            </View>
          )}
          {timeRows.map(([label, value]) => (
            <View key={label} className="order-detail__info-row">
              <Text className="order-detail__info-label">{label}</Text>
              <Text className="order-detail__info-value">{value}</Text>
            </View>
          ))}
          {order.cancel_reason && (
            <View className="order-detail__info-row">
              <Text className="order-detail__info-label">取消原因</Text>
              <Text className="order-detail__info-value">{order.cancel_reason}</Text>
            </View>
          )}
        </View>
      </ScrollView>

      {(order.status === 'pending' || order.status === 'shipped') && (
        <View className="order-detail__footer">
          {order.status === 'pending' && (
            <>
              <View className="order-detail__btn" onClick={() => handleCancelOrder(order, load)}>取消订单</View>
              <View className="order-detail__btn order-detail__btn--primary" onClick={() => goCashier(order)}>去支付</View>
            </>
          )}
          {order.status === 'shipped' && (
            <View className="order-detail__btn order-detail__btn--primary" onClick={() => handleConfirmOrder(order, load)}>确认收货</View>
          )}
        </View>
      )}
    </View>
  )
}
