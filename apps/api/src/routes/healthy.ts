import { Router } from 'express'

export const healthyRouter = Router()

/** 健康检查（供前端探测服务是否恢复，不查数据库，保持轻量） */
healthyRouter.get('/', (_req, res) => {
  res.json({ ok: true, uptime: Math.round(process.uptime()) })
})
