/** 收货地址模块类型定义（与 apps/api MySQL addresses 表对应） */

export interface Address {
  id: number;
  user_id: number;
  receiver: string;
  phone: string;
  province: string;
  city: string;
  district: string;
  /** 详细地址（小区、门牌号等） */
  detail: string;
  /** 是否默认地址：1 是，0 否 */
  is_default: 0 | 1;
  created_at: string;
  updated_at: string;
}

export interface AddressInput {
  receiver: string;
  phone: string;
  province: string;
  city: string;
  district: string;
  detail: string;
  /** 传 true 设为默认地址 */
  is_default?: boolean;
}
