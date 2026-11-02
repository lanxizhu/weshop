export const API_BASE_URL = "http://localhost:8080";

/** 低库存预警阈值：库存小于该值时视为库存不足 */
export const LOW_STOCK_THRESHOLD = 10;

/** 每个用户最多保存的收货地址数量 */
export const MAX_ADDRESSES_PER_USER = 20;

/** 手机号校验：1 开头的 11 位数字 */
export const PHONE_REGEX = /^1\d{10}$/;

/** 单个商品在购物车中的最大数量 */
export const MAX_CART_ITEM_QUANTITY = 99;

/** 订单备注最大长度 */
export const MAX_ORDER_REMARK_LENGTH = 200;
