import type { User } from '@weshop/shared'
import { Button, Image, Input, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useState } from 'react'
import { Icon } from '@/components/icon'
import { assetUrl } from '@/services/api'
import { fetchMe, getCachedUser, login, logout, updateProfile } from '@/services/auth'
import { uploadFile } from '@/services/request'
import { setTabSelected, TAB_INDEX } from '@/services/tabbar'
import { toast } from '@/utils/toast'
import './index.scss'

export default function Mine() {
  const [user, setUser] = useState<User | null>(() => getCachedUser())
  const [busy, setBusy] = useState(false)

  // 每次进入刷新资料；未登录则展示登录态
  useDidShow(() => {
    setTabSelected(TAB_INDEX.mine)
    if (!getCachedUser()) {
      setUser(null)
      return
    }
    fetchMe()
      .then(setUser)
      .catch((err) => {
        // 令牌失效（401）时 request 已清除本地登录态，页面同步回到未登录视图，避免继续展示旧资料
        if (err instanceof Error && err.message === '请先登录')
          setUser(null)
      })
  })

  async function handleLogin() {
    setBusy(true)
    try {
      setUser(await login())
      Taro.showToast({ title: '登录成功', icon: 'success' })
    }
    catch (err) {
      toast(err, '登录失败')
    }
    finally {
      setBusy(false)
    }
  }

  /** 微信头像选择 → 上传到服务端 → 保存资料 */
  async function handleChooseAvatar(e: { detail: { avatarUrl: string } }) {
    const tempPath = e.detail.avatarUrl
    if (!tempPath)
      return
    Taro.showLoading({ title: '上传头像中', mask: true })
    try {
      const { url } = await uploadFile<{ url?: string }>('/uploads', tempPath)
      if (!url)
        throw new Error('头像上传失败')
      setUser(await updateProfile({ avatar_url: url }))
    }
    catch (err) {
      toast(err, '头像上传失败')
    }
    finally {
      Taro.hideLoading()
    }
  }

  async function handleNicknameBlur(e: { detail: { value: string } }) {
    const nick = e.detail.value.trim()
    if (!user || !nick || nick === user.nick_name)
      return
    try {
      setUser(await updateProfile({ nick_name: nick }))
      Taro.showToast({ title: '昵称已更新', icon: 'success' })
    }
    catch (err) {
      toast(err, '更新失败')
    }
  }

  function handleLogout() {
    Taro.showModal({ title: '退出登录', content: '确定要退出当前账号吗？' }).then((res) => {
      if (res.confirm) {
        logout()
        setUser(null)
      }
    })
  }

  function goAddresses() {
    if (!user) {
      toast('请先登录')
      return
    }
    Taro.navigateTo({ url: '/pages/address/list/index' })
  }

  function goOrders(status?: string) {
    if (!user) {
      toast('请先登录')
      return
    }
    const query = status ? `?status=${status}` : ''
    Taro.navigateTo({ url: `/pages/order/list/index${query}` })
  }

  return (
    <View className="mine-page">
      <View className="mine__profile">
        {user
          ? (
              <>
                <Button className="mine__avatar-btn" openType="chooseAvatar" onChooseAvatar={handleChooseAvatar}>
                  {user.avatar_url
                    ? (
                        <Image className="mine__avatar" src={assetUrl(user.avatar_url)} mode="aspectFill" />
                      )
                    : (
                        <View className="mine__avatar mine__avatar--placeholder">换头像</View>
                      )}
                </Button>
                <View className="mine__info">
                  <Input
                    className="mine__nickname"
                    type="nickname"
                    value={user.nick_name}
                    placeholder="点击设置昵称"
                    onBlur={handleNicknameBlur}
                  />
                  <Text className="mine__hint">点击头像或昵称可修改资料</Text>
                </View>
              </>
            )
          : (
              <>
                <View className="mine__avatar mine__avatar--placeholder">未登录</View>
                <Button className="mine__login-btn" loading={busy} onClick={handleLogin}>
                  微信一键登录
                </Button>
              </>
            )}
      </View>

      <View className="mine__menu">
        <View className="mine__menu-item" onClick={() => goOrders()}>
          <View className="mine__menu-label">
            <Icon name="clipboard-list" size={20} color="#5b6b8c" />
            <Text>我的订单</Text>
          </View>
          <Icon name="chevron-right" size={16} color="#b0b7c3" />
        </View>
        <View className="mine__order-quick">
          <View className="mine__order-quick-item" onClick={() => goOrders('pending')}>
            <Icon name="wallet" size={22} color="#5b6b8c" />
            <Text>待付款</Text>
          </View>
          <View className="mine__order-quick-item" onClick={() => goOrders('paid')}>
            <Icon name="package" size={22} color="#5b6b8c" />
            <Text>待发货</Text>
          </View>
          <View className="mine__order-quick-item" onClick={() => goOrders('shipped')}>
            <Icon name="truck" size={22} color="#5b6b8c" />
            <Text>待收货</Text>
          </View>
        </View>
        <View className="mine__menu-item" onClick={goAddresses}>
          <View className="mine__menu-label">
            <Icon name="map-pin" size={20} color="#5b6b8c" />
            <Text>收货地址</Text>
          </View>
          <Icon name="chevron-right" size={16} color="#b0b7c3" />
        </View>
      </View>

      {user && (
        <View className="mine__logout" onClick={handleLogout}>
          退出登录
        </View>
      )}
    </View>
  )
}
