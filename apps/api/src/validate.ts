import { z } from 'zod'
import type {
  AddressInput,
  CartAddInput,
  CartQuantityInput,
  CreateOrderInput,
  ProductInput,
  ProfileInput,
  StockAdjustInput,
} from '@weshop/shared'
import { MAX_CART_ITEM_QUANTITY, MAX_ORDER_REMARK_LENGTH, PHONE_REGEX } from '@weshop/shared'

export type ValidationResult<T = ProductInput> =
  | { errors: string[]; value?: never }
  | { value: T; errors?: never }

const IMAGE_URL_REGEX = /^(https?:\/\/|\/uploads\/)/
const IMAGE_URL_ERROR = '图片地址必须是 http(s) 链接或 /uploads/ 路径'

function bodyObject<Shape extends z.ZodRawShape>(shape: Shape) {
  return z.object(shape, { error: '请求体必须是对象' })
}

/** 仅转换非空数字字符串，避免 z.coerce.number() 把 null、空字符串和布尔值静默变成 0/1 */
function numeric<Schema extends z.ZodType<number>>(schema: Schema) {
  return z.preprocess(
    value => typeof value === 'string' && value.trim() !== '' ? Number(value) : value,
    schema
  )
}

function positiveId(message: string) {
  return numeric(z.number({ error: message }).int(message).positive(message))
}

function parseWithSchema<Schema extends z.ZodType>(
  schema: Schema,
  body: unknown
): ValidationResult<z.output<Schema>> {
  const result = schema.safeParse(body ?? {})
  if (result.success) return { value: result.data }

  const errors = result.error.issues.map((issue) => {
    const [field, index] = issue.path
    return field === 'skus' && typeof index === 'number'
      ? `规格 ${index + 1} ${issue.message}`
      : issue.message
  })
  return { errors: [...new Set(errors)] }
}

const priceSchema = numeric(
  z.number({ error: '价格必须是不小于 0 的数字' })
    .min(0, '价格必须是不小于 0 的数字')
    .max(999999.99, '价格不能超过 999999.99')
)

const stockSchema = numeric(
  z.number({ error: '库存必须是不小于 0 的整数' })
    .int('库存必须是不小于 0 的整数')
    .min(0, '库存必须是不小于 0 的整数')
    .max(999999, '库存不能超过 999999')
)

const imageSchema = z.string({ error: IMAGE_URL_ERROR })
  .trim()
  .refine(value => value === '' || IMAGE_URL_REGEX.test(value), IMAGE_URL_ERROR)

const skuSchema = bodyObject({
  id: z.preprocess(value => value ?? undefined, positiveId('ID 不合法').optional()),
  name: z.preprocess(
    value => value ?? '',
    z.string({ error: '名称不能为空' }).trim().min(1, '名称不能为空').max(30, '名称不能超过 30 字')
  ),
  price: priceSchema.transform(value => Math.round(value * 100) / 100),
  stock: stockSchema,
  image: z.preprocess(value => value ?? '', imageSchema),
})

const productSchema = bodyObject({
  name: z.preprocess(
    value => value ?? '',
    z.string({ error: '商品名称不能为空' }).trim().min(1, '商品名称不能为空').max(50, '商品名称不能超过 50 字')
  ),
  description: z.preprocess(
    value => value ?? '',
    z.string({ error: '商品描述必须是字符串' }).trim().max(500, '商品描述不能超过 500 字')
  ),
  category: z.preprocess(value => value ?? '', z.string({ error: '商品分类必须是字符串' }).trim()),
  price: priceSchema,
  stock: stockSchema,
  status: z.enum(['on', 'off'], { error: '状态不合法' }).default('on'),
  images: z.preprocess(
    value => Array.isArray(value)
      ? value.filter(item => typeof item !== 'string' || item.trim() !== '')
      : value ?? [],
    z.array(imageSchema, { error: '图片必须是字符串数组' }).max(10, '图片最多 10 张')
  ),
  skus: z.preprocess(
    value => value ?? [],
    z.array(skuSchema, { error: '规格必须是数组' }).min(1, '至少需要 1 个规格')
  ),
})

/** 校验并规范化商品请求体（规格为价格/库存事实来源，商品级 price/stock 会被派生值覆盖） */
export function validateProduct(body: unknown): ValidationResult<ProductInput> {
  return parseWithSchema(productSchema, body)
}

export type StockDeltaResult = ValidationResult<StockAdjustInput>

const stockDeltaSchema = bodyObject({
  delta: numeric(z.number({ error: '调整量必须是非零整数，且绝对值不超过 999999' })).refine(
    value => Number.isInteger(value) && value !== 0 && Math.abs(value) <= 999999,
    '调整量必须是非零整数，且绝对值不超过 999999'
  ),
})

/** 校验库存调整请求体：delta 为 ±(1..999999) 的整数 */
export function validateStockDelta(body: unknown): StockDeltaResult {
  return parseWithSchema(stockDeltaSchema, body)
}

export type AddressValidationResult = ValidationResult<AddressInput>

