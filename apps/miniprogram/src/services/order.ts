import type { CreateOrderInput, Order, OrderListParams, OrderListResult, OrderStatus } from '@weshop/shared'
import { request } from './request'

export function createOrder(input: CreateOrderInput): Promise<{ order: Order }> {
  const data: Record<string, unknown> = { source: input.source, address_id: input.address_id }
  if (input.remark)
    data.remark = input.remark
  return request<{ order: Order }>('/orders', { method: 'POST', data })
}

export function fetchOrders(params: OrderListParams = {}): Promise<OrderListResult> {
  const data: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '')
      data[k] = v
  }
  return request<OrderListResult>('/orders', { data })
}

export function fetchOrder(id: number): Promise<{ order: Order }> {
  return request<{ order: Order }>(`/orders/${id}`)
}

/** 模拟支付：pending → paid（幂等） */
export function payOrder(id: number): Promise<{ order: Order }> {
  return request<{ order: Order }>(`/orders/${id}/pay`, { method: 'POST', data: {} })
}

/** 取消订单（仅 pending），可选原因 */
export function cancelOrder(id: number, reason?: string): Promise<{ order: Order }> {
  return request<{ order: Order }>(`/orders/${id}/cancel`, { method: 'POST', data: reason ? { reason } : {} })
}

/** 确认收货：shipped → completed */
export function confirmOrder(id: number): Promise<{ order: Order }> {
  return request<{ order: Order }>(`/orders/${id}/confirm`, { method: 'POST', data: {} })
}

export const ORDER_STATUS_TEXT: Record<OrderStatus, string> = {
  pending: '待支付',
  paid: '待发货',
  shipped: '待收货',
  completed: '已完成',
  cancelled: '已取消',
}
