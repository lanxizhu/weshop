import type { AddressInput } from '@weshop/shared'
import { Button, Input, Picker, Switch, Text, Textarea, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { PHONE_REGEX } from '@weshop/shared'
import { useEffect, useRef, useState } from 'react'
import { createAddress, fetchAddresses, updateAddress } from '@/services/address'
import './index.scss'

function toast(message: string) {
  Taro.showToast({ title: message, icon: 'none' })
}

export default function AddressEdit() {
  // 无 id 为新增，有 id 为编辑
  const [id] = useState<number | null>(() => {
    const raw = Taro.getCurrentInstance().router?.params?.id
    return raw ? Number(raw) : null
  })
  const [receiver, setReceiver] = useState('')
  const [phone, setPhone] = useState('')
  const [region, setRegion] = useState<string[]>([])
  const [detail, setDetail] = useState('')
  const [isDefault, setIsDefault] = useState(false)
  const [saving, setSaving] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  // 卸载时清理未触发的定时器
  useEffect(() => () => clearTimeout(timerRef.current), [])

  useEffect(() => {
    Taro.setNavigationBarTitle({ title: id ? '编辑地址' : '新增地址' })
    if (id === null)
      return
    fetchAddresses()
      .then(({ addresses }) => {
        const addr = addresses.find(a => a.id === id)
        if (!addr) {
          toast('地址不存在')
          timerRef.current = setTimeout(() => Taro.navigateBack(), 800)
          return
        }
        setReceiver(addr.receiver)
        setPhone(addr.phone)
        setRegion([addr.province, addr.city, addr.district].filter(Boolean))
        setDetail(addr.detail)
        setIsDefault(addr.is_default === 1)
      })
      .catch(err => toast(err instanceof Error ? err.message : '加载失败'))
  }, [id])

  async function handleSubmit() {
    const input: AddressInput = {
      receiver: receiver.trim(),
      phone: phone.trim(),
      province: region[0] ?? '',
      city: region[1] ?? '',
      district: region[2] ?? '',
      detail: detail.trim(),
      is_default: isDefault,
    }
    if (!input.receiver)
      return toast('请输入收货人')
    if (!PHONE_REGEX.test(input.phone))
      return toast('请输入正确的手机号')
    if (!input.province)
      return toast('请选择所在地区')
    if (!input.detail)
      return toast('请输入详细地址')

    setSaving(true)
    try {
      if (id === null)
        await createAddress(input)
      else await updateAddress(id, input)
      Taro.showToast({ title: '已保存', icon: 'success' })
      timerRef.current = setTimeout(() => Taro.navigateBack(), 600)
    }
    catch (err) {
      toast(err instanceof Error ? err.message : '保存失败')
    }
    finally {
      setSaving(false)
    }
  }

  return (
    <View className="edit-page">
      <View className="edit-form">
        <View className="edit-form__row">
          <Text className="edit-form__label">收货人</Text>
          <Input
            className="edit-form__input"
            placeholder="姓名"
            value={receiver}
            maxlength={20}
            onInput={e => setReceiver(e.detail.value)}
          />
        </View>
        <View className="edit-form__row">
          <Text className="edit-form__label">手机号</Text>
          <Input
            className="edit-form__input"
            type="number"
            placeholder="11 位手机号"
            value={phone}
            maxlength={11}
            onInput={e => setPhone(e.detail.value)}
          />
        </View>
        <Picker mode="region" value={region} onChange={e => setRegion(e.detail.value as string[])}>
          <View className="edit-form__row">
            <Text className="edit-form__label">所在地区</Text>
            <Text className={`edit-form__picker ${region.length ? '' : 'is-placeholder'}`}>
              {region.length ? region.join(' ') : '请选择省 / 市 / 区'}
            </Text>
          </View>
        </Picker>
        <View className="edit-form__row edit-form__row--top">
          <Text className="edit-form__label">详细地址</Text>
          <Textarea
            className="edit-form__textarea"
            placeholder="小区、楼栋、门牌号等"
            value={detail}
            maxlength={120}
            onInput={e => setDetail(e.detail.value)}
          />
        </View>
        <View className="edit-form__row">
          <Text className="edit-form__label">设为默认地址</Text>
          <Switch checked={isDefault} onChange={e => setIsDefault(e.detail.value)} />
        </View>
      </View>

      <Button className="edit-page__submit" loading={saving} onClick={handleSubmit}>
        保存
      </Button>
    </View>
  )
}
