import type { Product, Sku } from '@weshop/shared'
import type { SkuPanelMode } from '@/components/sku-panel'
import { Image, Swiper, SwiperItem, Text, View } from '@tarojs/components'
import Taro, { useRouter, useShareAppMessage } from '@tarojs/taro'
import { useEffect, useState } from 'react'
import { fmtPrice, StockBadge } from '@/components/product-card'
import { SkuPanel } from '@/components/sku-panel'
import { assetUrl, fetchProduct } from '@/services/api'
import { ensureLogin } from '@/services/auth'
import { addToCart, syncCartBadge } from '@/services/cart'
import './index.scss'

export default function Detail() {
  const { params } = useRouter()
  const id = Number(params.id)
  const [product, setProduct] = useState<Product | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!Number.isInteger(id) || id <= 0) {
      setError('商品不存在')
      setLoading(false)
      return
    }
    fetchProduct(id)
      .then(res => setProduct(res.product))
      .catch(err => setError(err instanceof Error ? err.message : '加载失败'))
      .finally(() => setLoading(false))
  }, [id])

  useShareAppMessage(() => ({
    title: product?.name ?? 'weshop',
    path: `/pages/detail/index?id=${id}`,
  }))

  const [adding, setAdding] = useState(false)
  const [panelMode, setPanelMode] = useState<SkuPanelMode | null>(null)

  /** 点击加购/立即购买先确保登录，再打开规格弹层 */
  async function openSkuPanel(mode: SkuPanelMode) {
    try {
      await ensureLogin()
      setPanelMode(mode)
    }
    catch (err) {
      Taro.showToast({ title: err instanceof Error ? err.message : '请先登录', icon: 'none' })
    }
  }

  function handleAddToCart() {
    openSkuPanel('cart')
  }

  function handleBuyNow() {
    openSkuPanel('buy')
  }

  async function handlePanelConfirm(sku: Sku, quantity: number) {
    if (!product || !panelMode)
      return
    if (panelMode === 'buy') {
      setPanelMode(null)
      Taro.navigateTo({ url: `/pages/checkout/index?product_id=${product.id}&sku_id=${sku.id}&quantity=${quantity}` })
      return
    }
    if (adding)
      return
    setAdding(true)
    try {
      const res = await addToCart(product.id, quantity, sku.id)
      syncCartBadge(res.total_quantity)
      Taro.showToast({ title: '已加入购物车', icon: 'success' })
      setPanelMode(null)
    }
    catch (err) {
      Taro.showToast({ title: err instanceof Error ? err.message : '加入失败', icon: 'none' })
    }
    finally {
      setAdding(false)
    }
  }

  if (loading)
    return <View className="detail-state">加载中…</View>
  if (error || !product)
    return <View className="detail-state">{error || '商品不存在'}</View>

  const off = product.status === 'off'
  const unavailable = off || product.stock === 0

  /** 多规格存在价差时价格区显示「¥最低价 起」，否则显示单价 */
  const skuPrices = product.skus.map(sku => sku.price)
  const hasPriceRange = skuPrices.length > 1 && Math.max(...skuPrices) > Math.min(...skuPrices)

  return (
    <View className={`detail ${off ? 'is-off' : ''}`}>
      {product.images.length > 0
        ? (
            <Swiper className="detail__swiper" indicatorDots indicatorActiveColor="#18181b" circular>
              {product.images.map(img => (
                <SwiperItem key={img}>
                  <Image className="detail__image" src={assetUrl(img)} mode="aspectFill" />
                </SwiperItem>
              ))}
            </Swiper>
          )
        : (
            <View className="detail__swiper image-placeholder">暂无图片</View>
          )}

      <View className="detail__body">
        <View className="detail__price-row">
          <Text className="detail__price">{hasPriceRange ? `${fmtPrice(product.price)} 起` : fmtPrice(product.price)}</Text>
          {off ? <Text className="badge badge--danger">已下架</Text> : <StockBadge stock={product.stock} />}
        </View>
        <Text className="detail__name">{product.name}</Text>
        <View className="detail__meta">
          <Text className="detail__meta-item">
            分类：
            {product.category || '未分类'}
          </Text>
          <Text className="detail__meta-item">
            库存：
            {product.stock}
          </Text>
        </View>
      </View>

      {product.description && (
        <View className="detail__section">
          <Text className="detail__section-title">商品描述</Text>
          <Text className="detail__desc">{product.description}</Text>
        </View>
      )}

      <View className="detail__footer">
        <View
          className={`detail__action detail__action--cart ${unavailable || adding ? 'is-disabled' : ''}`}
          onClick={unavailable ? undefined : handleAddToCart}
        >
          加入购物车
        </View>
        <View
          className={`detail__action detail__action--buy ${unavailable ? 'is-disabled' : ''}`}
          onClick={unavailable ? undefined : handleBuyNow}
        >
          {unavailable ? (off ? '已下架' : '暂时缺货') : '立即购买'}
        </View>
      </View>

      <SkuPanel
        visible={panelMode !== null}
        product={product}
        mode={panelMode ?? 'cart'}
        onClose={() => setPanelMode(null)}
        onConfirm={handlePanelConfirm}
      />
    </View>
  )
}
