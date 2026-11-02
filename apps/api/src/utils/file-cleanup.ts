import fs from 'node:fs'
import path from 'node:path'
import { UPLOAD_DIR } from '../config.js'
import { db } from '../db.js'
import { logger } from '../logger.js'

/** 统计某个 /uploads/ URL 在全库的引用次数（商品图 / 规格图 / 用户头像三处） */
export function countUploadReferences(url: string): number {
  const a = db.prepare('SELECT COUNT(*) AS n FROM product_images WHERE url=?').get(url) as { n: number }
  const b = db.prepare('SELECT COUNT(*) AS n FROM product_skus WHERE image=?').get(url) as { n: number }
  const c = db.prepare('SELECT COUNT(*) AS n FROM users WHERE avatar_url=?').get(url) as { n: number }
  return a.n + b.n + c.n
}

/** 把 /uploads/xxx 解析为绝对路径；越出 UPLOAD_DIR 时返回 null（防路径穿越） */
function resolveUploadPath(url: string): string | null {
  if (!url.startsWith('/uploads/')) return null
  const root = path.resolve(UPLOAD_DIR)
  const filePath = path.resolve(root, url.slice('/uploads/'.length))
  return filePath.startsWith(root + path.sep) ? filePath : null
}

/**
 * 删除一个本地上传文件：仅处理 /uploads/ 开头的 URL；
 * 全库仍有引用（如 duplicate 商品共享同一 URL）时跳过。
 * 返回是否真正删除了文件。
 */
export function deleteLocalUpload(url: string): boolean {
  const filePath = resolveUploadPath(url)
  if (!filePath) return false
  if (countUploadReferences(url) > 0) return false
  try {
    fs.unlinkSync(filePath)
    return true
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') logger.warn(`删除上传文件失败：${url}`, { error: String(e) })
    return false
  }
}

/** 扫描 UPLOAD_DIR，删除全库无任何引用的孤儿文件，返回删除数量与释放字节数 */
export function cleanupOrphanUploads(): { deleted: number; freedBytes: number } {
  let deleted = 0
  let freedBytes = 0
  for (const name of fs.readdirSync(UPLOAD_DIR)) {
    const filePath = path.join(UPLOAD_DIR, name)
    let stat: fs.Stats
    try {
      stat = fs.statSync(filePath)
    } catch {
      continue
    }
    if (!stat.isFile()) continue
    if (countUploadReferences(`/uploads/${name}`) > 0) continue
    try {
      fs.unlinkSync(filePath)
      deleted += 1
      freedBytes += stat.size
    } catch (e) {
      logger.warn(`清理孤儿文件失败：${name}`, { error: String(e) })
    }
  }
  return { deleted, freedBytes }
}
