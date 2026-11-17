import { Router } from 'express'
import multer from 'multer'
import { promises as fs } from 'node:fs'
import { requireAnyAuth } from '../auth.js'
import { UPLOAD_DIR } from '../config.js'
import { hasMatchingImageSignature } from '../utils/image-sniff.js'

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

async function hasValidImageContent(filePath: string, mimeType: string): Promise<boolean> {
  try {
    const handle = await fs.open(filePath, 'r')
    try {
      const buffer = Buffer.alloc(32)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      return hasMatchingImageSignature(buffer.subarray(0, bytesRead), mimeType)
    }
    finally {
      await handle.close()
    }
  }
  catch {
    return false
  }
}

export const uploadsRouter = Router()

/** 上传单张图片（multipart 字段名 file）；除 MIME 外还校验文件头，失败立即删除临时文件 */
uploadsRouter.post('/', requireAnyAuth, (req, res, next) => {
  upload.single('file')(req, res, (err: unknown) => {
    if (err) {
      const e = err as { code?: string; message?: string }
      const msg = e.code === 'LIMIT_FILE_SIZE' ? '图片不能超过 5MB' : (e.message ?? '上传失败')
      return res.status(400).json({ errors: [msg] })
    }
    if (!req.file) return res.status(400).json({ errors: ['未收到文件'] })
    const file = req.file
    void (async () => {
      if (!(await hasValidImageContent(file.path, file.mimetype))) {
        await fs.rm(file.path, { force: true })
        return res.status(400).json({ errors: ['图片内容与声明格式不符或文件已损坏'] })
      }
      return res.status(201).json({ url: `/uploads/${file.filename}` })
    })().catch(next)
  })
})
