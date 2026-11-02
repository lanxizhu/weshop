import type { AddressInput, CreateOrderInput, ProductInput, ProductStatus, ProfileInput, SkuInput } from '@weshop/shared'
import { MAX_CART_ITEM_QUANTITY, MAX_ORDER_REMARK_LENGTH, PHONE_REGEX } from '@weshop/shared'

export type ValidationResult =
  | { errors: string[]; value?: never }
  | { value: ProductInput; errors?: never }

/** 校验并规范化单个规格（SKU），label 用于错误信息定位 */
function validateSku(raw: unknown, label: string, errors: string[]): SkuInput {
  const r = (raw ?? {}) as Record<string, unknown>
  const id = r.id === undefined || r.id === null ? undefined : Number(r.id)
  const name = String(r.name ?? '').trim()
  const price = Number(r.price)
  const stock = Number.parseInt(String(r.stock), 10)
  const image = String(r.image ?? '').trim()

  if (id !== undefined && (!Number.isInteger(id) || id <= 0)) errors.push(`${label}ID 不合法`)
  if (!name) errors.push(`${label}名称不能为空`)
  else if (name.length > 30) errors.push(`${label}名称不能超过 30 字`)
  if (!Number.isFinite(price) || price < 0) errors.push(`${label}价格必须是不小于 0 的数字`)
  else if (price > 999999.99) errors.push(`${label}价格不能超过 999999.99`)
  if (!Number.isInteger(stock) || stock < 0) errors.push(`${label}库存必须是不小于 0 的整数`)
  else if (stock > 999999) errors.push(`${label}库存不能超过 999999`)
  if (image && !/^(https?:\/\/|\/uploads\/)/.test(image)) errors.push(`${label}图片地址必须是 http(s) 链接或 /uploads/ 路径`)

  return {
    ...(id !== undefined ? { id } : {}),
    name,
    price: Number.isFinite(price) ? Math.round(price * 100) / 100 : 0,
    stock: Number.isInteger(stock) ? stock : 0,
    image,
  }
}

/** 校验并规范化商品请求体（规格为价格/库存事实来源，商品级 price/stock 会被派生值覆盖） */
export function validateProduct(body: unknown): ValidationResult {
  const b = (body ?? {}) as Record<string, unknown>
  const errors: string[] = []

  const name = String(b.name ?? '').trim()
  const description = String(b.description ?? '').trim()
  const category = String(b.category ?? '').trim()
  const price = Number(b.price)
  const stock = Number.parseInt(String(b.stock), 10)
  const status = (b.status ?? 'on') as ProductStatus
  const images = Array.isArray(b.images)
    ? b.images.map((u) => String(u).trim()).filter(Boolean)
    : []
  const rawSkus = Array.isArray(b.skus) ? b.skus : []
  const skus = rawSkus.map((s, i) => validateSku(s, `规格 ${i + 1} `, errors))

  if (!name) errors.push('商品名称不能为空')
  if (name.length > 50) errors.push('商品名称不能超过 50 字')
  if (description.length > 500) errors.push('商品描述不能超过 500 字')
  if (!Number.isFinite(price) || price < 0) errors.push('价格必须是不小于 0 的数字')
  else if (price > 999999.99) errors.push('价格不能超过 999999.99')
  if (!Number.isInteger(stock) || stock < 0) errors.push('库存必须是不小于 0 的整数')
  else if (stock > 999999) errors.push('库存不能超过 999999')
  if (!['on', 'off'].includes(status)) errors.push('状态不合法')
  if (images.length > 10) errors.push('图片最多 10 张')
  if (images.some((u) => !/^(https?:\/\/|\/uploads\/)/.test(u))) errors.push('图片地址必须是 http(s) 链接或 /uploads/ 路径')
  if (rawSkus.length === 0) errors.push('至少需要 1 个规格')

  if (errors.length) return { errors }
  return { value: { name, description, category, price, stock, status, images, skus } }
}

export type StockDeltaResult =
  | { errors: string[]; value?: never }
  | { value: { delta: number }; errors?: never }

/** 校验库存调整请求体：delta 为 ±(1..999999) 的整数 */
export function validateStockDelta(body: unknown): StockDeltaResult {
  const delta = Number((body as Record<string, unknown> | null)?.delta)
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 999999) {
    return { errors: ['调整量必须是非零整数，且绝对值不超过 999999'] }
  }
  return { value: { delta } }
}

export type AddressValidationResult =
  | { errors: string[]; value?: never }
  | { value: AddressInput; errors?: never }

/** 校验并规范化收货地址请求体 */
export function validateAddress(body: unknown): AddressValidationResult {
  const b = (body ?? {}) as Record<string, unknown>
  const errors: string[] = []

  const receiver = String(b.receiver ?? '').trim()
  const phone = String(b.phone ?? '').trim()
  const province = String(b.province ?? '').trim()
  const city = String(b.city ?? '').trim()
  const district = String(b.district ?? '').trim()
  const detail = String(b.detail ?? '').trim()
  const is_default = b.is_default === true || b.is_default === 1

  if (!receiver) errors.push('收货人不能为空')
  else if (receiver.length > 20) errors.push('收货人不能超过 20 字')
  if (!phone) errors.push('手机号不能为空')
  else if (!PHONE_REGEX.test(phone)) errors.push('手机号格式不正确')
  if (province.length > 20) errors.push('省份不能超过 20 字')
  if (city.length > 20) errors.push('城市不能超过 20 字')
  if (district.length > 20) errors.push('区县不能超过 20 字')
  if (!detail) errors.push('详细地址不能为空')
  else if (detail.length > 120) errors.push('详细地址不能超过 120 字')

  if (errors.length) return { errors }
  return { value: { receiver, phone, province, city, district, detail, is_default } }
}

