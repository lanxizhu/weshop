import type {
  Address,
  Admin,
  AdminLoginResult,
  AdminOrder,
  AdminOrderListParams,
  AdminOrderListResult,
  Category,
  CategoryInput,
  DashboardStats,
  Order,
  Product,
  ProductInput,
  ProductListParams,
  ProductListResult,
  ProductStats,
  StockLog,
  User,
  UserDetail,
  UserListParams,
  UserListResult,
} from '@weshop/shared'
import type { AxiosRequestConfig } from 'axios'
import axios from 'axios'
import { AUTH_UNAUTHORIZED_EVENT, clearToken, getToken } from './auth'

// ---------- Axios 实例 ----------
// 统一 baseURL、JSON 头与超时；配合 request() 做异常归一化。

export const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000,
})

// 请求拦截器：注入管理员令牌
http.interceptors.request.use((config) => {
  const token = getToken()
  if (token)
    config.headers.Authorization = `Bearer ${token}`
  return config
})

// 响应拦截器：401（非登录请求本身）视为登录态失效，清令牌并通知根组件跳转登录页
http.interceptors.response.use(undefined, (error: unknown) => {
  if (
    axios.isAxiosError(error)
    && error.response?.status === 401
    && !String(error.config?.url ?? '').includes('/admin/auth/login')
    && !window.location.pathname.startsWith('/login')
  ) {
    clearToken()
    window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT))
  }
  return Promise.reject(error)
})

// ---------- 重试策略（可配置） ----------
// 两级重试：
//   1. 即时重试：网络层失败后按指数退避（基数 backoffBaseMs，带 20% 随机抖动）
//      立即重试 immediateRetries 次；
//   2. 恢复重试：即时重试全部失败后将请求去重入队，轮询 /healthy 探测服务，
//      恢复后自动重放队列中的请求。
// 注意：仅幂等 GET 的网络层失败（断网 / 宕机 / 超时）触发重试；
// 非 GET 请求只执行一次且不入队，HTTP 4xx/5xx 业务错误不重试。

export interface RetryOptions {
  /** 入队前的即时重试次数，默认 2 */
  immediateRetries?: number
  /** 指数退避基数（毫秒），默认 1000，即第 1/2 次重试分别等待 ~1s / ~2s */
  backoffBaseMs?: number
  /** 健康检查轮询间隔（毫秒），默认 3000 */
  healthCheckInterval?: number
}

const retryOptions = {
  immediateRetries: 2,
  backoffBaseMs: 1000,
  healthCheckInterval: 3000,
}

