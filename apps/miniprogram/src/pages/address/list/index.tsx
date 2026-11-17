import type { Address } from '@weshop/shared'
import { ScrollView, Text, View } from '@tarojs/components'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import { deleteAddress, fetchAddresses, setDefaultAddress } from '@/services/address'
import { toast } from '@/utils/toast'
import './index.scss'

export default function AddressList() {
  const { params } = useRouter()
  // select=1 时为选择模式（确认订单页选地址）：点击卡片回传地址并返回
  const selectMode = params.select === '1'
  const [addresses, setAddresses] = useState<Address[]>([])
  const [loading, setLoading] = useState(true)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  // 卸载时清理未触发的定时器
  useEffect(() => () => clearTimeout(timerRef.current), [])

  useDidShow(() => {
    load()
  })

  async function load() {
    setLoading(true)
    try {
      const res = await fetchAddresses()
      setAddresses(res.addresses)
    }
    catch (err) {
      toast(err, '加载失败')
      // 未登录 / 令牌失效：回「我的」页重新登录
      if (err instanceof Error && err.message === '请先登录') {
        timerRef.current = setTimeout(() => Taro.switchTab({ url: '/pages/mine/index' }), 800)
      }
    }
    finally {
      setLoading(false)
    }
  }

  async function handleSetDefault(addr: Address) {
    if (addr.is_default === 1)
      return
    try {
      await setDefaultAddress(addr.id)
      load()
    }
    catch (err) {
      toast(err, '设置失败')
    }
  }

  /** 选择模式下点击卡片：通过 eventChannel 回传地址并返回上一页 */
  function handleCardClick(addr: Address) {
    if (selectMode) {
      const channel = Taro.getCurrentInstance().page?.getOpenerEventChannel?.()
      channel?.emit('selectAddress', addr)
      Taro.navigateBack()
      return
    }
    handleSetDefault(addr)
  }

  function handleEdit(addr: Address) {
    Taro.navigateTo({ url: `/pages/address/edit/index?id=${addr.id}` })
  }

  function handleDelete(addr: Address) {
    Taro.showModal({ title: '删除地址', content: `确定删除「${addr.receiver}」的地址吗？` }).then(async (res) => {
      if (!res.confirm)
        return
      try {
        await deleteAddress(addr.id)
        Taro.showToast({ title: '已删除', icon: 'success' })
        load()
      }
      catch (err) {
        toast(err, '删除失败')
      }
    })
  }

  return (
    <View className="address-page">
      <ScrollView className="address-list" scrollY>
        {addresses.map(addr => (
          <View key={addr.id} className="address-card" onClick={() => handleCardClick(addr)}>
            <View className="address-card__main">
              <View className="address-card__head">
                <Text className="address-card__receiver">{addr.receiver}</Text>
                <Text className="address-card__phone">{addr.phone}</Text>
                {addr.is_default === 1 && <Text className="address-card__badge">默认</Text>}
              </View>
              <Text className="address-card__region">
                {addr.province}
                {' '}
                {addr.city}
                {' '}
                {addr.district}
              </Text>
              <Text className="address-card__detail">{addr.detail}</Text>
            </View>
            <View className="address-card__actions">
              <Text
                className="address-card__action"
                onClick={(e) => {
                  e.stopPropagation()
                  handleEdit(addr)
                }}
              >
                编辑
              </Text>
              <Text
                className="address-card__action address-card__action--danger"
                onClick={(e) => {
                  e.stopPropagation()
                  handleDelete(addr)
                }}
              >
                删除
              </Text>
            </View>
          </View>
        ))}

        {!loading && addresses.length === 0 && (
          <View className="address-page__empty">还没有收货地址，点击下方按钮添加</View>
        )}
        {loading && <View className="address-page__empty">加载中…</View>}
      </ScrollView>

      <View className="address-page__footer">
        <View
          className="address-page__add-btn"
          onClick={() => Taro.navigateTo({ url: '/pages/address/edit/index' })}
        >
          + 新增地址
        </View>
      </View>
    </View>
  )
}
