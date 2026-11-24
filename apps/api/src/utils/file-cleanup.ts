import { promises as fs } from 'node:fs'
import path from 'node:path'
import { UPLOAD_DIR } from '../config.js'
import { db } from '../db.js'
import { logger } from '../logger.js'

const IO_BATCH_SIZE = 16

async function getUploadReferences(): Promise<Set<string>> {
  const rows = await db.prepare(
    `SELECT url FROM product_images WHERE url LIKE '/uploads/%'
     UNION ALL
     SELECT image AS url FROM product_skus WHERE image LIKE '/uploads/%'
     UNION ALL
     SELECT avatar_url AS url FROM users WHERE avatar_url LIKE '/uploads/%'
     UNION ALL
     SELECT product_image AS url FROM order_items WHERE product_image LIKE '/uploads/%'
     UNION ALL
     SELECT value AS url FROM system_settings
     WHERE \`key\` IN ('site_logo_url', 'site_favicon_url') AND value LIKE '/uploads/%'
     UNION ALL
     SELECT value AS url FROM system_setting_defaults
     WHERE \`key\` IN ('site_logo_url', 'site_favicon_url') AND value LIKE '/uploads/%'`
  ).all<{ url: string }>()
  return new Set(rows.map(row => row.url))
}

/** 把 /uploads/xxx 解析为绝对路径；越出 UPLOAD_DIR 时返回 null（防路径穿越） */
function resolveUploadPath(url: string): string | null {
  if (!url.startsWith('/uploads/')) return null
  const root = path.resolve(UPLOAD_DIR)
  const filePath = path.resolve(root, url.slice('/uploads/'.length))
  return filePath.startsWith(root + path.sep) ? filePath : null
}

async function unlinkUpload(url: string, filePath: string): Promise<boolean> {
  try {
    await fs.unlink(filePath)
    return true
  }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
      logger.warn(`删除上传文件失败：${url}`, { error: String(e) })
    return false
  }
}

export async function deleteLocalUploads(urls: string[]): Promise<number> {
  const referenced = await getUploadReferences()
  const candidates = [...new Set(urls)]
    .map(url => ({ url, filePath: resolveUploadPath(url) }))
    .filter((item): item is { url: string, filePath: string } => item.filePath !== null && !referenced.has(item.url))

  let deleted = 0
  for (let offset = 0; offset < candidates.length; offset += IO_BATCH_SIZE) {
    const results = await Promise.all(
      candidates.slice(offset, offset + IO_BATCH_SIZE).map(item => unlinkUpload(item.url, item.filePath))
    )
    deleted += results.filter(Boolean).length
  }
  return deleted
}

/** 删除一个无人引用的本地上传文件，返回是否真正删除 */
export async function deleteLocalUpload(url: string): Promise<boolean> {
  return await deleteLocalUploads([url]) === 1
}

/** 扫描 UPLOAD_DIR，删除全库无任何引用的孤儿文件，返回删除数量与释放字节数 */
export async function cleanupOrphanUploads(): Promise<{ deleted: number, freedBytes: number }> {
  const referenced = await getUploadReferences()
  const entries = await fs.readdir(UPLOAD_DIR, { withFileTypes: true })
  const candidates = entries.filter(entry => entry.isFile() && !referenced.has(`/uploads/${entry.name}`))

  let deleted = 0
  let freedBytes = 0
  for (let offset = 0; offset < candidates.length; offset += IO_BATCH_SIZE) {
    const results = await Promise.all(
      candidates.slice(offset, offset + IO_BATCH_SIZE).map(async (entry) => {
        const filePath = path.join(UPLOAD_DIR, entry.name)
        try {
          const stat = await fs.stat(filePath)
          if (!stat.isFile()) return { deleted: false, size: 0 }
          return { deleted: await unlinkUpload(entry.name, filePath), size: stat.size }
        }
        catch {
          return { deleted: false, size: 0 }
        }
      })
    )
    for (const result of results) {
      if (!result.deleted) continue
      deleted += 1
      freedBytes += result.size
    }
  }
  return { deleted, freedBytes }
}
