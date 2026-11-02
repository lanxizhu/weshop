import { Router } from 'express'
import multer from 'multer'
import path from 'node:path'
import { requireAnyAuth } from '../auth.js'
import { UPLOAD_DIR } from '../config.js'

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'])
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
}

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${EXT_BY_MIME[file.mimetype] ?? ''}`)
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.has(file.mimetype)) return cb(null, true)
    cb(new Error('仅支持 JPG / PNG / WebP / GIF / AVIF 图片'))
  },
})

export const uploadsRouter = Router()

/** 上传单张图片（multipart 字段名 file），返回可访问的 URL 路径；用户或管理员令牌皆可 */
uploadsRouter.post('/', requireAnyAuth, (req, res) => {
  upload.single('file')(req, res, (err: unknown) => {
    if (err) {
      const e = err as { code?: string; message?: string }
      const msg = e.code === 'LIMIT_FILE_SIZE' ? '图片不能超过 5MB' : (e.message ?? '上传失败')
      return res.status(400).json({ errors: [msg] })
    }
    if (!req.file) return res.status(400).json({ errors: ['未收到文件'] })
    res.status(201).json({ url: `/uploads/${req.file.filename}` })
  })
})
