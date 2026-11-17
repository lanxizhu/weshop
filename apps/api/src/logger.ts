import path from 'node:path'
import type { ErrorRequestHandler, RequestHandler } from 'express'
import { RotatingLogFile } from './utils/rotating-log-file.js'
import { sanitizeRequestUrl } from './utils/sanitize-url.js'

function positiveInteger(raw: string | undefined, fallback: number): number {
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 ? value : fallback
}

const LOG_DIR = process.env.API_LOG_DIR ?? path.resolve(import.meta.dirname, '../logs')
const LOG_MAX_BYTES = positiveInteger(process.env.API_LOG_MAX_BYTES, 5 * 1024 * 1024)
const LOG_MAX_FILES = positiveInteger(process.env.API_LOG_MAX_FILES, 5)
const logFile = new RotatingLogFile({ directory: LOG_DIR, maxBytes: LOG_MAX_BYTES, maxFiles: LOG_MAX_FILES })

const COLORS = {
  info: '\x1b[32m', // green
  warn: '\x1b[33m', // yellow
  error: '\x1b[31m', // red
  gray: '\x1b[90m',
  reset: '\x1b[0m',
} as const

type Level = keyof typeof COLORS & ('info' | 'warn' | 'error')
type Meta = Record<string, unknown>

function write(level: Level, message: string, meta?: Meta) {
  const entry = { time: new Date().toISOString(), level, message, ...(meta ?? {}) }
  logFile.write(JSON.stringify(entry) + '\n')

  const color = COLORS[level]
  const metaStr = meta && Object.keys(meta).length ? ` ${COLORS.gray}${JSON.stringify(meta)}${COLORS.reset}` : ''
  console.log(`${COLORS.gray}${entry.time}${COLORS.reset} ${color}[${level.toUpperCase()}]${COLORS.reset} ${message}${metaStr}`)
}

export const logger = {
  info: (message: string, meta?: Meta) => write('info', message, meta),
  warn: (message: string, meta?: Meta) => write('warn', message, meta),
  error: (message: string, meta?: Meta) => write('error', message, meta),
}

/** 请求日志中间件：记录方法、路径、状态码与耗时 */
export const httpLogger: RequestHandler = (req, res, next) => {
  const start = process.hrtime.bigint()
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6
    const level: Level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'
    const url = sanitizeRequestUrl(req.originalUrl)
    write(level, `${req.method} ${url} ${res.statusCode}`, {
      method: req.method,
      url,
      status: res.statusCode,
      ms: Math.round(ms * 10) / 10,
      ip: req.ip,
    })
  })
  next()
}

/** 统一错误处理中间件：记录错误堆栈并返回一致的 JSON 响应 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const url = sanitizeRequestUrl(req.originalUrl)
  logger.error(`${req.method} ${url} 未处理异常`, {
    method: req.method,
    url,
    error: err.message,
    stack: err.stack,
  })
  if (res.headersSent) return
  const isSyntax = err.type === 'entity.parse.failed' || err instanceof SyntaxError
  res.status(isSyntax ? 400 : 500).json({
    errors: [isSyntax ? '请求体不是合法的 JSON' : '服务器内部错误'],
  })
}