const addressSchema = bodyObject({
  receiver: z.preprocess(
    value => value ?? '',
    z.string({ error: '收货人不能为空' }).trim().min(1, '收货人不能为空').max(20, '收货人不能超过 20 字')
  ),
  phone: z.preprocess(
    value => value ?? '',
    z.string({ error: '手机号不能为空' })
      .trim()
      .min(1, '手机号不能为空')
      .refine(value => value === '' || PHONE_REGEX.test(value), '手机号格式不正确')
  ),
  province: z.preprocess(
    value => value ?? '',
    z.string({ error: '省份必须是字符串' }).trim().max(20, '省份不能超过 20 字')
  ),
  city: z.preprocess(
    value => value ?? '',
    z.string({ error: '城市必须是字符串' }).trim().max(20, '城市不能超过 20 字')
  ),
  district: z.preprocess(
    value => value ?? '',
    z.string({ error: '区县必须是字符串' }).trim().max(20, '区县不能超过 20 字')
  ),
  detail: z.preprocess(
    value => value ?? '',
    z.string({ error: '详细地址不能为空' }).trim().min(1, '详细地址不能为空').max(120, '详细地址不能超过 120 字')
  ),
  is_default: z.preprocess(value => value === true || value === 1, z.boolean()),
})

/** 校验并规范化收货地址请求体 */
export function validateAddress(body: unknown): AddressValidationResult {
  return parseWithSchema(addressSchema, body)
}

export type ProfileValidationResult = ValidationResult<ProfileInput>

const profileSchema = bodyObject({
  nick_name: z.string({ error: '昵称不能为空且不能超过 24 字' })
    .trim()
    .refine(value => value.length > 0 && value.length <= 24, '昵称不能为空且不能超过 24 字')
    .optional(),
  avatar_url: z.string({ error: '头像地址必须是 http(s) 链接或 /uploads/ 路径' })
    .trim()
    .refine(value => value === '' || IMAGE_URL_REGEX.test(value), '头像地址必须是 http(s) 链接或 /uploads/ 路径')
    .optional(),
}).refine(
  value => value.nick_name !== undefined || value.avatar_url !== undefined,
  '没有需要更新的字段'
)

/** 校验资料更新请求体：昵称与头像至少传一个 */
export function validateProfile(body: unknown): ProfileValidationResult {
  return parseWithSchema(profileSchema, body)
}

export type CartAddResult = ValidationResult<CartAddInput>
export type CartQuantityResult = ValidationResult<CartQuantityInput>

const QUANTITY_ERROR = `数量必须是 1~${MAX_CART_ITEM_QUANTITY} 的整数`
const quantitySchema = numeric(
  z.number({ error: QUANTITY_ERROR }).int(QUANTITY_ERROR).min(1, QUANTITY_ERROR).max(MAX_CART_ITEM_QUANTITY, QUANTITY_ERROR)
)

const cartAddSchema = bodyObject({
  product_id: positiveId('商品 ID 不合法'),
  sku_id: positiveId('规格 ID 不合法'),
  quantity: quantitySchema,
})

/** 校验加购请求体：product_id / sku_id 正整数，quantity 1..MAX_CART_ITEM_QUANTITY */
export function validateCartAdd(body: unknown): CartAddResult {
  return parseWithSchema(cartAddSchema, body)
}

const cartQuantitySchema = bodyObject({ quantity: quantitySchema })

/** 校验购物车改量请求体 */
export function validateCartQuantity(body: unknown): CartQuantityResult {
  return parseWithSchema(cartQuantitySchema, body)
}

export type OrderCreateResult = ValidationResult<CreateOrderInput>

const CART_ITEMS_ERROR = '购物车选中项不合法'
const orderSourceSchema = z.discriminatedUnion('type', [
  bodyObject({
    type: z.literal('cart'),
    item_ids: z.array(positiveId(CART_ITEMS_ERROR), { error: CART_ITEMS_ERROR })
      .min(1, CART_ITEMS_ERROR)
      .transform(ids => [...new Set(ids)]),
  }),
  bodyObject({
    type: z.literal('direct'),
    product_id: positiveId('商品 ID 不合法'),
    sku_id: positiveId('规格 ID 不合法'),
    quantity: quantitySchema,
  }),
], { error: '下单来源不合法' })

const orderCreateSchema = bodyObject({
  source: orderSourceSchema,
  address_id: positiveId('收货地址不合法'),
  remark: z.preprocess(
    value => value ?? '',
    z.string({ error: '备注必须是字符串' }).trim().max(MAX_ORDER_REMARK_LENGTH, `备注不能超过 ${MAX_ORDER_REMARK_LENGTH} 字`)
  ),
})

/** 校验下单请求体：source 二选一（cart 选中项 / direct 立即购买），地址与备注 */
export function validateOrderCreate(body: unknown): OrderCreateResult {
  return parseWithSchema(orderCreateSchema, body)
}

const passwordSchema = z.string()
  .min(8, '新密码长度不能少于 8 位')
  .refine(value => /[a-zA-Z]/.test(value) && /\d/.test(value), '新密码必须同时包含字母和数字')

/** 校验新密码强度：至少 8 位且同时包含字母与数字，返回错误文案列表（空数组表示通过） */
export function validatePasswordStrength(password: string): string[] {
  const result = parseWithSchema(passwordSchema, password)
  return result.errors ?? []
}
