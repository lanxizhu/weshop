import { Router } from 'express'
import type { AdminLoginResult } from '@weshop/shared'
import { requireAdmin, signAdminToken } from '../auth.js'
import { getAdminAuthById, getAdminAuthByUsername, getAdminById, updateAdminPassword } from '../db.js'
import { hashPassword, verifyPassword } from '../password.js'
import { validatePasswordStrength } from '../validate.js'

export const adminAuthRouter = Router()

/** 管理员登录：username + password → 管理员令牌 */
adminAuthRouter.post('/login', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const username = String(body.username ?? '').trim()
  const password = String(body.password ?? '')
  if (!username || !password) return res.status(400).json({ errors: ['用户名和密码不能为空'] })

  const admin = getAdminAuthByUsername(username)
  // 用户不存在与密码错误统一提示，避免泄露账号是否存在
  if (!admin || !(await verifyPassword(password, admin.password_hash))) {
    return res.status(401).json({ errors: ['用户名或密码错误'] })
  }
  const payload: AdminLoginResult = { token: signAdminToken(admin.id), admin: getAdminById(admin.id)! }
  res.json(payload)
})

/** 当前登录管理员 */
adminAuthRouter.get('/me', requireAdmin, (req, res) => {
  res.json({ admin: getAdminById(res.locals.adminId as number) })
})

/**
 * 修改密码（需管理员令牌）：校验旧密码与新密码强度后更新哈希，
 * 同时递增 token_version 使该管理员既有令牌全部失效，响应中返回新令牌供当前会话继续使用
 */
adminAuthRouter.put('/password', requireAdmin, async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const oldPassword = String(body.oldPassword ?? '')
  const newPassword = String(body.newPassword ?? '')
  if (!oldPassword || !newPassword) return res.status(400).json({ errors: ['旧密码和新密码不能为空'] })

  const pwErrors = validatePasswordStrength(newPassword)
  if (pwErrors.length) return res.status(400).json({ errors: pwErrors })

  const admin = getAdminAuthById(res.locals.adminId as number)!
  if (!(await verifyPassword(oldPassword, admin.password_hash))) {
    return res.status(400).json({ errors: ['旧密码不正确'] })
  }

  updateAdminPassword(admin.id, await hashPassword(newPassword))
  res.json({ token: signAdminToken(admin.id), message: '密码修改成功，其他设备的登录态已全部失效' })
})
