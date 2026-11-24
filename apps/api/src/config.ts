import path from 'node:path'

/** 包根目录（apps/api） */
const pkgRoot = path.resolve(import.meta.dirname, '..')

/** 上传文件的数据目录：默认沿用 apps/api/server/uploads，可用环境变量覆盖 */
export const DATA_DIR = process.env.API_DATA_DIR ?? path.join(pkgRoot, 'server')
export const UPLOAD_DIR = process.env.API_UPLOAD_DIR ?? path.join(DATA_DIR, 'uploads')

function positiveInteger(raw: string | undefined, fallback: number): number {
  const value = Number(raw)
  return Number.isSafeInteger(value) && value > 0 ? value : fallback
}

export const MYSQL_HOST = process.env.API_MYSQL_HOST ?? '127.0.0.1'
export const MYSQL_PORT = positiveInteger(process.env.API_MYSQL_PORT, 3306)
export const MYSQL_DATABASE = process.env.API_MYSQL_DATABASE ?? 'weshop'
export const MYSQL_USER = process.env.API_MYSQL_USER ?? 'weshop'
export const MYSQL_PASSWORD = process.env.API_MYSQL_PASSWORD ?? ''
export const MYSQL_CONNECTION_LIMIT = positiveInteger(process.env.API_MYSQL_CONNECTION_LIMIT, 10)

export const PORT = Number(process.env.API_PORT ?? 7101)

/** 信任反向代理层数或地址：默认信任一层，使限流与日志在 nginx 后取得真实客户端 IP */
const rawTrustProxy = (process.env.API_TRUST_PROXY ?? '1').trim()
export const TRUST_PROXY: number | string | boolean = /^\d+$/.test(rawTrustProxy)
  ? Number(rawTrustProxy)
  : rawTrustProxy === 'true'
    ? true
    : rawTrustProxy === 'false'
      ? false
      : rawTrustProxy

function positiveSeconds(raw: string | undefined, fallback: number): number {
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

/** 待支付订单保留时长与扫描周期；自包含测试会缩短到数秒 */
export const ORDER_TIMEOUT_SECONDS = positiveSeconds(process.env.API_ORDER_TIMEOUT_SECONDS, 15 * 60)
export const ORDER_SWEEP_INTERVAL_SECONDS = positiveSeconds(process.env.API_ORDER_SWEEP_INTERVAL_SECONDS, 30)

/** 微信小程序登录凭证：未配置时 /api/auth/login 走 Mock 模式（openid = dev_<code>） */
export const WX_APPID = process.env.WX_APPID ?? ''
export const WX_SECRET = process.env.WX_SECRET ?? ''

/** 开发环境默认值：仅供本地开发，生产环境沿用会在下方 fail-fast 检查中拒绝启动 */
const DEV_TOKEN_SECRET = 'weshop-dev-secret'
const DEV_ADMIN_PASSWORD = 'admin123'

/** 登录令牌签名密钥：生产环境必须通过 API_TOKEN_SECRET 覆盖（NODE_ENV=production 时拒绝默认值） */
export const TOKEN_SECRET = process.env.API_TOKEN_SECRET ?? DEV_TOKEN_SECRET

/** 登录令牌有效期（秒）：30 天 */
export const TOKEN_TTL_SECONDS = 30 * 24 * 3600

/** 初始管理员账号：仅在 admins 表为空时创建；生产环境务必通过环境变量覆盖并尽快修改 */
export const ADMIN_USERNAME = process.env.API_ADMIN_USERNAME ?? 'admin'
export const ADMIN_PASSWORD = process.env.API_ADMIN_PASSWORD ?? DEV_ADMIN_PASSWORD

/**
 * 生产环境安全配置 fail-fast：命中任一危险默认值/缺失项即拒绝启动。
 * 开发环境（NODE_ENV 非 production）不做任何限制，行为与之前完全一致。
 */
if (process.env.NODE_ENV === 'production') {
  const problems: string[] = []
  if (!MYSQL_PASSWORD) {
    problems.push('生产环境使用 MySQL 时必须配置 API_MYSQL_PASSWORD')
  }
  if (!TOKEN_SECRET || TOKEN_SECRET === DEV_TOKEN_SECRET) {
    problems.push('API_TOKEN_SECRET 未配置或仍为开发默认值，攻击者可据此伪造管理员令牌')
  }
  if (ADMIN_PASSWORD === DEV_ADMIN_PASSWORD) {
    problems.push(`API_ADMIN_PASSWORD 未配置或仍为开发默认值 ${DEV_ADMIN_PASSWORD}`)
  }
  if (!WX_APPID || !WX_SECRET) {
    problems.push('WX_APPID / WX_SECRET 未配置，小程序登录会退化为 Mock 模式，任何人可伪造任意用户身份')
  }
  if (problems.length) {
    throw new Error(
      `生产环境安全检查未通过，拒绝启动：\n${problems.map((p) => `  - ${p}`).join('\n')}\n` +
        '请在仓库根目录 .env（或容器环境变量）中配置上述项后重启，字段说明见 .env.example'
    )
  }
}
