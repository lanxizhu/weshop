/** 分类模块类型定义（与 apps/api SQLite 表结构对应） */

export interface Category {
  id: number;
  name: string;
  /** 展示顺序，越小越靠前 */
  sort_order: number;
  created_at: string;
  /** 该分类下的商品数量（查询时附带） */
  product_count: number;
}

export interface CategoryInput {
  name: string;
}

export interface CategoryReorderInput {
  /** 按期望顺序排列的全部分类 id */
  ids: number[];
}
