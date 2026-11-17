/** 用户模块类型定义（与 apps/api SQLite users 表对应） */

export interface User {
  id: number;
  /** 微信 openid；开发 Mock 模式下为 dev_<code> */
  openid: string;
  nick_name: string;
  avatar_url: string;
  /** 账号状态：disabled 时拒绝登录与 C 端接口访问 */
  status: "normal" | "disabled";
  created_at: string;
  updated_at: string;
}

export interface LoginResult {
  token: string;
  user: User;
}

export interface ProfileInput {
  nick_name?: string;
  avatar_url?: string;
}

/** 管理端用户列表项（附带收货地址数量） */
export interface UserListItem extends User {
  address_count: number;
}

export interface UserListParams {
  page?: number;
  pageSize?: number;
}

export interface UserListResult {
  users: UserListItem[];
  total: number;
  /** 全部用户的收货地址总数，不受当前分页影响 */
  addressTotal: number;
  page: number;
  pageSize: number;
}

/** 管理端用户详情（统计口径：total_spent 仅累计 paid/shipped/completed 订单金额） */
export interface UserDetail extends User {
  address_count: number;
  order_count: number;
  total_spent: number;
  /** 最近一次下单时间，无订单为 null */
  last_order_at: string | null;
}
