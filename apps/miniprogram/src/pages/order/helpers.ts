import type { Order } from '@weshop/shared'
import Taro from '@tarojs/taro'
import { cancelOrder, confirmOrder } from '@/services/order'

function toast(message: string) {
  Taro.showToast({ title: message, icon: 'none' })
}

export function goCashier(order: Order) {
  Taro.navigateTo({ url: `/pages/cashier/index?id=${order.id}` })
}

export function goOrderDetail(order: Order) {
  Taro.navigateTo({ url: `/pages/order/detail/index?id=${order.id}` })
}

/** 取消订单（Modal 确认）→ 成功后调用 onDone 刷新 */
export function handleCancelOrder(order: Order, onDone: () => void) {
  Taro.showModal({ title: '取消订单', content: `确定取消订单 ${order.order_no} 吗？` }).then(async (res) => {
    if (!res.confirm)
      return
    try {
      await cancelOrder(order.id, '用户主动取消')
      Taro.showToast({ title: '已取消', icon: 'success' })
      onDone()
    }
    catch (err) {
      toast(err instanceof Error ? err.message : '取消失败')
    }
  })
}

/** 确认收货（Modal 确认）→ 成功后调用 onDone 刷新 */
export function handleConfirmOrder(order: Order, onDone: () => void) {
  Taro.showModal({ title: '确认收货', content: '确定已收到商品吗？' }).then(async (res) => {
    if (!res.confirm)
      return
    try {
      await confirmOrder(order.id)
      Taro.showToast({ title: '已确认收货', icon: 'success' })
      onDone()
    }
    catch (err) {
      toast(err instanceof Error ? err.message : '操作失败')
    }
  })
}