export function configureRetry(opts: RetryOptions): void {
  Object.assign(retryOptions, opts)
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

function backoffDelay(attempt: number): number {
  const base = retryOptions.backoffBaseMs * 2 ** attempt
  return base + Math.random() * base * 0.2 // 20% 抖动，避免同时重试形成尖峰
}

// ---------- 异常归一化 ----------

interface ErrorBody { errors?: unknown }

/** 把 axios 错误统一转换为带用户可读消息的 Error */
function toAppError(e: unknown): Error {
  if (axios.isAxiosError(e)) {
    // 服务器返回了错误响应：优先取业务 errors 数组
    const data = e.response?.data as ErrorBody | undefined
    if (data && Array.isArray(data.errors)) {
      return new Error((data.errors as unknown[]).map(String).join('；'))
    }
    if (!e.response) {
      return new Error('服务连接失败，恢复后将自动重试')
    }
  }
  return new Error('请求失败，请重试')
}

/** 是否为网络层失败（服务不可达 / 超时 / 断网）——只有这种情况才触发重试 */
function isNetworkFailure(e: unknown): boolean {
  return axios.isAxiosError(e) && !e.response
}

// ---------- 失败队列与健康检查 ----------

interface QueuedRequest { key: string, config: AxiosRequestConfig }

const retryQueue = new Map<string, QueuedRequest>()
let healthTimer: ReturnType<typeof setInterval> | null = null

const recoverListeners = new Set<() => void>()

/** 订阅「服务恢复」事件，返回取消订阅函数 */
export function onServerRecover(listener: () => void): () => void {
  recoverListeners.add(listener)
  return () => {
    recoverListeners.delete(listener)
  }
}

function retryKey(config: AxiosRequestConfig): string {
  const body = typeof config.data === 'string' ? config.data : ''
  return `${String(config.method ?? 'get').toUpperCase()} ${String(config.url)} ${body}`
}

/** 请求入队（相同请求去重，只保留最后一次）并启动健康探测 */
function queueRetry(config: AxiosRequestConfig) {
  const key = retryKey(config)
  retryQueue.set(key, { key, config })
  startHealthCheck()
}

/** 请求已成功或确定不重试时，将其移出队列（避免恢复后重复重放） */
function dequeueRetry(config: AxiosRequestConfig) {
  retryQueue.delete(retryKey(config))
}

function startHealthCheck() {
  if (healthTimer)
    return
  void checkHealth()
  healthTimer = setInterval(() => void checkHealth(), retryOptions.healthCheckInterval)
}

async function checkHealth(): Promise<void> {
  try {
    // 只要拿到任何响应（哪怕 5xx）都说明服务已恢复连接
    await http.get('/healthy')
  }
  catch (e) {
    if (isNetworkFailure(e))
      return // 仍未恢复，等待下一轮
  }
  if (healthTimer) {
    clearInterval(healthTimer)
    healthTimer = null
  }
  const pending = [...retryQueue.values()]
  retryQueue.clear()
  for (const item of pending) {
    try {
      // 重放失败的请求（fire-and-forget，结果通过 onServerRecover 通知页面刷新）
      await http.request(item.config)
    }
    catch (e) {
      if (isNetworkFailure(e)) {
        retryQueue.set(item.key, item) // 重放时服务又挂了，重新排队等下一轮
      }
    }
  }
  if (retryQueue.size > 0) {
    startHealthCheck()
    return
  }
  recoverListeners.forEach(l => l())
}

// ---------- 统一请求入口（仅 GET 含两级重试） ----------

async function executeWithRetry<T>(config: AxiosRequestConfig, run: () => Promise<T>): Promise<T> {
  const retryable = String(config.method ?? 'get').toUpperCase() === 'GET'
  const maxAttempts = retryable ? retryOptions.immediateRetries + 1 : 1
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0)
      dequeueRetry(config) // 亲自重试前先退出队列，避免与健康探测的重放叠加
    try {
      const result = await run()
      dequeueRetry(config)
      return result
    }
    catch (e) {
      dequeueRetry(config)
      if (!isNetworkFailure(e))
        throw toAppError(e) // 业务错误直接抛出，不重试
      if (!retryable)
        throw new Error('服务连接失败，请检查网络后重试')
      if (attempt === 0)
        queueRetry(config) // 首次失败即入队，尽早开始健康探测
      if (attempt < maxAttempts - 1) {
        await sleep(backoffDelay(attempt))
        continue
      }
      queueRetry(config) // 即时重试耗尽，确保仍在队列中等待恢复重试
      throw toAppError(e)
    }
  }
  throw new Error('请求失败，请重试') // 不可达
}

async function request<T>(url: string, config: AxiosRequestConfig = {}): Promise<T> {
  const full = { url, ...config }
  return executeWithRetry(full, async () => {
    const res = await http.request<T>(full)
    return res.data
  })
}

// ---------- 管理端鉴权 ----------

/** 管理员登录 */
export function adminLogin(username: string, password: string) {
  return request<AdminLoginResult>('/admin/auth/login', {
    method: 'POST',
    data: { username, password },
  })
}

/** 修改当前管理员密码；非幂等操作不自动重试，成功后需保存返回的新令牌以维持当前会话 */
export async function changeAdminPassword(oldPassword: string, newPassword: string) {
  try {
    const res = await http.put<{ token: string, message: string }>('/admin/auth/password', { oldPassword, newPassword })
    return res.data
  }
  catch (e) {
    if (isNetworkFailure(e))
      throw new Error('服务连接失败，请检查网络后重试')
    throw toAppError(e)
  }
}

/** 当前登录管理员 */
export function fetchAdminMe() {
  return request<{ admin: Admin }>('/admin/auth/me')
}

// ---------- 商品 ----------

