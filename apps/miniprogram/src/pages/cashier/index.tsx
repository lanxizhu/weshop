import type { Order } from '@weshop/shared'
import { Text, View } from '@tarojs/components'
import Taro, { useRouter } from '@tarojs/taro'
import { useEffect, useState } from 'react'
import { fmtPrice } from '@/components/product-card'
import { fetchOrder, payOrder } from '@/services/order'
import './index.scss'

function toast(message: string) {
  Taro.showToast({ title: message, icon: 'none' })
}

export default function Cashier() {
  const { params } = useRouter()
  const id = Number(params.id)
  const [order, setOrder] = useState<Order | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [paying, setPaying] = useState(false)

  useEffect(() => {
    if (!Number.isInteger(id) || id <= 0) {
      setError('订单不存在')
      setLoading(false)
      return
    }
    fetchOrder(id)
      .then(res => setOrder(res.order))
      .catch(err => setError(err instanceof Error ? err.message : '加载失败'))
      .finally(() => setLoading(false))
  }, [id])

  function goDetail() {
    Taro.redirectTo({ url: `/pages/order/detail/index?id=${id}` })
  }

  async function handlePay() {
    if (paying)
      return
    setPaying(true)
    try {
      await payOrder(id)
      Taro.showToast({ title: '支付成功', icon: 'success' })
      setTimeout(goDetail, 800)
    }
    catch (err) {
      toast(err instanceof Error ? err.message : '支付失败')
      setPaying(false)
    }
  }

  if (loading)
    return <View className="cashier-state">加载中…</View>
  if (error || !order)
    return <View className="cashier-state">{error || '订单不存在'}</View>

  if (order.status !== 'pending') {
    return (
      <View className="cashier-state">
        <Text>该订单无需支付</Text>
        <View className="cashier__link" onClick={goDetail}>查看订单详情</View>
      </View>
    )
  }

  const goodsSummary = order.items.map(item => item.product_name).join('、')

  return (
    <View className="cashier">
      <Text className="cashier__order-no">
        订单号：
        {order.order_no}
      </Text>
      <Text className="cashier__amount">{fmtPrice(order.total_amount)}</Text>
      <Text className="cashier__goods">{goodsSummary}</Text>

      <View className={`cashier__pay-btn ${paying ? 'is-disabled' : ''}`} onClick={handlePay}>
        {paying ? '支付中…' : '确认支付'}
      </View>
      <View className="cashier__link" onClick={goDetail}>放弃支付，稍后再付</View>
    </View>
  )
}
