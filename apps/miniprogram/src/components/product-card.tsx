import type { Product } from '@weshop/shared'
import { Image, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { LOW_STOCK_THRESHOLD } from '@weshop/shared'
import { assetUrl } from '@/services/api'
import './product-card.scss'

export const fmtPrice = (n: number) => `¥${n.toFixed(2)}`

export function StockBadge({ stock }: { stock: number }) {
  if (stock === 0)
    return <Text className="badge badge--danger">缺货</Text>
  if (stock < LOW_STOCK_THRESHOLD)
    return <Text className="badge badge--warn">不足</Text>
  return null
}

export function goDetail(id: number) {
  Taro.navigateTo({ url: `/pages/detail/index?id=${id}` })
}

export function ProductCard({ product }: { product: Product }) {
  const cover = product.images?.[0]
  return (
    <View className="product-card" onClick={() => goDetail(product.id)}>
      {cover
        ? (
            <Image className="product-card__cover" src={assetUrl(cover)} mode="aspectFill" lazyLoad />
          )
        : (
            <View className="product-card__cover image-placeholder">暂无图片</View>
          )}
      <View className="product-card__body">
        <Text className="product-card__name">{product.name}</Text>
        <View className="product-card__meta">
          <Text className="product-card__price">{fmtPrice(product.price)}</Text>
          <StockBadge stock={product.stock} />
        </View>
      </View>
    </View>
  )
}
