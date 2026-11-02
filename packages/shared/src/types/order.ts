/** 订单模块类型定义（与 apps/api SQLite orders / order_items 表对应） */

export type OrderStatus = "pending" | "paid" | "shipped" | "completed" | "cancelled";

/** 订单明细（下单时的商品/规格快照，不随商品后续编辑变化） */
export interface OrderItem {
  id: number;
  order_id: number;
  product_id: number;
  /** 下单时的 SKU id（纯快照，不加外键，SKU 后续删除不影响） */
  sku_id: number;
  sku_name: string;
  product_name: string;
  product_image: string;
  price: number;
  quantity: number;
  created_at: string;
}

export interface Order {
  id: number;
  order_no: string;
  user_id: number;
  status: OrderStatus;
  total_amount: number;
  /** 以下为收货地址快照 */
  receiver: string;
  phone: string;
  province: string;
  city: string;
  district: string;
  detail: string;
  remark: string;
  paid_at: string | null;
  shipped_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string;
  created_at: string;
  updated_at: string;
  items: OrderItem[];
}

/** 下单来源：购物车选中项 或 详情页立即购买 */
export type CreateOrderSource =
  | { type: "cart"; item_ids: number[] }
  | { type: "direct"; product_id: number; sku_id: number; quantity: number };

export interface CreateOrderInput {
  source: CreateOrderSource;
  address_id: number;
  remark?: string;
}

export interface OrderListParams {
  status?: OrderStatus | "all";
  page?: number;
  pageSize?: number;
}

export interface OrderListResult {
  orders: Order[];
  total: number;
  page: number;
  pageSize: number;
}

/** 管理端订单列表项（join users 得到买家昵称） */
export interface AdminOrder extends Order {
  nick_name: string;
}

export interface AdminOrderListParams extends OrderListParams {
  /** 按订单号 / 收货人模糊搜索 */
  keyword?: string;
}

export interface AdminOrderListResult {
  orders: AdminOrder[];
  total: number;
  page: number;
  pageSize: number;
}
