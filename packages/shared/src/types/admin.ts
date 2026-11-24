/** 管理员模块类型定义（与 apps/api MySQL admins 表对应） */

export interface Admin {
  id: number;
  username: string;
  created_at: string;
  updated_at: string;
}

export interface AdminLoginResult {
  token: string;
  admin: Admin;
}