export type ProfileValidationResult =
  | { errors: string[]; value?: never }
  | { value: ProfileInput; errors?: never }

/** 校验资料更新请求体：昵称与头像至少传一个 */
export function validateProfile(body: unknown): ProfileValidationResult {
  const b = (body ?? {}) as Record<string, unknown>
  const errors: string[] = []

  const nick_name = b.nick_name === undefined ? undefined : String(b.nick_name).trim()
  const avatar_url = b.avatar_url === undefined ? undefined : String(b.avatar_url).trim()

  if (nick_name !== undefined && (!nick_name || nick_name.length > 24)) {
    errors.push('昵称不能为空且不能超过 24 字')
  }
  if (avatar_url !== undefined && avatar_url && !/^(https?:\/\/|\/uploads\/)/.test(avatar_url)) {
    errors.push('头像地址必须是 http(s) 链接或 /uploads/ 路径')
  }
  if (nick_name === undefined && avatar_url === undefined) errors.push('没有需要更新的字段')

  if (errors.length) return { errors }
  return { value: { nick_name, avatar_url } }
}

export type CartAddResult =
  | { errors: string[]; value?: never }
  | { value: { product_id: number; sku_id: number; quantity: number }; errors?: never }

/** 校验加购请求体：product_id / sku_id 正整数，quantity 1..MAX_CART_ITEM_QUANTITY */
export function validateCartAdd(body: unknown): CartAddResult {
  const b = (body ?? {}) as Record<string, unknown>
  const product_id = Number(b.product_id)
  const sku_id = Number(b.sku_id)
  const quantity = Number(b.quantity)
  const errors: string[] = []

  if (!Number.isInteger(product_id) || product_id <= 0) errors.push('商品 ID 不合法')
  if (!Number.isInteger(sku_id) || sku_id <= 0) errors.push('规格 ID 不合法')
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_CART_ITEM_QUANTITY) {
    errors.push(`数量必须是 1~${MAX_CART_ITEM_QUANTITY} 的整数`)
  }

  if (errors.length) return { errors }
  return { value: { product_id, sku_id, quantity } }
}

export type CartQuantityResult =
  | { errors: string[]; value?: never }
  | { value: { quantity: number }; errors?: never }

/** 校验购物车改量请求体 */
export function validateCartQuantity(body: unknown): CartQuantityResult {
  const quantity = Number(((body ?? {}) as Record<string, unknown>).quantity)
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_CART_ITEM_QUANTITY) {
    return { errors: [`数量必须是 1~${MAX_CART_ITEM_QUANTITY} 的整数`] }
  }
  return { value: { quantity } }
}

export type OrderCreateResult =
  | { errors: string[]; value?: never }
  | { value: CreateOrderInput; errors?: never }

/** 校验下单请求体：source 二选一（cart 选中项 / direct 立即购买），地址与备注 */
export function validateOrderCreate(body: unknown): OrderCreateResult {
  const b = (body ?? {}) as Record<string, unknown>
  const errors: string[] = []

  const address_id = Number(b.address_id)
  if (!Number.isInteger(address_id) || address_id <= 0) errors.push('收货地址不合法')

  const remark = String(b.remark ?? '').trim()
  if (remark.length > MAX_ORDER_REMARK_LENGTH) errors.push(`备注不能超过 ${MAX_ORDER_REMARK_LENGTH} 字`)

  const s = (b.source ?? {}) as Record<string, unknown>
  let source: CreateOrderInput['source'] | undefined
  if (s.type === 'cart') {
    const item_ids = Array.isArray(s.item_ids) ? s.item_ids.map(Number) : []
    if (!item_ids.length || item_ids.some((id) => !Number.isInteger(id) || id <= 0)) {
      errors.push('购物车选中项不合法')
    } else {
      source = { type: 'cart', item_ids: [...new Set(item_ids)] }
    }
  } else if (s.type === 'direct') {
    const product_id = Number(s.product_id)
    const sku_id = Number(s.sku_id)
    const quantity = Number(s.quantity)
    if (!Number.isInteger(product_id) || product_id <= 0) errors.push('商品 ID 不合法')
    if (!Number.isInteger(sku_id) || sku_id <= 0) errors.push('规格 ID 不合法')
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_CART_ITEM_QUANTITY) {
      errors.push(`数量必须是 1~${MAX_CART_ITEM_QUANTITY} 的整数`)
    }
    if (!errors.length) source = { type: 'direct', product_id, sku_id, quantity }
  } else {
    errors.push('下单来源不合法')
  }

  if (errors.length || !source) return { errors: errors.length ? errors : ['下单来源不合法'] }
  return { value: { source, address_id, remark } }
}

/** 校验新密码强度：至少 8 位且同时包含字母与数字，返回错误文案列表（空数组表示通过） */
export function validatePasswordStrength(password: string): string[] {
  const errors: string[] = []
  if (password.length < 8) errors.push('新密码长度不能少于 8 位')
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) errors.push('新密码必须同时包含字母和数字')
  return errors
}
