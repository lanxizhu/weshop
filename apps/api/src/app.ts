import express from 'express'
import { requireAdmin } from './auth.js'
import { UPLOAD_DIR } from './config.js'
import { errorHandler, httpLogger } from './logger.js'
import { addressesRouter } from './routes/addresses.js'
import { adminAuthRouter } from './routes/admin-auth.js'
import { adminOrdersRouter } from './routes/admin-orders.js'
import { authRouter } from './routes/auth.js'
import { cartRouter } from './routes/cart.js'
import { categoriesRouter } from './routes/categories.js'
import { healthyRouter } from './routes/healthy.js'
import { ordersRouter } from './routes/orders.js'
import { productsRouter, statsHandler } from './routes/products.js'
import { statsRouter } from './routes/stats.js'
import { uploadsRouter } from './routes/uploads.js'
import { usersRouter } from './routes/users.js'
import { cleanupOrphanUploads } from './utils/file-cleanup.js'

export function createApp() {
  const app = express()

  app.use(httpLogger)
  app.use(express.json())
  app.use('/uploads', express.static(UPLOAD_DIR))

  app.use('/api/products', productsRouter)
  app.get('/api/stats', requireAdmin, statsHandler)
  app.use('/api/categories', categoriesRouter)
  app.use('/api/uploads', uploadsRouter)
  app.use('/api/healthy', healthyRouter)
  app.use('/api/auth', authRouter)
  app.use('/api/addresses', addressesRouter)
  app.use('/api/users', requireAdmin, usersRouter)
  app.use('/api/cart', cartRouter)
  app.use('/api/orders', ordersRouter)
  app.use('/api/admin/auth', adminAuthRouter)
  app.use('/api/admin/orders', requireAdmin, adminOrdersRouter)
  app.use('/api/admin/stats', requireAdmin, statsRouter)
  // 清理 UPLOAD_DIR 中全库无引用的孤儿图片，返回 { deleted, freedBytes }
  app.post('/api/admin/uploads/cleanup', requireAdmin, (_req, res) => {
    res.json(cleanupOrphanUploads())
  })

  app.use((_req, res) => {
    res.status(404).json({ errors: ['接口不存在'] })
  })
  app.use(errorHandler)

  return app
}
