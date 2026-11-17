import { Router } from 'express'
import type { LoginResult } from '@weshop/shared'
import { requireAuth, signToken } from '../auth.js'
import { WX_APPID, WX_SECRET } from '../config.js'
import { db, getUserById, upsertUserByOpenid } from '../db.js'
import { logger } from '../logger.js'
import { validateProfile } from '../validate.js'

export const authRouter = Router()

let mockWarned = false

type OpenidResult = { openid: string } | { errors: string[] }

/** 用 wx.login 的 code 换 openid：配置了微信凭证走 code2session，否则走开发 Mock（openid = dev_<code>） */
async function resolveOpenid(code: string): Promise<OpenidResult> {
  if (!WX_APPID || !WX_SECRET) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(code)) {
      return { errors: ['Mock 登录 code 仅支持 1~64 位字母、数字、下划线和连字符'] }
    }
    if (!mockWarned) {
      mockWarned = true
      logger.warn('未配置 WX_APPID/WX_SECRET，微信登录处于 Mock 模式（openid = dev_<code>），请勿用于生产')
    }
    return { openid: `dev_${code}` }
  }
  try {
    const url =
      `https://api.weixin.qq.com/sns/jscode2session?appid=${WX_APPID}` +
      `&secret=${WX_SECRET}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    const data = (await res.json()) as { openid?: string; errcode?: number; errmsg?: string }
    if (!data.openid) {
      logger.warn('code2session 失败', { errcode: data.errcode, errmsg: data.errmsg })
      return { errors: [`微信登录失败${data.errmsg ? `：${data.errmsg}` : ''}`] }
    }
    return { openid: data.openid }
  } catch {
    return { errors: ['微信登录服务暂时不可用，请稍后重试'] }
  }
}

/** 小程序登录：code → openid → upsert 用户 → 签发令牌 */
authRouter.post('/login', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const code = String(body.code ?? '').trim()
  if (!code) return res.status(400).json({ errors: ['code 不能为空'] })

  let profile: { nick_name?: string, avatar_url?: string } = {}
  if (body.nickName !== undefined || body.avatarUrl !== undefined) {
    const profileResult = validateProfile({ nick_name: body.nickName, avatar_url: body.avatarUrl })
    if (profileResult.errors) return res.status(400).json({ errors: profileResult.errors })
    profile = profileResult.value
  }

  const result = await resolveOpenid(code)
  if ('errors' in result) return res.status(400).json({ errors: result.errors })

  const user = upsertUserByOpenid(result.openid, profile)
  if (user.status === 'disabled') return res.status(403).json({ errors: ['账号已被禁用，请联系客服'] })
  const payload: LoginResult = { token: signToken(user.id), user }
  res.json(payload)
})

/** 当前登录用户 */
authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: getUserById(res.locals.uid as number) })
})

/** 更新当前用户资料（昵称 / 头像） */
authRouter.put('/me', requireAuth, (req, res) => {
  const result = validateProfile(req.body)
  if (result.errors) return res.status(400).json({ errors: result.errors })
  const uid = res.locals.uid as number
  db.prepare(
    `UPDATE users SET nick_name=COALESCE(?, nick_name), avatar_url=COALESCE(?, avatar_url),
     updated_at=datetime('now','localtime') WHERE id=?`
  ).run(result.value.nick_name ?? null, result.value.avatar_url ?? null, uid)
  res.json({ user: getUserById(uid) })
})
