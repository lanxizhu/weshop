/** 购物车模块类型定义（与 apps/api MySQL cart_items 表 + join product_skus / products 对应） */

export interface CartItem {
  id: number;
  user_id: number;
  product_id: number;
  sku_id: number;
  quantity: number;
  created_at: string;
  updated_at: string;
  /** 以下字段由服务端 join products / product_skus 得出 */
  name: string;
  sku_name: string;
  /** 单价（SKU 价格） */
  price: number;
  /** 库存（SKU 库存） */
  stock: number;
  status: "on" | "off";
  /** SKU 图，SKU 无图时回退商品首图，再无图为空字符串 */
  image: string;
  /** price * quantity */
  subtotal: number;
  /** 失效标记：商品已下架或 SKU 库存不足（仍保留在购物车中展示） */
  invalid: boolean;
}

export interface CartListResult {
  items: CartItem[];
  /** 有效商品的件数合计 */
  total_quantity: number;
  /** 有效商品的金额合计 */
  total_amount: number;
}

export interface CartAddInput {
  product_id: number;
  sku_id: number;
  quantity: number;
}

export interface CartQuantityInput {
  quantity: number;
}
