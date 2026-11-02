import { createApp } from './app.js'
import { PORT } from './config.js'
import { logger } from './logger.js'

const app = createApp()

app.listen(PORT, () => logger.info(`API server listening on http://localhost:${PORT}`))