/** 序列化商品列表查询参数（列表与 CSV 导出共用） */
function productsQuery(params: ProductListParams): string {
  const q = new URLSearchParams()
  if (params.search)
    q.set('search', params.search)
  if (params.status && params.status !== 'all')
    q.set('status', params.status)
  if (params.category)
    q.set('category', params.category)
  if (params.lowStock)
    q.set('lowStock', '1')
  if (params.page)
    q.set('page', String(params.page))
  if (params.pageSize)
    q.set('pageSize', String(params.pageSize))
  if (params.sort)
    q.set('sort', params.sort)
  if (params.order)
    q.set('order', params.order)
  return q.toString()
}

export function fetchProducts(params: ProductListParams) {
  return request<ProductListResult>(`/products?${productsQuery(params)}`)
}

export function fetchProduct(id: number) {
  return request<{ product: Product }>(`/products/${id}`)
}

/** 导出当前过滤条件下的商品 CSV（需鉴权，走 axios blob 下载） */
export async function downloadProductsCsv(params: ProductListParams): Promise<void> {
  const config: AxiosRequestConfig = {
    method: 'GET',
    url: `/products/export.csv?${productsQuery(params)}`,
    responseType: 'blob',
  }
  await executeWithRetry(config, async () => {
    const res = await http.request<Blob>(config)
    const url = URL.createObjectURL(res.data)
    const a = document.createElement('a')
    a.href = url
    a.download = 'products.csv'
    a.click()
    URL.revokeObjectURL(url)
  })
}

export function fetchStats() {
  return request<ProductStats>('/stats')
}

export function createProduct(input: ProductInput) {
  return request<{ product: Product }>('/products', { method: 'POST', data: input })
}

export function updateProduct(id: number, input: ProductInput) {
  return request<{ product: Product }>(`/products/${id}`, { method: 'PUT', data: input })
}

export function setProductStatus(id: number, status: Product['status']) {
  return request<{ product: Product }>(`/products/${id}/status`, {
    method: 'PATCH',
    data: { status },
  })
}

/** 库存增减（delta 正数入库、负数出库）；仅单规格商品可用，多规格请用 adjustSkuStock */
export function adjustStock(id: number, delta: number) {
  return request<{ product: Product }>(`/products/${id}/stock`, {
    method: 'PATCH',
    data: { delta },
  })
}

/** 按规格调整库存（delta 正数入库、负数出库），返回含最新 skus 的商品 */
export function adjustSkuStock(productId: number, skuId: number, delta: number) {
  return request<{ product: Product }>(`/products/${productId}/skus/${skuId}/stock`, {
    method: 'PATCH',
    data: { delta },
  })
}

/** 商品的库存流水（最新在前） */
export function fetchStockLogs(productId: number) {
  return request<{ logs: StockLog[] }>(`/products/${productId}/stock-logs`)
}

export function batchSetProductStatus(ids: number[], status: Product['status']) {
  return request<{ updated: number }>('/products/batch-status', {
    method: 'POST',
    data: { ids, status },
  })
}

export function batchDeleteProducts(ids: number[]) {
  return request<{ deleted: number }>('/products/batch-delete', {
    method: 'POST',
    data: { ids },
  })
}

export function duplicateProduct(id: number) {
  return request<{ product: Product }>(`/products/${id}/duplicate`, { method: 'POST' })
}

export function deleteProduct(id: number) {
  return request<{ ok: boolean }>(`/products/${id}`, { method: 'DELETE' })
}

/** 上传图片（multipart），返回可访问的 URL 路径 */
export function uploadImage(file: File): Promise<string> {
  const fd = new FormData()
  fd.append('file', file)
  const config: AxiosRequestConfig = { method: 'POST', url: '/uploads', data: fd }
  return executeWithRetry(config, async () => {
    const res = await http.request<{ url: string }>(config)
    return res.data.url
  })
}

// ---------- 分类 ----------

export function fetchCategories() {
  return request<{ categories: Category[] }>('/categories')
}

export function createCategory(input: CategoryInput) {
  return request<{ category: Category }>('/categories', { method: 'POST', data: input })
}

export function updateCategory(id: number, input: CategoryInput) {
  return request<{ category: Category }>(`/categories/${id}`, { method: 'PUT', data: input })
}

