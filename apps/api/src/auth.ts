import { createHmac, timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { TOKEN_SECRET, TOKEN_TTL_SECONDS } from './config.js'
import { getAdminAuthById, getUserById } from './db.js'

/**
 * 鉴权中间件的泛型签名：直接挂到带路径参数的路由（如 '/:id/stock-logs'）上时，
 * Express 5 仍能从路径字面量推断 req.params 的类型；
 * 若声明成具体的 RequestHandler 常量，路由方法会把 req.params 退化为 ParamsDictionary
 * （noUncheckedIndexedAccess 下 req.params.id 变成 string | string[] | undefined，无法通过类型检查）
 */
interface GuardMiddleware {
  <P = unknown, ResBody = unknown, ReqBody = unknown, ReqQuery = unknown, LocalsObj extends Record<string, any> = Record<string, any>>(
    req: Request<P, ResBody, ReqBody, ReqQuery, LocalsObj>,
    res: Response<ResBody, LocalsObj>,
    next: NextFunction
  ): void | Promise<void>
}

interface TokenPayload {
  uid?: number
  aid?: number
  role?: 'admin'
  /** 管理员令牌版本：与 admins.token_version 不一致即视为已吊销（改密后旧 token 全部失效） */
  tv?: number
  exp: number
}

function sign(payload: TokenPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url')
  return `${body}.${sig}`
}

/** 签发用户登录令牌：base64url(payload).base64url(HMAC-SHA256 签名) */
export function signToken(uid: number): string {
  return sign({ uid, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS })
}

/** 签发管理员登录令牌（payload 带 role='admin'、管理员 id 与当前 token_version 快照） */
export async function signAdminToken(aid: number): Promise<string> {
  const tv = (await getAdminAuthById(aid))?.token_version ?? 0
  return sign({ aid, role: 'admin', tv, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS })
}

/** 校验令牌，有效则返回 payload，否则返回 null */
export function verifyToken(token: string): TokenPayload | null {
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const expected = createHmac('sha256', TOKEN_SECRET).update(body).digest()
  const actual = Buffer.from(sig, 'base64url')
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as Partial<TokenPayload>
    if (typeof payload.exp !== 'number') return null
    if (payload.exp * 1000 < Date.now()) return null
    return payload as TokenPayload
  } catch {
    return null
  }
}

function extractPayload(req: Parameters<RequestHandler>[0]): TokenPayload | null {
  const m = /^Bearer\s+(.+)$/.exec(req.headers.authorization ?? '')
  return m?.[1] ? verifyToken(m[1].trim()) : null
}

/** 鉴权中间件：Authorization: Bearer <token>，通过后把用户 id 写入 res.locals.uid */
export const requireAuth: RequestHandler = async (req, res, next) => {
  const payload = extractPayload(req)
  const uid = payload?.uid
  const user = typeof uid === 'number' ? await getUserById(uid) : undefined
  if (typeof uid !== 'number' || !user) {
    res.status(401).json({ errors: ['请先登录'] })
    return
  }
  if (user.status === 'disabled') {
    res.status(403).json({ errors: ['账号已被禁用，请联系客服'] })
    return
  }
  res.locals.uid = uid
  next()
}

const requireAdminImpl: RequestHandler = async (req, res, next) => {
  const payload = extractPayload(req)
  const aid = payload?.role === 'admin' ? payload.aid : undefined
  // 顺带确认管理员仍存在；payload.tv 与库中 token_version 不一致说明令牌已因改密被吊销
  const admin = typeof aid === 'number' ? await getAdminAuthById(aid) : undefined
  if (typeof aid !== 'number' || !admin || payload?.tv !== admin.token_version) {
    res.status(401).json({ errors: ['请先登录'] })
    return
  }
  res.locals.adminId = aid
  next()
}

/** 管理员鉴权中间件：仅接受 role='admin' 且令牌版本未被吊销的令牌，通过后把管理员 id 写入 res.locals.adminId */
export const requireAdmin = requireAdminImpl as GuardMiddleware

/** 可选管理员身份：有效管理员令牌可查看管理端数据；匿名、用户令牌或无效令牌仍按公开访问处理 */
export const optionalAdmin: RequestHandler = async (req, res, next) => {
  const payload = extractPayload(req)
  const aid = payload?.role === 'admin' ? payload.aid : undefined
  const admin = typeof aid === 'number' ? await getAdminAuthById(aid) : undefined
  if (typeof aid === 'number' && admin && payload?.tv === admin.token_version) {
    res.locals.adminId = aid
  }
  next()
}

/** 宽松鉴权：用户令牌或管理员令牌任一有效即可（如小程序头像上传与管理端图片上传共用的接口）；管理员令牌同样校验 token_version */
export const requireAnyAuth: RequestHandler = async (req, res, next) => {
  const payload = extractPayload(req)
  const admin = payload?.role === 'admin' && typeof payload.aid === 'number' ? await getAdminAuthById(payload.aid) : undefined
  if (admin && payload?.tv === admin.token_version) {
    res.locals.adminId = payload!.aid
    next()
    return
  }
  const user = typeof payload?.uid === 'number' ? await getUserById(payload.uid) : undefined
  if (user) {
    if (user.status === 'disabled') {
      res.status(403).json({ errors: ['账号已被禁用，请联系客服'] })
      return
    }
    res.locals.uid = payload!.uid
    next()
    return
  }
  res.status(401).json({ errors: ['请先登录'] })
}
