import type { Product, Sku } from '@weshop/shared'
import { Image, Text, View } from '@tarojs/components'
import { MAX_CART_ITEM_QUANTITY } from '@weshop/shared'
import { useState } from 'react'
import { fmtPrice } from '@/components/product-card'
import { assetUrl } from '@/services/api'
import './sku-panel.scss'

export type SkuPanelMode = 'cart' | 'buy'

interface SkuPanelProps {
  visible: boolean
  product: Product | null
  mode: SkuPanelMode
  onClose: () => void
  onConfirm: (sku: Sku, quantity: number) => void
}

/** 半屏规格选择弹层：加购 / 立即购买共用，选中态与数量由组件内部管理 */
export function SkuPanel({ visible, product, mode, onClose, onConfirm }: SkuPanelProps) {
  const [selectedSkuId, setSelectedSkuId] = useState<number | null>(null)
  const [quantity, setQuantity] = useState(1)

  const skus = product?.skus ?? []

  /** 每次打开重置选中态（render 期间按 openKey 调整）：单规格默认选中，数量回到 1；关闭动画期间保留选中态 */
  const [prevOpenKey, setPrevOpenKey] = useState<string | null>(null)
  const openKey = visible && product ? String(product.id) : null
  if (openKey !== prevOpenKey) {
    setPrevOpenKey(openKey)
    if (openKey && product) {
      setSelectedSkuId(product.skus.length === 1 ? product.skus[0].id : null)
      setQuantity(1)
    }
  }

  const selectedSku = skus.find(sku => sku.id === selectedSkuId) ?? null

  const prices = skus.map(sku => sku.price)
  const minPrice = prices.length > 0 ? Math.min(...prices) : 0
  const maxPrice = prices.length > 0 ? Math.max(...prices) : 0
  const priceText = selectedSku
    ? fmtPrice(selectedSku.price)
    : minPrice === maxPrice
      ? fmtPrice(minPrice)
      : `¥${minPrice.toFixed(2)}~¥${maxPrice.toFixed(2)}`

  const stockText = selectedSku
    ? (selectedSku.stock > 0 ? `库存 ${selectedSku.stock} 件` : '缺货')
    : (product ? `库存 ${product.stock} 件` : '')

  const coverImage = selectedSku?.image || product?.images?.[0] || ''

  /** 数量上限：1..min(99, sku.stock)；未选规格时为 0（stepper 禁用） */
  const maxQuantity = selectedSku ? Math.min(MAX_CART_ITEM_QUANTITY, selectedSku.stock) : 0
  const canConfirm = !!selectedSku && selectedSku.stock > 0 && quantity >= 1 && quantity <= maxQuantity

  function handleSelect(sku: Sku) {
    if (sku.stock === 0)
      return
    setSelectedSkuId(sku.id)
    setQuantity(prev => Math.min(Math.max(1, prev), Math.min(MAX_CART_ITEM_QUANTITY, sku.stock)))
  }

  function handleQuantity(delta: 1 | -1) {
    if (!selectedSku || maxQuantity < 1)
      return
    setQuantity(prev => Math.min(Math.max(1, prev + delta), maxQuantity))
  }

  return (
    <>
      <View className={`sku-panel-mask ${visible ? 'is-visible' : ''}`} onClick={onClose} />
      <View className={`sku-panel ${visible ? 'is-visible' : ''}`}>
        {product && (
          <>
            <View className="sku-panel__header">
              {coverImage
                ? (
                    <Image className="sku-panel__cover" src={assetUrl(coverImage)} mode="aspectFill" />
                  )
                : (
                    <View className="sku-panel__cover image-placeholder">暂无图片</View>
                  )}
              <View className="sku-panel__header-main">
                <Text className="sku-panel__price">{priceText}</Text>
                <Text className="sku-panel__stock">{stockText}</Text>
                <Text className="sku-panel__selected">
                  {selectedSku ? `已选：${selectedSku.name}` : '请选择规格'}
                </Text>
              </View>
              <Text className="sku-panel__close" onClick={onClose}>✕</Text>
            </View>

            <View className="sku-panel__section">
              <Text className="sku-panel__section-title">规格</Text>
              <View className="sku-panel__options">
                {skus.map(sku => (
                  <View
                    key={sku.id}
                    className={`sku-panel__option ${selectedSkuId === sku.id ? 'is-active' : ''} ${sku.stock === 0 ? 'is-disabled' : ''}`}
                    onClick={() => handleSelect(sku)}
                  >
                    {sku.name}
                  </View>
                ))}
              </View>
            </View>

            <View className="sku-panel__quantity-row">
              <Text className="sku-panel__section-title">数量</Text>
              <View className="sku-panel__stepper">
                <View
                  className={`sku-panel__step-btn ${!selectedSku || quantity <= 1 ? 'is-disabled' : ''}`}
                  onClick={() => handleQuantity(-1)}
                >
                  -
                </View>
                <Text className="sku-panel__quantity">{quantity}</Text>
                <View
                  className={`sku-panel__step-btn ${!selectedSku || quantity >= maxQuantity ? 'is-disabled' : ''}`}
                  onClick={() => handleQuantity(1)}
                >
                  +
                </View>
              </View>
            </View>

            <View
              className={`sku-panel__confirm ${canConfirm ? '' : 'is-disabled'}`}
              onClick={canConfirm && selectedSku ? () => onConfirm(selectedSku, quantity) : undefined}
            >
              {mode === 'cart' ? '加入购物车' : '立即购买'}
            </View>
          </>
        )}
      </View>
    </>
  )
}