/** 按 ids 数组顺序重排分类展示顺序 */
export function reorderCategories(ids: number[]) {
  return request<{ categories: Category[] }>('/categories/reorder', { method: 'PUT', data: { ids } })
}

/** 删除分类；分类下有商品时必须传 migrateTo（目标分类名） */
export function deleteCategory(id: number, migrateTo?: string) {
  const q = migrateTo ? `?migrateTo=${encodeURIComponent(migrateTo)}` : ''
  return request<{ ok: boolean, migrated: number }>(`/categories/${id}${q}`, { method: 'DELETE' })
}

// ---------- 用户 ----------

export function fetchUsers(params: UserListParams = {}) {
  const q = new URLSearchParams()
  if (params.page)
    q.set('page', String(params.page))
  if (params.pageSize)
    q.set('pageSize', String(params.pageSize))
  return request<UserListResult>(`/users?${q.toString()}`)
}

/** 用户详情（含统计字段与收货地址列表） */
export function fetchUserDetail(id: number) {
  return request<{ user: UserDetail & { addresses: Address[] } }>(`/users/${id}`)
}

/** 用户的订单列表（带明细，倒序分页） */
export function fetchUserOrders(id: number, params: { page: number, pageSize: number }) {
  return request<{ orders: Order[], total: number, page: number, pageSize: number }>(
    `/users/${id}/orders?page=${params.page}&pageSize=${params.pageSize}`,
  )
}

/** 禁用 / 恢复用户账号 */
export function setUserStatus(id: number, status: User['status']) {
  return request<{ user: User }>(`/users/${id}/status`, {
    method: 'PATCH',
    data: { status },
  })
}

// ---------- 订单（管理端） ----------

/** 序列化管理端订单列表查询参数 */
function adminOrdersQuery(params: AdminOrderListParams): string {
  const q = new URLSearchParams()
  if (params.status && params.status !== 'all')
    q.set('status', params.status)
  if (params.keyword)
    q.set('keyword', params.keyword)
  if (params.page)
    q.set('page', String(params.page))
  if (params.pageSize)
    q.set('pageSize', String(params.pageSize))
  return q.toString()
}

export function fetchAdminOrders(params: AdminOrderListParams) {
  return request<AdminOrderListResult>(`/admin/orders?${adminOrdersQuery(params)}`)
}

/** 导出当前过滤条件下的订单 CSV（复用列表过滤，忽略分页参数） */
export async function downloadOrdersCsv(params: AdminOrderListParams): Promise<void> {
  const { page: _page, pageSize: _pageSize, ...rest } = params
  const config: AxiosRequestConfig = {
    method: 'GET',
    url: `/admin/orders/export.csv?${adminOrdersQuery(rest)}`,
    responseType: 'blob',
  }
  await executeWithRetry(config, async () => {
    const res = await http.request<Blob>(config)
    const url = URL.createObjectURL(res.data)
    const a = document.createElement('a')
    a.href = url
    a.download = 'orders.csv'
    a.click()
    URL.revokeObjectURL(url)
  })
}

export function fetchAdminOrder(id: number) {
  return request<{ order: AdminOrder }>(`/admin/orders/${id}`)
}

/** 发货（paid → shipped） */
export function shipOrder(id: number) {
  return request<{ order: AdminOrder }>(`/admin/orders/${id}/ship`, { method: 'POST' })
}

/** 商家取消订单（pending/paid → cancelled，回补库存） */
export function cancelAdminOrder(id: number, reason?: string) {
  return request<{ order: AdminOrder }>(`/admin/orders/${id}/cancel`, {
    method: 'POST',
    data: reason ? { reason } : {},
  })
}

// ---------- 数据统计（管理端） ----------

/** 经营仪表盘：概览 + 近 days 天趋势 + 状态分布 + 热销榜 + 分类分布 */
export function fetchDashboard(days: 7 | 30) {
  return request<DashboardStats>(`/admin/stats/dashboard?days=${days}`)
}

// ---------- 维护（管理端） ----------

/** 清理无人引用的上传图片，返回删除数量与释放字节数 */
export function cleanupUploads() {
  return request<{ deleted: number, freedBytes: number }>('/admin/uploads/cleanup', { method: 'POST' })
}
