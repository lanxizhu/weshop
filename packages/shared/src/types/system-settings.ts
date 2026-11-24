/** 系统设置：可公开的站点品牌信息，不包含任何敏感配置 */

export interface SystemSettings {
  /** 网站名称，同时用于浏览器标题与管理后台品牌区 */
  site_name: string;
  /** 网站简介，用于页面 description 元信息 */
  site_description: string;
  /** 登录页与后台顶部 Logo 地址 */
  site_logo_url: string;
  /** 浏览器标签页 favicon 地址 */
  site_favicon_url: string;
}

export type SystemSettingsInput = SystemSettings;
