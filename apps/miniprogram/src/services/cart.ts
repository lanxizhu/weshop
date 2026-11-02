import type { CartListResult } from '@weshop/shared'
import { request } from './request'
import { setCartBadge } from './tabbar'

/** 同步购物车 tab 角标；任何改动购物车的页面在拿到最新购物车后都应调用 */
export function syncCartBadge(totalQuantity: number) {
  setCartBadge(totalQuantity)
}

export function fetchCart(): Promise<CartListResult> {
  return request<CartListResult>('/cart')
}

/** 加入购物车（需指定规格）；成功返回加入后的完整购物车 */
export function addToCart(productId: number, quantity: number, skuId: number): Promise<CartListResult> {
  return request<CartListResult>('/cart', { method: 'POST', data: { product_id: productId, sku_id: skuId, quantity } })
}

/** 修改数量（1..99）；成功返回修改后的完整购物车 */
export function updateCartQuantity(id: number, quantity: number): Promise<CartListResult> {
  return request<CartListResult>(`/cart/${id}`, { method: 'PUT', data: { quantity } })
}

export function removeCartItem(id: number): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/cart/${id}`, { method: 'DELETE' })
}
