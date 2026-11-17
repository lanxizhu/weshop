import type { Address, Product } from '@weshop/shared'
import { Image, ScrollView, Text, Textarea, View } from '@tarojs/components'
import Taro, { useRouter } from '@tarojs/taro'
import { MAX_ORDER_REMARK_LENGTH } from '@weshop/shared'
import { useEffect, useState } from 'react'
import { fmtPrice } from '@/components/product-card'
import { fetchAddresses } from '@/services/address'
import { assetUrl, fetchProduct } from '@/services/api'
import { fetchCart, syncCartBadge } from '@/services/cart'
import { createOrder } from '@/services/order'
import { toast } from '@/utils/toast'
import './index.scss'

/** 确认订单页统一展示用的结算行 */
interface CheckoutLine {
  product_id: number
  sku_id: number
  sku_name: string
  name: string
  image: string
  price: number
  quantity: number
}

export default function Checkout() {
  const { params } = useRouter()
  const [lines, setLines] = useState<CheckoutLine[]>([])
  const [address, setAddress] = useState<Address | null>(null)
  const [remark, setRemark] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [remainingCartQuantity, setRemainingCartQuantity] = useState(0)

  const cartItemIds = (params.items ?? '').split(',').map(Number).filter(n => Number.isInteger(n) && n > 0)
  const directProductId = Number(params.product_id)
  const directSkuId = Number(params.sku_id)
  const directQuantity = Math.max(1, Number(params.quantity) || 1)
  const isDirect = Number.isInteger(directProductId) && directProductId > 0

  useEffect(() => {
    init()
    // eslint-disable-next-line react/exhaustive-deps
  }, [])

  async function init() {
    setLoading(true)
    setError('')
    try {
      await Promise.all([loadLines(), loadAddress()])
    }
    catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    }
    finally {
      setLoading(false)
    }
  }

  async function loadLines() {
    if (cartItemIds.length > 0) {
      const res = await fetchCart()
      const selected = res.items.filter(item => cartItemIds.includes(item.id))
      if (selected.length === 0)
        throw new Error('结算商品不存在，请返回购物车重新选择')
      const selectedQuantity = selected.reduce((sum, item) => sum + item.quantity, 0)
      setRemainingCartQuantity(Math.max(0, res.total_quantity - selectedQuantity))
      setLines(selected.map(item => ({
        product_id: item.product_id,
        sku_id: item.sku_id,
        sku_name: item.sku_name,
        name: item.name,
        image: item.image,
        price: item.price,
        quantity: item.quantity,
      })))
      return
    }
    if (isDirect) {
      if (!Number.isInteger(directSkuId) || directSkuId <= 0) {
        toast('缺少规格参数')
        Taro.navigateBack()
        return
      }
      const res = await fetchProduct(directProductId)
      const p: Product = res.product
      const sku = p.skus.find(s => s.id === directSkuId)
      if (!sku)
        throw new Error('商品规格不存在，请重新选择')
      setLines([{
        product_id: p.id,
        sku_id: sku.id,
        sku_name: sku.name,
        name: p.name,
        image: sku.image || p.images?.[0] || '',
        price: sku.price,
        quantity: directQuantity,
      }])
      return
    }
    throw new Error('缺少结算商品参数')
  }

  async function loadAddress() {
    const res = await fetchAddresses()
    if (res.addresses.length === 0)
      return
    setAddress(prev => prev ?? res.addresses.find(a => a.is_default === 1) ?? res.addresses[0])
  }

  /** 跳地址列表（选择模式），选好后通过 eventChannel 回填 */
  function chooseAddress() {
    Taro.navigateTo({
      url: '/pages/address/list/index?select=1',
      events: {
        selectAddress: (addr: Address) => setAddress(addr),
      },
    })
  }

  const totalAmount = lines.reduce((sum, line) => sum + line.price * line.quantity, 0)
  const totalQuantity = lines.reduce((sum, line) => sum + line.quantity, 0)

  async function handleSubmit() {
    if (submitting)
      return
    if (!address) {
      toast('请先添加收货地址')
      return
    }
    const source = isDirect && cartItemIds.length === 0
      ? { type: 'direct' as const, product_id: directProductId, sku_id: directSkuId, quantity: directQuantity }
      : { type: 'cart' as const, item_ids: cartItemIds }
    setSubmitting(true)
    try {
      const trimmed = remark.trim()
      const { order } = await createOrder({
        source,
        address_id: address.id,
        ...(trimmed ? { remark: trimmed.slice(0, MAX_ORDER_REMARK_LENGTH) } : {}),
      })
      if (source.type === 'cart')
        syncCartBadge(remainingCartQuantity)
      Taro.redirectTo({ url: `/pages/cashier/index?id=${order.id}` })
    }
    catch (err) {
      toast(err, '下单失败')
      setSubmitting(false)
    }
  }

  if (loading)
    return <View className="checkout-state">加载中…</View>
  if (error)
    return <View className="checkout-state">{error}</View>

  return (
    <View className="checkout-page">
      <ScrollView className="checkout-body" scrollY>
        <View className="checkout-addr" onClick={address ? chooseAddress : () => Taro.navigateTo({ url: '/pages/address/edit/index' })}>
          {address
            ? (
                <View className="checkout-addr__main">
                  <View className="checkout-addr__head">
                    <Text className="checkout-addr__receiver">{address.receiver}</Text>
                    <Text className="checkout-addr__phone">{address.phone}</Text>
                  </View>
                  <Text className="checkout-addr__detail">
                    {address.province}
                    {' '}
                    {address.city}
                    {' '}
                    {address.district}
                    {' '}
                    {address.detail}
                  </Text>
                </View>
              )
            : (
                <Text className="checkout-addr__empty">+ 去添加收货地址</Text>
              )}
          <Text className="checkout-addr__arrow">›</Text>
        </View>

        <View className="checkout-goods">
          {lines.map(line => (
            <View key={`${line.product_id}-${line.sku_id}`} className="checkout-goods__item">
              {line.image
                ? (
                    <Image className="checkout-goods__cover" src={assetUrl(line.image)} mode="aspectFill" lazyLoad />
                  )
                : (
                    <View className="checkout-goods__cover image-placeholder">暂无图片</View>
                  )}
              <View className="checkout-goods__main">
                <Text className="checkout-goods__name">{line.name}</Text>
                {line.sku_name && (
                  <Text className="checkout-goods__sku">{line.sku_name}</Text>
                )}
                <View className="checkout-goods__row">
                  <Text className="checkout-goods__price">{fmtPrice(line.price)}</Text>
                  <Text className="checkout-goods__quantity">
                    ×
                    {line.quantity}
                  </Text>
                </View>
              </View>
            </View>
          ))}
        </View>

        <View className="checkout-remark">
          <Text className="checkout-remark__label">订单备注</Text>
          <Textarea
            className="checkout-remark__input"
            placeholder={`选填，最多 ${MAX_ORDER_REMARK_LENGTH} 字`}
            maxlength={MAX_ORDER_REMARK_LENGTH}
            value={remark}
            onInput={e => setRemark(e.detail.value)}
          />
        </View>
      </ScrollView>

      <View className="checkout-page__footer">
        <View className="checkout-page__total">
          共
          {totalQuantity}
          件，合计：
          <Text className="checkout-page__total-amount">{fmtPrice(totalAmount)}</Text>
        </View>
        <View className={`checkout-page__submit-btn ${submitting ? 'is-disabled' : ''}`} onClick={handleSubmit}>
          {submitting ? '提交中…' : '提交订单'}
        </View>
      </View>
    </View>
  )
}
