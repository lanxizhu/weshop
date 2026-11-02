import type { Category, Product, ProductListResult, ProductSortField, SortOrder } from '@weshop/shared'
import { request } from './request'

/** 把 /uploads/ 等相对路径补全为可访问的完整 URL（http(s) 链接原样返回） */
export function assetUrl(path: string): string {
  return /^https?:\/\//.test(path) ? path : `${API_BASE}${path}`
}

export interface FetchProductsParams {
  search?: string
  category?: string
  status?: 'on' | 'off'
  lowStock?: 1
  page?: number
  pageSize?: number
  sort?: ProductSortField
  order?: SortOrder
}

export function fetchProducts(params: FetchProductsParams): Promise<ProductListResult> {
  const data: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '')
      data[k] = v
  }
  return request<ProductListResult>('/products', { data })
}

export function fetchProduct(id: number): Promise<{ product: Product }> {
  return request<{ product: Product }>(`/products/${id}`)
}

export function fetchCategories(): Promise<{ categories: Category[] }> {
  return request<{ categories: Category[] }>('/categories')
}
