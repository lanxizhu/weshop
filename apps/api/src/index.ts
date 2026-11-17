import { createApp } from './app.js'
import { ORDER_SWEEP_INTERVAL_SECONDS, PORT } from './config.js'
import { logger } from './logger.js'
import { closeExpiredOrders } from './routes/orders.js'

const app = createApp()

function sweepExpiredOrders() {
  try {
    const closed = closeExpiredOrders()
    if (closed > 0) logger.info(`已自动关闭 ${closed} 笔超时未支付订单`)
  } catch (error) {
    logger.error('超时订单扫描失败', { error: String(error) })
  }
}

const orderSweepTimer = setInterval(sweepExpiredOrders, ORDER_SWEEP_INTERVAL_SECONDS * 1000)
orderSweepTimer.unref()

app.listen(PORT, () => {
  logger.info(`API server listening on http://localhost:${PORT}`)
  sweepExpiredOrders()
})
