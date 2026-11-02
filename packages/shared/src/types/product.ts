/** 商品模块类型定义（与 apps/api SQLite 表结构对应） */

export type ProductStatus = "on" | "off";

/** 商品规格（对应 product_skus 表）：价格/库存的唯一事实来源，每个商品至少 1 条 */
export interface Sku {
  id: number;
  product_id: number;
  name: string;
  price: number;
  stock: number;
  /** 规格图（/uploads/ 本地路径或 http(s) URL），为空时前端回退商品首图 */
  image: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/** 保存商品时提交的规格：有 id = 更新，无 id = 新建，缺失的 id = 删除 */
export interface SkuInput {
  id?: number;
  name: string;
  price: number;
  stock: number;
  image?: string;
}

/** 库存流水（对应 stock_logs 表）：记录每次 SKU 库存变动 */
export interface StockLog {
  id: number;
  product_id: number;
  sku_id: number;
  sku_name: string;
  /** 变动量：正数入库、负数出库 */
  delta: number;
  /** 变动后该 SKU 的库存 */
  stock_after: number;
  reason: "init" | "order" | "cancel" | "adjust";
  /** 关联单号或说明 */
  ref: string;
  /** 操作者，形如 admin:<aid> / user:<uid> */
  operator: string;
  created_at: string;
}

export interface Product {
  id: number;
  name: string;
  category: string;
  /** 派生字段：最低 SKU 价，用于列表排序 / 统计 */
  price: number;
  /** 派生字段：SKU 库存总和，用于低库存过滤 / 统计 */
  stock: number;
  description: string;
  status: ProductStatus;
  created_at: string;
  updated_at: string;
  /** 图片地址列表（/uploads/ 本地路径或 http(s) URL） */
  images: string[];
  /** 规格列表（按 sort_order, id 排序） */
  skus: Sku[];
}

export interface ProductStats {
  total: number;
  onShelf: number;
  offShelf: number;
  totalValue: number;
  /** 库存低于 LOW_STOCK_THRESHOLD 的商品数量 */
  lowStock: number;
}

export interface ProductInput {
  name: string;
  category: string;
  price: number;
  stock: number;
  description: string;
  status: ProductStatus;
  images: string[];
  skus: SkuInput[];
}

export type ProductSortField = "price" | "stock" | "updated_at";
export type SortOrder = "asc" | "desc";

export interface ProductListParams {
  search?: string;
  status?: ProductStatus | "all";
  category?: string;
  /** 传 1 只返回低库存商品 */
  lowStock?: 1;
  page?: number;
  pageSize?: number;
  sort?: ProductSortField;
  order?: SortOrder;
}

export interface ProductListResult {
  products: Product[];
  total: number;
  page: number;
  pageSize: number;
}

export interface StockAdjustInput {
  /** 增减量，正数入库、负数出库，非零整数 */
  delta: number;
}

export interface BatchStatusInput {
  ids: number[];
  status: ProductStatus;
}

export interface BatchDeleteInput {
  ids: number[];
}
